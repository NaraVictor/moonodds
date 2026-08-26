-- ============================================================================
-- The match clock, and real team sheets
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The live minute
--
-- A card for a match in progress said "Kicked off 3:00 PM", which is the one
-- fact a viewer already has. What they want is the minute, and no elapsed
-- figure existed anywhere in this stack.
--
-- It is stored rather than derived. A minute computed from kickoff drifts as
-- soon as anything interrupts play: it counts through half time, cannot see
-- stoppage, and has no way to say a match is suspended. The feed reports all
-- three and the poller already runs every fifteen seconds.
--
-- status_short is API-Football's own code (1H, HT, 2H, ET, BT, P, FT). Kept
-- unmapped beside our three-state status because "HT" and "67th minute" are
-- both `live` to us and must not render identically.
-- ---------------------------------------------------------------------------

alter table public.fixtures
  add column if not exists elapsed_minutes integer,
  add column if not exists elapsed_extra   integer,
  add column if not exists status_short    text;

comment on column public.fixtures.elapsed_minutes is
  'Minutes played, from the feed. Never derived from kickoff time — that drifts through half time and stoppage.';
comment on column public.fixtures.elapsed_extra is
  'Stoppage minutes on top of elapsed_minutes, so 45 + 2 renders as 45+2. Null outside stoppage.';
comment on column public.fixtures.status_short is
  'API-Football status code: 1H, HT, 2H, ET, BT, P, FT and so on. Finer than fixtures.status by design.';

-- ---------------------------------------------------------------------------
-- 2. Line-ups
--
-- The detail page has carried a hard-coded placeholder since it was written,
-- because `lineups` sits in the pipeline's list of feeds nothing fetches. The
-- placeholder was honest about it, but it could never populate no matter how
-- close to kickoff you looked.
--
-- One row per side per fixture. The XI and the bench are jsonb rather than a
-- players table: nothing joins on a player, nothing aggregates across fixtures,
-- and a normalised squad would be a second catalogue to keep in step with the
-- feed for no query anybody runs.
-- ---------------------------------------------------------------------------

create table if not exists public.fixture_lineups (
  fixture_id   uuid not null references public.fixtures (id) on delete cascade,
  team_id      uuid not null references public.teams (id) on delete cascade,
  formation    text,
  coach        text,
  start_xi     jsonb not null default '[]'::jsonb,
  substitutes  jsonb not null default '[]'::jsonb,
  fetched_at   timestamptz not null default now(),
  primary key (fixture_id, team_id)
);

create index if not exists fixture_lineups_fixture_idx
  on public.fixture_lineups (fixture_id);

alter table public.fixture_lineups enable row level security;

-- Readable by everyone, like fixtures and teams: a team sheet is published by
-- the clubs and is not part of what a day pass buys.
create policy fixture_lineups_read on public.fixture_lineups
  for select to anon, authenticated using (true);

grant select on public.fixture_lineups to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Carry both onto the pick payload
--
-- pick_json is the single projection every pick-returning RPC shares, so the
-- clock and the sheet reach the card, the board and the detail page from one
-- place and cannot disagree between them.
-- ---------------------------------------------------------------------------

create or replace function app.pick_json(p public.predictions)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'predictionType', p.prediction_type,
    'predictedValue', p.predicted_value,
    'confidenceScore', p.confidence_score,
    'stakingUnit', p.staking_unit,
    'reasoning', p.frontier_explanation,
    'status', p.status,
    'reasoningTags', p.reasoning_tags,
    'altMarket', p.alt_market,
    'altPredictedValue', p.alt_predicted_value,
    'altConfidence', p.alt_confidence,
    'filtersApplied', p.filters_applied,
    'actualResult', p.actual_result,
    'settledAt', p.settled_at,
    'odds', app.pick_odds(p.id),
    'fixture', jsonb_build_object(
      'id', f.id,
      'date', f.fixture_date,
      'status', f.status,
      'venue', f.venue,
      'round', f.round,
      'homeGoals', f.home_goals,
      'awayGoals', f.away_goals,
      'elapsed', f.elapsed_minutes,
      'elapsedExtra', f.elapsed_extra,
      'statusShort', f.status_short
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

-- ---------------------------------------------------------------------------
-- 4. Fetch line-ups as kickoff approaches
--
-- Clubs publish roughly 20-40 minutes out, so this runs every five minutes and
-- the handler only asks about fixtures inside that window. Same guard as the
-- live poller: no fixture in range means no upstream call.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from cron.job where jobname = 'kicka_fetch_lineups') then
    perform cron.unschedule('kicka_fetch_lineups');
  end if;
end;
$$;

select cron.schedule(
  'kicka_fetch_lineups',
  '*/5 * * * *',
  $$select app.call_endpoint('/api/cron/fetch-lineups')$$
);

-- ---------------------------------------------------------------------------
-- 5. Hand the detail page its team sheets
--
-- get_prediction_detail already assembles everything that page needs in one
-- call. Line-ups join it rather than becoming a second round trip, keyed by
-- side so the page never has to work out which row is the home team.
--
-- Deliberately OUTSIDE the entitlement gate. A team sheet is published by the
-- clubs and reported everywhere; withholding it would not protect anything and
-- would make a locked page look broken rather than locked. The call, the
-- confidence and the reasoning remain gated by pick_json_gated above.
-- ---------------------------------------------------------------------------

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
  where f2.fixture_date::date = f1.fixture_date::date
    and p2.confidence_score > pred.confidence_score;

  entitled := rank_of <= st.pick_limit;

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

grant execute on function public.get_prediction_detail(uuid) to anon, authenticated;
