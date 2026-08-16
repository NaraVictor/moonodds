-- Two free picks for everyone, and a tighter lock on the rest.
--
-- Guests previously saw a board of entirely locked cards. That is a poor
-- shop window: it proves we have inventory but gives no evidence the calls are
-- any good. Two unlocked picks, which, because the board is ordered by
-- confidence, are necessarily among the day's top three, let a stranger judge
-- the product before deciding whether to pay for it.
--
-- The first-day trial for new accounts stays. Registering therefore doesn't buy
-- more picks on day one; it buys slips, history and alerts. That is a
-- deliberate trade: the pitch moves from "sign up to see more" to "sign up to
-- keep track", which is the more honest of the two.

create or replace function app.access_state()
returns table (has_full_access boolean, is_first_day boolean, pick_limit integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  free_pick_limit constant integer := 2;
  today date := (select app.utc_today());
  prof public.profiles%rowtype;
  has_pass boolean;
begin
  -- Signed out: the same free allowance a new account gets on its first day.
  if uid is null then
    return query select false, false, free_pick_limit;
    return;
  end if;

  select * into prof from public.profiles p where p.id = uid;

  -- A missing profile is treated as untrusted rather than as a guest: it means
  -- an authenticated session with no matching row, which should never happen
  -- and should not be rewarded with picks.
  if not found or prof.is_suspended then
    return query select false, false, 0;
    return;
  end if;

  if prof.is_super_admin then
    return query select true, false, 2147483647;
    return;
  end if;

  select exists (
    select 1 from public.daily_passes dp
    where dp.user_id = uid and dp.date_key = today and dp.status = 'active'
  ) into has_pass;

  if has_pass then
    return query select true, false, 2147483647;
    return;
  end if;

  if (select app.first_seen_date(uid)) = today then
    return query select false, true, free_pick_limit;
    return;
  end if;

  -- Returning visitor with no pass still gets the standing free allowance,
  -- so the board is never a wall of locks for anyone.
  return query select false, false, free_pick_limit;
end;
$$;

-- ---------------------------------------------------------------------------
-- The market is part of what we sell
-- ---------------------------------------------------------------------------

/**
 * Previously this leaked prediction_type as a teaser, "there's a handicap call
 * on this match", on the theory that naming the question without answering it
 * was fair advertising. It isn't: the market IS half the call. Knowing we chose
 * the handicap rather than the 1x2 tells you what we think is mispriced, which
 * is exactly the insight a subscriber is paying for.
 *
 * So the locked payload now carries no trace of the prediction at all. What
 * remains is the match: teams, league, kickoff, venue, and the result if it has
 * already been played. Statistics stay public on the detail page.
 */
create or replace function app.pick_json_locked(p public.predictions)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'locked', true,
    'status', p.status,
    'fixture', jsonb_build_object(
      'id', f.id,
      'date', f.fixture_date,
      'status', f.status,
      'venue', f.venue,
      'round', f.round,
      'homeGoals', f.home_goals,
      'awayGoals', f.away_goals
    ),
    'homeTeam', jsonb_build_object('name', ht.name, 'shortName', ht.short_name, 'logo', ht.logo),
    'awayTeam', jsonb_build_object('name', at2.name, 'shortName', at2.short_name, 'logo', at2.logo),
    'league', jsonb_build_object('name', l.name, 'country', l.country, 'logo', l.logo)
  )
  from public.fixtures f
  join public.teams ht on ht.id = f.home_team_id
  join public.teams at2 on at2.id = f.away_team_id
  join public.leagues l on l.id = f.league_id
  where f.id = p.fixture_id;
$$;
