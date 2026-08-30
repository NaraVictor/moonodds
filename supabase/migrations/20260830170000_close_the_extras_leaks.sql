-- ============================================================================
-- The paywall had four more holes, and one of them was the board itself
--
-- 20260830150000 put a tier filter on get_picks_by_status and I stopped there.
-- That was the wrong function to stop at: get_picks_by_status backs the Office
-- and the status tabs, while the READ THAT DRAWS THE HOME BOARD is
-- get_todays_picks. It had no tier filter at all, so every extra pick would
-- have appeared on the free board — and appeared UNLOCKED to any day-pass
-- holder, because pick_json_gated unlocks everything inside their pick limit
-- and a pass holder's limit is effectively infinite.
--
-- Three more read the same table with the same gap:
--
--   get_prediction_history   /history's list. Returns app.pick_json — the
--                            FULL pick, never gated — for everything settled.
--                            Every extra would have been published free the
--                            day after it was sold, and the list would not
--                            have reconciled with the summary above it, since
--                            get_history_stats already counts primaries only.
--   get_history_facets       the league and market filters on that page, built
--                            from the same unfiltered set.
--   get_league_performance   public per-league accuracy, counting picks the
--                            public record deliberately excludes.
--
-- And get_prediction_detail decided entitlement by RANK ALONE, so a pass
-- holder was entitled to any prediction id, extras included. Guessing a uuid
-- is not a practical attack, which is why this is last rather than first — but
-- "they cannot find the id" is not an access rule, and it is not the one the
-- product claims.
--
-- Nothing has leaked. The basket is still empty: tier shipped on the 30th and
-- no extra pick has been written yet. These are all holes that open on the
-- first day the split actually produces one.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. The home board
-- --------------------------------------------------------------------------
create or replace function public.get_todays_picks(
  start_ts timestamptz,
  end_ts timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  st record;
  total integer;
  visible jsonb;
  win_start timestamptz := start_ts;
  win_end   timestamptz := end_ts;
  fell_back boolean := false;
  latest    date;
begin
  select * into st from app.access_state();

  -- Only look backwards when the requested day is genuinely empty. A day with
  -- one pick is a real board and must not be replaced by a fuller yesterday.
  if not exists (
    select 1
    from public.predictions p
    join public.fixtures f on f.id = p.fixture_id
    where p.tier = 'primary'
      and f.fixture_date >= start_ts and f.fixture_date < end_ts
  ) then
    select max((f.fixture_date at time zone 'utc')::date)
      into latest
    from public.predictions p
    join public.fixtures f on f.id = p.fixture_id
    where p.tier = 'primary' and f.fixture_date < start_ts;

    if latest is not null then
      win_start := latest::timestamp at time zone 'utc';
      win_end   := (latest + 1)::timestamp at time zone 'utc';
      fell_back := true;
    end if;
  end if;

  select count(*) into total
  from public.predictions p
  join public.fixtures f on f.id = p.fixture_id
  where p.tier = 'primary'
    and f.fixture_date >= win_start and f.fixture_date < win_end;

  -- Rank by confidence and unlock down to the viewer's limit. Whole-row `p` is
  -- carried as a composite so the json helpers still receive a predictions row
  -- alongside the window function's ranking.
  select coalesce(
           jsonb_agg(
             app.pick_json_gated(r.pred, r.rn <= st.pick_limit)
             order by r.confidence_score desc
           ),
           '[]'::jsonb
         )
    into visible
  from (
    select p as pred,
           p.confidence_score,
           row_number() over (order by p.confidence_score desc) as rn
    from public.predictions p
    join public.fixtures f on f.id = p.fixture_id
    where p.tier = 'primary'
      and f.fixture_date >= win_start and f.fixture_date < win_end
  ) r;

  return jsonb_build_object(
    'picks', visible,
    'totalCount', total,
    'visibleCount', least(greatest(st.pick_limit, 0), total),
    'hasFullAccess', st.has_full_access,
    'isFirstDay', st.is_first_day,
    'freePickLimit', case when st.pick_limit > 1000000 then 0 else st.pick_limit end,
    -- The day actually being shown, and whether it is a fallback. The client
    -- cannot work this out for itself: it asked for today either way.
    'boardDate', (win_start at time zone 'utc')::date,
    'isPreviousDay', fell_back
  );
end;
$$;

-- --------------------------------------------------------------------------
-- 2. The public record: list, facets, and per-league accuracy
--
-- All three now agree with get_history_stats, which is the point. A record
-- whose summary counts one set and whose rows show another is worse than
-- either number would have been on its own.
-- --------------------------------------------------------------------------
create or replace function public.get_prediction_history(
  p_limit   integer default 24,
  p_offset  integer default 0,
  p_league  text default null,
  p_market  text default null,
  p_outcome text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  lim   integer := least(greatest(coalesce(p_limit, 24), 1), 100);
  off   integer := greatest(coalesce(p_offset, 0), 0);
  rows_ jsonb;
  total integer;
begin
  select count(*)
  into total
  from public.predictions p
  join public.fixtures f on f.id = p.fixture_id
  join public.leagues l on l.id = f.league_id
  where p.tier = 'primary'
    and p.status in ('won', 'lost', 'void')
    and (p_league is null or l.name = p_league)
    and (p_market is null or p.prediction_type::text = p_market)
    and (p_outcome is null or p.status::text = p_outcome);

  select coalesce(jsonb_agg(app.pick_json(p) order by p.settled_at desc), '[]'::jsonb)
  into rows_
  from (
    select p.*
    from public.predictions p
    join public.fixtures f on f.id = p.fixture_id
    join public.leagues l on l.id = f.league_id
    where p.tier = 'primary'
      and p.status in ('won', 'lost', 'void')
      and (p_league is null or l.name = p_league)
      and (p_market is null or p.prediction_type::text = p_market)
      and (p_outcome is null or p.status::text = p_outcome)
    order by p.settled_at desc
    limit lim offset off
  ) p;

  return jsonb_build_object(
    'rows', rows_,
    'total', total,
    'limit', lim,
    'offset', off,
    'hasMore', off + lim < total
  );
end;
$$;

create or replace function public.get_history_facets()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'leagues', coalesce((
      select jsonb_agg(distinct l.name order by l.name)
      from public.predictions p
      join public.fixtures f on f.id = p.fixture_id
      join public.leagues l on l.id = f.league_id
      where p.tier = 'primary' and p.status in ('won', 'lost', 'void')
    ), '[]'::jsonb),
    'markets', coalesce((
      select jsonb_agg(distinct p.prediction_type::text order by p.prediction_type::text)
      from public.predictions p
      where p.tier = 'primary' and p.status in ('won', 'lost', 'void')
    ), '[]'::jsonb)
  );
$$;

create or replace function public.get_league_performance()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(row_to_json(t) order by t.settled desc), '[]'::jsonb)
  from (
    select
      l.name        as "leagueName",
      l.country     as "country",
      l.logo        as "logo",
      count(*) filter (where p.status = 'won')  as wins,
      count(*) filter (where p.status = 'lost') as losses,
      count(*) filter (where p.status in ('won','lost')) as settled,
      round(
        count(*) filter (where p.status = 'won')::numeric
        / nullif(count(*) filter (where p.status in ('won','lost')), 0),
        4
      ) as "accuracyRate"
    from public.predictions p
    join public.fixtures f on f.id = p.fixture_id
    join public.leagues l on l.id = f.league_id
    where p.tier = 'primary' and p.status in ('won', 'lost')
    group by l.id, l.name, l.country, l.logo
    having count(*) filter (where p.status in ('won','lost')) >= 3
  ) t;
