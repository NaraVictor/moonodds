-- ============================================================================
-- Kicka, carry odds on the pick payload
--
-- The bet slip needs a price per leg. Deriving one from the confidence score
-- (1/p) was wrong and looked it: a 97%-confidence call became 1.03, and an
-- accumulator of strong picks barely cleared 1.10.
--
-- Model confidence is not market probability. The engine can be far more
-- certain than the book, that gap IS the edge, and collapsing it to 1/p
-- destroys exactly the number a slip exists to show.
--
-- odds_snapshots already carries a real price per prediction, so use it, and
-- fall back to a market-shaped estimate only when no snapshot exists.
-- ============================================================================

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
    -- Real price where we have one; otherwise a plausible market number that
    -- shortens as confidence rises, without ever collapsing toward 1.0.
    'odds', coalesce(
      (select round(o.pick_odds, 2)
       from public.odds_snapshots o
       where o.prediction_id = p.id and o.pick_odds is not null
       order by o.captured_at desc
       limit 1),
      round((2.60 - (p.confidence_score - 7.0) * 0.28)::numeric, 2)
    ),
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
