-- ============================================================================
-- Extra picks: sell what exists, and date the order by when it was bought
--
-- Two faults, found by auditing the flow end to end against live data. Today
-- there are 14 upcoming fixtures and 3 of them have a prediction, so five of
-- the eight leagues offered in the picker would have taken $2 and delivered
-- nothing at all.
--
-- 1. THE PICKER COUNTED FIXTURES, THE PRODUCT DELIVERS PREDICTIONS
--
--    useLeagueOptions counted rows in `fixtures`, and selectFixtures chose from
--    `fixtures`, but get_my_extra_picks returns rows from `predictions` for
--    those fixture ids. The engine publishes a fraction of the board — 8 to 12
--    of 20 on a good day, 0 on a bad one — so the gap between the two is not an
--    edge case, it is the normal state.
--
--    The client cannot fix this for itself: predictions are default-deny under
--    RLS, so no query the browser can make will count them. Hence this RPC.
--
--    It counts only fixtures that HAVE a prediction, are still upcoming, and
--    that the caller has not already unlocked today — so the number offered is
--    the number that can actually be delivered.
--
-- 2. THE ORDER WAS DATED BY WHEN IT SETTLED
--
--    activate_extra_picks wrote (now() at time zone 'utc')::date and ignored
--    the dateKey the checkout recorded on the payment. A purchase at 23:58
--    confirmed at 00:01 produced an order dated tomorrow, and
--    get_my_extra_picks filters on date_key = utc_today() — so the customer saw
--    nothing on the day they paid, and the following day saw fixtures that had
--    already kicked off. activate_daily_pass was fixed for exactly this in
--    20260825020000; this is the same bug in the function next to it.
-- ============================================================================

create or replace function public.activate_extra_picks(
  p_user_id uuid,
  p_reference text,
  p_league_ids uuid[],
  p_fixture_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  pay public.payments%rowtype;
  order_id uuid;
  key date;
begin
  select * into pay
  from public.payments
  where reference = p_reference and user_id = p_user_id and purpose = 'extra_picks';

  if not found then
    raise exception 'no matching payment for this account'
      using errcode = '42501';
  end if;

  -- Idempotent: the same reference must never produce two orders.
  select id into order_id from public.extra_pick_orders where payment_id = pay.id;
  if found then
    return order_id;
  end if;

  -- The day it was BOUGHT. Settlement date is only the fallback for rows
  -- written before checkout began recording one.
  key := coalesce(
    (pay.metadata ->> 'dateKey')::date,
    (now() at time zone 'utc')::date
  );

  update public.payments
  set status = 'succeeded', settled_at = coalesce(settled_at, now())
  where id = pay.id;

  insert into public.extra_pick_orders (
    user_id, date_key, league_ids, fixture_ids, num_games,
    amount_usd, currency, payment_id, status
  )
  values (
    p_user_id, key, p_league_ids, p_fixture_ids,
    coalesce(array_length(p_fixture_ids, 1), 0), pay.amount_usd, pay.currency,
    pay.id, 'active'
  )
  returning id into order_id;

  return order_id;
end;
$$;

revoke all on function public.activate_extra_picks(uuid, text, uuid[], uuid[])
  from public, anon, authenticated;

/**
 * Leagues worth buying, with the number of picks each would actually hand over.
 *
 * Counts PREDICTIONS, not fixtures, and excludes anything the caller already
 * owns today — so a league that would deliver nothing does not appear, and one
 * that would deliver two does not advertise five.
 *
 * The per-league cap is applied by the caller rather than here, so
 * EXTRA_PICK_GAMES_PER_LEAGUE stays a single constant in the application.
 */
create or replace function public.get_extra_pick_leagues()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with owned as (
    select unnest(o.fixture_ids) as fixture_id
    from public.extra_pick_orders o
    where o.user_id = (select auth.uid())
      and o.date_key = (select app.utc_today())
      and o.status = 'active'
  ),
  sellable as (
    select f.league_id, f.id
    from public.fixtures f
    join public.predictions p on p.fixture_id = f.id
    where f.status = 'scheduled'
      and f.fixture_date >= now()
      and f.fixture_date < ((select app.utc_today()) + 1)::timestamp at time zone 'utc'
      and f.id not in (select fixture_id from owned)
    group by f.league_id, f.id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'leagueId', s.league_id,
        'name', l.name,
        'country', l.country,
        'logo', l.logo,
        'availableGames', s.games
      )
      order by l.name
    ),
    '[]'::jsonb
  )
  from (
    select league_id, count(*)::int as games
    from sellable group by league_id
  ) s
  join public.leagues l on l.id = s.league_id;
$$;

grant execute on function public.get_extra_pick_leagues() to authenticated;