$$;

-- --------------------------------------------------------------------------
-- 3. Entitlement on a single pick
-- --------------------------------------------------------------------------
create or replace function public.get_prediction_detail(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  st record;
  pred public.predictions;
  entitled boolean;
  rank_of integer;
  stats public.fixture_stats;
  fx public.fixtures;
begin
  select * into st from app.access_state();

  select * into pred from public.predictions where id = p_id;
  if not found then
    return null;
  end if;

  select * into fx from public.fixtures where id = pred.fixture_id;

  select count(*) + 1 into rank_of
  from public.predictions p2
  join public.fixtures f2 on f2.id = p2.fixture_id
  join public.fixtures f1 on f1.id = pred.fixture_id
  where p2.tier = 'primary'
    and f2.fixture_date::date = f1.fixture_date::date
    and p2.confidence_score > pred.confidence_score;

  /*
   * Entitlement, said rather than implied.
   *
   * A board pick is entitled by rank, as it always was. An extra is entitled
   * only to somebody who bought it — the same question get_my_extra_picks
   * asks, asked in the one other place that can hand a whole pick over.
   *
   * It used to be rank alone, and a day-pass holder's pick_limit is
   * effectively infinite, so a pass holder was entitled to ANY prediction id
   * including an extra they had never bought. Guessing a uuid is not a
   * practical attack, which is why this was not urgent — but "they cannot
   * find the id" is not an access rule.
   */
  if pred.tier = 'extra' then
    entitled := exists (
      select 1
      from public.extra_pick_orders o
      where o.user_id = (select auth.uid())
        and o.status = 'active'
        and pred.fixture_id = any(o.fixture_ids)
    );
  else
    entitled := rank_of <= st.pick_limit;
  end if;

  select * into stats
  from public.fixture_stats
  where fixture_id = pred.fixture_id
  order by fetched_at desc
  limit 1;

  return jsonb_build_object(
    'pick', app.pick_json_gated(pred, entitled),
    'stats', case
      when stats.id is null then null
      else jsonb_build_object(
        'homeForm', stats.home_form,
        'awayForm', stats.away_form,
        'h2hHomeWins', stats.h2h_home_wins,
        'h2hAwayWins', stats.h2h_away_wins,
        'h2hDraws', stats.h2h_draws,
        'h2hAvgGoals', stats.h2h_avg_goals,
        'h2hBttsRate', stats.h2h_btts_rate,
        'homeSeason', stats.home_season,
        'awaySeason', stats.away_season,
        'h2hMatches', stats.h2h_matches,
        'homeRecentMatches', stats.home_recent_matches,
        'awayRecentMatches', stats.away_recent_matches
      )
    end,
    'lineups', (
      select jsonb_build_object(
        'home', (
          select jsonb_build_object(
            'formation', ln.formation, 'coach', ln.coach,
            'startXI', ln.start_xi, 'substitutes', ln.substitutes
          )
          from public.fixture_lineups ln
          where ln.fixture_id = fx.id and ln.team_id = fx.home_team_id
        ),
        'away', (
          select jsonb_build_object(
            'formation', ln.formation, 'coach', ln.coach,
            'startXI', ln.start_xi, 'substitutes', ln.substitutes
          )
          from public.fixture_lineups ln
          where ln.fixture_id = fx.id and ln.team_id = fx.away_team_id
        )
      )
    ),
    'hasFullAccess', st.has_full_access,
    'isFirstDay', st.is_first_day
  );
end;
$$;
