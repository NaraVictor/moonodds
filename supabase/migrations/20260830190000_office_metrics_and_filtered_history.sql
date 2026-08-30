-- ============================================================================
-- The Office measures the board, /history measures what you are looking at,
-- and the landing preview stops existing
--
-- 1. OFFICE METRICS NOW COUNT BOARD PICKS ONLY
--
-- I argued for leaving these alone: they measure the ENGINE rather than the
-- product. Overruled, and the reasoning is sound for three of the four — the
-- dashboard hit rate, the league performance log and the Office accuracy
-- report are all read as "how are we doing", and answering that with a set the
-- public record excludes means two different truths in the same building.
--
-- backtest_thresholds is the one I would still flag. It exists to answer "what
-- would a different FLOOR have published", and under rank-based tiering the
-- floor is not what sends a pick to the basket — placing sixteenth is. So the
-- picks this filter removes are settled calls ABOVE the floor, which is
-- exactly the evidence a floor sweep needs. Rather than argue it twice, the
-- function now REPORTS what the filter removed, as `excludedExtras`. If that
-- number is ever large next to `candidates`, the sweep is reasoning from a
-- fraction of the record and the number on screen says so.
--
-- get_stuck_queue is deliberately untouched: it hunts picks that never graded,
-- and a tier filter there would let extras rot in the queue unseen. It is an
-- ops check, not a metric.
--
-- 2. /history STATS FOLLOW THE FILTERS
--
-- The cards described the whole record while the list underneath showed one
-- league, so picking Serie A left an 80% headline sitting above eleven Serie A
-- rows that had nothing to do with it.
--
-- League and market only. OUTCOME is deliberately not passed: filtering to
-- "Won" and then computing a win rate returns 100% with a confidence interval
-- around it, which is not a statistic, it is a tautology wearing one. The
-- outcome tabs stay a view on the list.
--
-- 3. get_landing_preview IS DROPPED
--
-- No caller in the application — only the security suite, which exercised it
-- because it is granted to anon. That is the whole problem: a publicly
-- callable endpoint returning a full pick and a count of the day's board, kept
-- alive by nothing but its own test. It also had no tier filter, so its counts
-- would have included the paid basket. Deleting it is cheaper than maintaining
-- it, and the suite now asserts it is gone.
-- ============================================================================

