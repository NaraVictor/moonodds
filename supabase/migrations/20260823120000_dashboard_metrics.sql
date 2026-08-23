-- ---------------------------------------------------------------------------
-- Kicka, the management dashboard
--
-- One call rather than a dozen. Every figure the Office landing tab shows comes
-- back in a single jsonb payload, because ten round trips from a browser to
-- render one screen is ten chances for a partial render and ten sets of RLS
-- overhead for numbers that must agree with each other.
--
-- The board is deliberately split in two, and the shape of this return value
-- says so: `asOfToday` ignores the date range because a catalogue size or an
-- all-time total has no meaningful "in the last 7 days" reading, while
-- `inRange` answers the filter. A dashboard whose tiles quietly mean different
-- things is worse than one with fewer tiles.
--
-- CHURN AND RETURN ARE PURCHASE-BASED. This product sells day passes, not
-- subscriptions, so there is no renewal to miss and the subscription
-- definition does not apply. Churn is someone who bought in the PREVIOUS
-- window of the same length and did not buy in this one; return rate is the
-- share of buyers who bought on more than one distinct day. Both measure
-- money rather than attention, which is what a pass product actually lives on.
-- ---------------------------------------------------------------------------

create or replace function public.get_dashboard_metrics(
  p_start timestamptz default null,
  p_end   timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result       jsonb;
  win_start    timestamptz := p_start;
  win_end      timestamptz := coalesce(p_end, now());
  prev_start   timestamptz;
  prev_end     timestamptz;
  span         interval;
begin
  if not (select app.is_super_admin()) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  -- The comparison window for churn: the same length, immediately before.
  -- With no start date there is no "previous" period, so churn is null rather
  -- than 0 — an unmeasurable figure and a measured zero are different claims.
  if win_start is not null then
    span       := win_end - win_start;
    prev_end   := win_start;
    prev_start := win_start - span;
  end if;

  with
  /* ------------------------- as of today ------------------------- */
  totals as (
    select
      (select count(*) from public.profiles)                                    as users,
      (select count(*) from public.profiles where is_suspended)                 as suspended,
      (select count(*) from public.predictions)                                 as predictions,
      (select count(*) from public.leagues where is_active)                      as leagues,
      (select count(*) from public.teams)                                        as teams,
      (select count(*) from public.fixtures)                                     as fixtures,
      (select count(*) from public.daily_passes
        where date_key = (select app.utc_today()) and status = 'active')         as active_today
  ),

  /* --------------------------- in range -------------------------- */
  -- Settled predictions only. A pending pick is not a miss, and counting it as
  -- one drags the hit rate down by however many fixtures happen to be in play.
  graded as (
    select p.status
    from public.predictions p
    join public.fixtures f on f.id = p.fixture_id
    where p.status in ('won','lost')
      and (win_start is null or f.fixture_date >= win_start)
      and f.fixture_date < win_end
  ),
  accuracy as (
    select
      count(*) filter (where status = 'won')  as wins,
      count(*) filter (where status = 'lost') as losses,
      count(*)                                as settled
    from graded
  ),

  slip_perf as (
    select
      count(*) filter (where status = 'won')                    as won,
      count(*) filter (where status in ('won','lost'))          as settled,
      count(*)                                                  as total
    from public.slips
    where confirmed_at is not null
      and (win_start is null or confirmed_at >= win_start)
      and confirmed_at < win_end
  ),

  signups as (
    select count(*) as n
    from public.profiles
    where (win_start is null or created_at >= win_start) and created_at < win_end
  ),

  passes as (
    select
      count(*)                          as sold,
      coalesce(sum(amount_usd), 0)      as revenue,
      count(distinct user_id)           as buyers
    from public.daily_passes
    where status = 'active'
      and (win_start is null or created_at >= win_start) and created_at < win_end
  ),

  extras as (
    select
      count(*)                          as orders,
      coalesce(sum(num_games), 0)       as games,
      coalesce(sum(amount_usd), 0)      as revenue
    from public.extra_pick_orders
    where status = 'active'
      and (win_start is null or created_at >= win_start) and created_at < win_end
  ),

  -- Anyone who bought on two or more distinct days inside the window. Distinct
  -- DAYS, not distinct passes: buying twice on one date_key is impossible, and
  -- counting rows would let a single extra-picks order look like a return.
  repeats as (
    select count(*) as returning_buyers
    from (
      select user_id
      from public.daily_passes
      where status = 'active'
        and (win_start is null or created_at >= win_start) and created_at < win_end
      group by user_id
      having count(distinct date_key) > 1
    ) r
  ),

  -- Bought in the previous window of equal length, and not in this one.
  churn as (
    select
      count(*) filter (where p.user_id is not null)                       as prior_buyers,
      count(*) filter (where p.user_id is not null and c.user_id is null) as lapsed
    from (
      select distinct user_id
      from public.daily_passes
      where prev_start is not null and status = 'active'
        and created_at >= prev_start and created_at < prev_end
    ) p
    left join (
      select distinct user_id
      from public.daily_passes
      where status = 'active'
        and (win_start is null or created_at >= win_start) and created_at < win_end
    ) c on c.user_id = p.user_id
  )

  select jsonb_build_object(
    'asOfToday', jsonb_build_object(
      'users',            t.users,
      'suspended',        t.suspended,
      'activePassesToday', t.active_today,
      'predictions',      t.predictions,
      'leagues',          t.leagues,
      'teams',            t.teams,
      'fixtures',         t.fixtures
    ),
    'inRange', jsonb_build_object(
      'newUsers',      s.n,
      'passesSold',    pa.sold,
      'payingUsers',   pa.buyers,
      'passRevenue',   round(pa.revenue::numeric, 2),
      'extraOrders',   ex.orders,
      'extraGames',    ex.games,
      'extraRevenue',  round(ex.revenue::numeric, 2),
      'revenue',       round((pa.revenue + ex.revenue)::numeric, 2),
      -- Per PAYING user, not per user. Dividing by everyone who ever signed up
      -- measures how many people have not paid, which is a different question
      -- and one the signup tile already answers.
      'arpu', case when pa.buyers > 0
                then round(((pa.revenue + ex.revenue) / pa.buyers)::numeric, 2)
                else null end,
      'settled',       ac.settled,
      'wins',          ac.wins,
      'losses',        ac.losses,
      'hitRate',  case when ac.settled > 0
                    then round((ac.wins::numeric / ac.settled) * 100, 1) else null end,
      'slipsSettled',  sp.settled,
      'slipsTotal',    sp.total,
      'slipWinRate', case when sp.settled > 0
                    then round((sp.won::numeric / sp.settled) * 100, 1) else null end,
      'returnRate', case when pa.buyers > 0
                    then round((rp.returning_buyers::numeric / pa.buyers) * 100, 1) else null end,
      'returningBuyers', rp.returning_buyers,
      -- Null, not zero, when there is no previous window to compare against.
      'churnRate', case when ch.prior_buyers > 0
                    then round((ch.lapsed::numeric / ch.prior_buyers) * 100, 1) else null end,
      'lapsedBuyers',  ch.lapsed,
      'priorBuyers',   ch.prior_buyers
    )
  ) into result
  from totals t, signups s, passes pa, extras ex, accuracy ac, slip_perf sp, repeats rp, churn ch;

  return result;
end;
$$;

revoke all on function public.get_dashboard_metrics(timestamptz, timestamptz) from public, anon;
grant execute on function public.get_dashboard_metrics(timestamptz, timestamptz) to authenticated;

comment on function public.get_dashboard_metrics is
  'Office dashboard. asOfToday ignores the range (catalogue and all-time totals); inRange answers it. Churn and return are purchase-based, because a day-pass product has no renewal to miss.';
