-- ============================================================================
-- A locked pick stops naming the market
--
-- pick_json_locked sent prediction_type, and the card rendered it: a locked
-- card said "Over/Under 2.5" above "Unlock to see the call".
--
-- The comment on that function argued it was honest advertising — the market
-- names the question without answering it. That holds for 1x2, where knowing
-- the question leaves three answers. It does not hold for the binary markets,
-- which are most of them: told the question is "Over/Under 2.5", a reader has a
-- coin flip, and a coin flip is a large fraction of what a day pass is for.
--
-- The application had already decided this. format.ts returns "Prediction
-- hidden" when the market is absent and its comment says a locked pick "now
-- says only that a call exists" — the market surviving in the RPC is what kept
-- that from being true. This makes the two agree, in the direction the app
-- already documented.
--
-- Also worth stating plainly, because it shapes the card design: what protects
-- a locked pick is that the value NEVER LEAVES THE DATABASE. Nothing on the
-- client can be relied on for this. A confidence score sent and then blurred in
-- CSS is readable by anyone who opens the inspector, so the blur on a locked
-- card is decoration over a placeholder — confidence_score has never been in
-- this payload and must not be added to it.
-- ============================================================================

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
    -- Deliberately absent: predictionType, predictedValue, confidenceScore,
    -- stakingUnit, reasoning, reasoningTags, filtersApplied, the alt_* market
    -- and odds. Everything below is public knowledge about the fixture.
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