create or replace function public.backtest_thresholds(
  p_floor numeric default null,
  p_unit1 numeric default null,
  p_unit2 numeric default null,
  p_unit3 numeric default null,
  p_unit4 numeric default null,
  p_unit5 numeric default null,
  p_markets text[] default null,
  p_days integer default 90
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with cfg as (
    select
      coalesce(p_floor, 7.0) as floor,
      coalesce(p_unit1, 5.0) as u1,
      coalesce(p_unit2, 6.0) as u2,
      coalesce(p_unit3, 7.0) as u3,
      coalesce(p_unit4, 8.0) as u4,
      coalesce(p_unit5, 9.0) as u5
  ),
  universe as (
    select p.id, p.status, p.confidence_score, p.prediction_type::text as market,
           app.pick_price(p) as price
    from public.predictions p
    where p.status in ('won', 'lost')
      and p.tier = 'primary'
      and p.settled_at > now() - make_interval(days => greatest(coalesce(p_days, 90), 1))
      and (p_markets is null or p.prediction_type::text = any(p_markets))
  ),
  -- What the tier filter removed, reported rather than hidden. The floor is
  -- not what puts a pick in the basket — rank is — so these are settled calls
  -- ABOVE the floor that this backtest can no longer see. If that number is
  -- large, the sweep is reasoning from a fraction of the evidence.
  excluded as (
    select count(*) as n
    from public.predictions p
    where p.status in ('won', 'lost')
      and p.tier = 'extra'
      and p.settled_at > now() - make_interval(days => greatest(coalesce(p_days, 90), 1))
      and (p_markets is null or p.prediction_type::text = any(p_markets))
  ),
  selected as (
    select u.*,
           case
             when u.confidence_score >= c.u5 then 5
             when u.confidence_score >= c.u4 then 4
             when u.confidence_score >= c.u3 then 3
             when u.confidence_score >= c.u2 then 2
             else 1
           end as units
    from universe u cross join cfg c
    where u.confidence_score >= c.floor
  )
  select jsonb_build_object(
    'candidates', (select count(*) from universe),
    'excludedExtras', (select n from excluded),
    'published',  (select count(*) from selected),
    'won',        (select count(*) from selected where status = 'won'),
    'lost',       (select count(*) from selected where status = 'lost'),
    'winRate',    (select round(count(*) filter (where status = 'won')::numeric
                                / nullif(count(*), 0), 4) from selected),
    'winRateInterval', (
      select app.wilson_interval(
        (select count(*)::integer from selected where status = 'won'),
        (select count(*)::integer from selected)
      )
    ),
    -- Staked in units rather than flat, which is the point of having bands.
    'unitsStaked',  (select coalesce(sum(units), 0) from selected),
    'unitsReturned',(select coalesce(round(sum(units * price) filter (where status = 'won'), 2), 0) from selected),
    'roi', (
      select round(
        (coalesce(sum(units * price) filter (where status = 'won'), 0) - coalesce(sum(units), 0))
        / nullif(sum(units), 0), 4)
      from selected
    ),
    -- What the floor threw away. A floor that improves win rate by discarding
    -- every profitable longshot is not an improvement.
    'discarded', (
      select jsonb_build_object(
        'count', count(*),
        'winRate', round(count(*) filter (where status = 'won')::numeric
                         / nullif(count(*), 0), 4)
      )
      from universe u cross join cfg c where u.confidence_score < c.floor
    )
  );
$$;

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
      (select count(*) from public.predictions where tier = 'primary')          as predictions,
      (select count(*) from public.predictions where tier = 'extra')            as extra_predictions,
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
      and p.tier = 'primary'
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
      'extraPredictions', t.extra_predictions,
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

create or replace function app.log_league_performance(p_since timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  insert into public.league_performance_log (
    league_id, total_picks, wins, losses, accuracy_rate, avg_clv_delta, efficiency_flag
  )
  select
    f.league_id,
    count(*),
    count(*) filter (where p.status = 'won'),
    count(*) filter (where p.status = 'lost'),
    round(count(*) filter (where p.status = 'won')::numeric / count(*), 3),
    round(avg(c.clv)::numeric, 4),
    (case
       when avg(c.clv) is null   then 'standard'
       when avg(c.clv) >= 0.02   then 'high_edge'
       when avg(c.clv) <  0      then 'low_edge'
       else 'standard'
     end)::public.efficiency_flag
  from public.predictions p
  join public.fixtures f on f.id = p.fixture_id
  -- One CLV number per prediction first. Joining odds_snapshots directly would
  -- multiply a prediction by its snapshot count and inflate total_picks.
  left join lateral (
    select avg(o.clv_delta) as clv
    from public.odds_snapshots o
    where o.prediction_id = p.id and o.clv_delta is not null
  ) c on true
  where p.status in ('won', 'lost')
    and p.tier = 'primary'
    and p.settled_at >= p_since
  group by f.league_id;

  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.get_prediction_report(
  p_league_id uuid default null,
  p_start timestamptz default null,
  p_end timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not (select app.is_super_admin()) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  with scoped as (
    select p.status, f.league_id
    from public.predictions p
    join public.fixtures f on f.id = p.fixture_id
    where p.tier = 'primary'
      and (p_league_id is null or f.league_id = p_league_id)
      and (p_start is null or f.fixture_date >= p_start)
      and (p_end is null or f.fixture_date < p_end)
  ),
  totals as (
    select
      count(*) filter (where status = 'won')     as wins,
      count(*) filter (where status = 'lost')    as losses,
      count(*) filter (where status = 'pending') as pending,
      count(*) filter (where status = 'void')    as voided,
      count(*)                                    as total
    from scoped
  ),
  by_league as (
    select
      l.name    as "leagueName",
      l.country as "country",
      l.logo    as "logo",
      count(*) filter (where s.status = 'won')  as wins,
      count(*) filter (where s.status = 'lost') as losses,
      count(*) filter (where s.status = 'pending') as pending,
      count(*) filter (where s.status in ('won','lost')) as graded,
      round(
        count(*) filter (where s.status = 'won')::numeric
        / nullif(count(*) filter (where s.status in ('won','lost')), 0), 4
      ) as "winRate"
    from scoped s
    join public.leagues l on l.id = s.league_id
    group by l.id, l.name, l.country, l.logo
    order by count(*) filter (where s.status in ('won','lost')) desc
  )
  select jsonb_build_object(
    'wins', t.wins,
    'losses', t.losses,
    'pending', t.pending,
    'voided', t.voided,
    'graded', t.wins + t.losses,
    'total', t.total,
    'winRate', case when (t.wins + t.losses) > 0
                    then round(t.wins::numeric / (t.wins + t.losses), 4) end,
    'leagues', coalesce((select jsonb_agg(row_to_json(b)) from by_league b), '[]'::jsonb)
  ) into result
  from totals t;

  return result;
end;
$$;

create or replace function public.get_history_stats(
  p_league text default null,
  p_market text default null
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with settled as (
    select
      p.status,
      p.prediction_type::text as market,
      p.confidence_score,
      p.settled_at,
      l.name as league_name,
      app.pick_price(p) as price
    from public.predictions p
    join public.fixtures f on f.id = p.fixture_id
    join public.leagues l on l.id = f.league_id
    -- Extra picks are the calls the board would not carry, so they must not
    -- appear in the published record. This function predates the tier column
    -- and was the one public read still counting them.
    where p.status in ('won', 'lost', 'void')
      and p.tier = 'primary'
      and (p_league is null or l.name = p_league)
      and (p_market is null or p.prediction_type::text = p_market)
  ),
  graded as (select * from settled where status in ('won', 'lost'))
  select jsonb_build_object(
    'settled',   (select count(*) from graded),
    'won',       (select count(*) from graded where status = 'won'),
    'lost',      (select count(*) from graded where status = 'lost'),
    'void',      (select count(*) from settled where status = 'void'),
    'winRate',   (select round(count(*) filter (where status = 'won')::numeric
                               / nullif(count(*), 0), 4) from graded),
    'winRateInterval', (
      select app.wilson_interval(
        (select count(*)::integer from graded where status = 'won'),
        (select count(*)::integer from graded)
      )
    ),
    'roi',       (select round((coalesce(sum(price) filter (where status = 'won'), 0)
                                - count(*)) / nullif(count(*), 0), 4) from graded),
    'avgOdds',   (select round(avg(price), 2) from graded),
    'avgConfidence', (select round(avg(confidence_score), 2) from graded),
    'bestMarket', (
      select m.market from (
        select market,
               count(*) filter (where status = 'won')::numeric / count(*) as rate,
               count(*) as n
        from graded group by market having count(*) >= 5
      ) m order by m.rate desc, m.n desc limit 1
    ),
    'byMarket', coalesce((
      select jsonb_agg(row_to_json(t) order by t.settled desc)
      from (
        select
          market,
          count(*) filter (where status = 'won')  as wins,
          count(*) filter (where status = 'lost') as losses,
          count(*) as settled,
          round(count(*) filter (where status = 'won')::numeric / count(*), 4) as "winRate",
          round((coalesce(sum(price) filter (where status = 'won'), 0) - count(*))
                / count(*), 4) as roi
        from graded
        group by market
      ) t
    ), '[]'::jsonb),
    'byMonth', coalesce((
      select jsonb_agg(row_to_json(t) order by t.month)
      from (
        select
          to_char(date_trunc('month', settled_at), 'YYYY-MM') as month,
          count(*) filter (where status = 'won')  as wins,
          count(*) filter (where status = 'lost') as losses,
          count(*) as settled,
          round(count(*) filter (where status = 'won')::numeric / count(*), 4) as "winRate"
        from graded
        group by date_trunc('month', settled_at)
        order by date_trunc('month', settled_at)
        limit 12
      ) t
    ), '[]'::jsonb),
    -- Calibration: does a 9.0 actually land 90% of the time? The engine has
    -- been recording confidence_raw next to the anchored score since v2.2, so
    -- the data to answer this already existed and nothing was reading it.
    'calibration', coalesce((
      select jsonb_agg(row_to_json(t) order by t.band)
      from (
        select
          width_bucket(confidence_score, 5, 10, 5) as bucket,
          concat(
            round(4 + width_bucket(confidence_score, 5, 10, 5)::numeric, 0), '-',
            round(5 + width_bucket(confidence_score, 5, 10, 5)::numeric, 0)
          ) as band,
          count(*) as settled,
          round(count(*) filter (where status = 'won')::numeric / count(*), 4) as "actualRate",
          round(avg(confidence_score) / 10, 4) as "impliedRate"
        from graded
        group by width_bucket(confidence_score, 5, 10, 5)
        having count(*) >= 5
      ) t
    ), '[]'::jsonb)
  );
$$;

-- The old zero-argument signature has to go explicitly: adding defaulted
-- parameters creates a NEW function rather than replacing the old one, and
-- leaving both would make every call ambiguous.
drop function if exists public.get_history_stats();

drop function if exists public.get_landing_preview();

grant execute on function public.get_history_stats(text, text) to anon, authenticated;
