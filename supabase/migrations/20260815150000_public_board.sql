-- The board becomes the front door.
--
-- With the marketing page gone, / is the prediction board for everyone,
-- signed in or not. That changes what the picks RPCs have to return: instead of
-- silently dropping the rows a viewer hasn't paid for, they now return every
-- row, with the AI content stripped from the ones the viewer isn't entitled to.
--
-- The security property that mattered before still holds exactly: a prediction
-- the viewer may not see is never serialised into the response. The difference
-- is that its *fixture* is — the teams, kickoff, venue and league are public
-- football facts we don't own and have no business hiding, and showing them is
-- what makes a locked card informative rather than a blurred rectangle.
--
-- Settled picks are exempt from locking entirely. get_recent_results already
-- publishes them in full to anyone, on the reasoning that a called shot whose
-- outcome is known is a track record rather than a product. Keeping that rule
-- consistent here avoids the absurdity of a pick being public on one endpoint
-- and locked on another.

-- ---------------------------------------------------------------------------
-- The locked projection
-- ---------------------------------------------------------------------------

/**
 * A prediction with everything we sell removed.
 *
 * Deliberately absent: predicted_value, confidence_score, staking_unit,
 * frontier_explanation, reasoning_tags, filters_applied, the alt_* market, and
 * odds. Odds in particular have to go — a price next to a known market lets you
 * infer the selection, which would hand over the call for free.
 *
 * prediction_type stays. The market alone ("both teams to score") names the
 * question without answering it, and a locked card that can say which question
 * we answered is honest advertising rather than a blank.
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
    'predictionType', p.prediction_type,
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

/** Full payload when entitled or already settled, stripped otherwise. */
create or replace function app.pick_json_gated(
  p public.predictions,
  entitled boolean
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when entitled or p.status in ('won', 'lost')
      then app.pick_json(p)
    else app.pick_json_locked(p)
  end;
$$;

-- ---------------------------------------------------------------------------
-- Board RPCs, now returning the whole board
-- ---------------------------------------------------------------------------

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
begin
  select * into st from app.access_state();

  select count(*) into total
  from public.predictions p
  join public.fixtures f on f.id = p.fixture_id
  where f.fixture_date >= start_ts and f.fixture_date < end_ts;

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
    where f.fixture_date >= start_ts and f.fixture_date < end_ts
  ) r;

  return jsonb_build_object(
    'picks', visible,
    'totalCount', total,
    'visibleCount', least(greatest(st.pick_limit, 0), total),
    'hasFullAccess', st.has_full_access,
    'isFirstDay', st.is_first_day,
    'freePickLimit', case when st.pick_limit > 1000000 then 0 else st.pick_limit end
  );
end;
$$;

create or replace function public.get_picks_by_status(filter text)
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
begin
  if filter not in ('all', 'upcoming', 'live', 'settled') then
    raise exception 'unknown filter %', filter using errcode = '22023';
  end if;

  select * into st from app.access_state();

  select count(*) into total
  from public.predictions p
  join public.fixtures f on f.id = p.fixture_id
  where case filter
    when 'upcoming' then p.status = 'pending' and f.status = 'scheduled'
    when 'live'     then p.status = 'pending' and f.status = 'live'
    when 'settled'  then p.status in ('won', 'lost')
    else true
  end;

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
    where case filter
      when 'upcoming' then p.status = 'pending' and f.status = 'scheduled'
      when 'live'     then p.status = 'pending' and f.status = 'live'
      when 'settled'  then p.status in ('won', 'lost')
      else true
    end
    order by p.confidence_score desc
    limit 200
  ) r;

  return jsonb_build_object(
    'picks', visible,
    'totalCount', total,
    'visibleCount', least(greatest(st.pick_limit, 0), total),
    'hasFullAccess', st.has_full_access,
    'isFirstDay', st.is_first_day,
    'freePickLimit', case when st.pick_limit > 1000000 then 0 else st.pick_limit end
  );
end;
$$;
