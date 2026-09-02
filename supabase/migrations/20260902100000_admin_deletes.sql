-- ============================================================================
-- Deleting a prediction, and deleting a league, without corrupting a slip
--
-- slip_legs.prediction_id cascades on delete. So removing a prediction already
-- removed it from every customer slip carrying it — silently, leaving
-- slips.leg_count and combined_odds describing a slip that no longer exists.
-- That is why the route refused to delete anything settled or slipped: not
-- because deletion is wrong, but because nothing put the slips back together
-- afterwards.
--
-- app.refresh_slip already recomputes a slip from its remaining legs. These
-- capture which slips are affected BEFORE the cascade fires, delete, and then
-- refresh each one — so a slip that loses a leg comes out consistent instead
-- of merely smaller.
--
-- The published record needs no repair. get_history_stats, get_engine_stats
-- and get_daily_results all compute from the predictions table on read, so a
-- deleted pick leaves the win rate, the settled count and the market
-- breakdown correct the moment it is gone. Nothing is cached and there is no
-- stored total to reconcile.
-- ============================================================================

create or replace function public.admin_delete_prediction(p_prediction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  slips uuid[];
  s     uuid;
  legs  integer;
begin
  if not ((select app.is_super_admin()) or (select auth.role()) = 'service_role') then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  -- Captured first: the cascade destroys the evidence of which slips to fix.
  select coalesce(array_agg(distinct slip_id), '{}')
  into slips
  from public.slip_legs
  where prediction_id = p_prediction_id;

  legs := coalesce(array_length(slips, 1), 0);

  delete from public.predictions where id = p_prediction_id;

  foreach s in array slips loop
    perform app.refresh_slip(s);
  end loop;

  return jsonb_build_object('deleted', true, 'slipsRepaired', legs);
end;
$$;

revoke all on function public.admin_delete_prediction(uuid) from public, anon, authenticated;
grant execute on function public.admin_delete_prediction(uuid) to service_role;

-- ============================================================================
-- What a league takes with it
--
-- leagues cascades to teams AND to fixtures, and fixtures cascade to
-- predictions, odds snapshots and slip legs. Deleting one league can therefore
-- remove settled history and legs from live customer slips, and the operator
-- pressing the button cannot see any of that from the catalogue row.
--
-- So there are two functions. This one only counts, for a confirmation that
-- states the damage in numbers before anybody agrees to it.
-- ============================================================================
create or replace function public.admin_league_footprint(p_league_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not ((select app.is_super_admin()) or (select auth.role()) = 'service_role') then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'league', (select name from public.leagues where id = p_league_id),
    'teams', (select count(*) from public.teams where league_id = p_league_id),
    'fixtures', (select count(*) from public.fixtures where league_id = p_league_id),
    'predictions', (
      select count(*) from public.predictions p
      join public.fixtures f on f.id = p.fixture_id
      where f.league_id = p_league_id
    ),
    'settled', (
      select count(*) from public.predictions p
      join public.fixtures f on f.id = p.fixture_id
      where f.league_id = p_league_id and p.status in ('won', 'lost', 'void')
    ),
    'slipLegs', (
      select count(*) from public.slip_legs sl
      join public.predictions p on p.id = sl.prediction_id
      join public.fixtures f on f.id = p.fixture_id
      where f.league_id = p_league_id
    )
  ) into result;

  return result;
end;
$$;

revoke all on function public.admin_league_footprint(uuid) from public, anon, authenticated;
grant execute on function public.admin_league_footprint(uuid) to service_role;

-- ============================================================================
-- And this one does it, in an order the foreign keys allow
--
-- fixtures.home_team_id references teams WITHOUT cascade, so letting the
-- league cascade run unaided means the database resolving teams and fixtures
-- in whatever order it chooses. Explicit and ordered instead: predictions,
-- then fixtures, then teams, then the league. One transaction, so a failure
-- part-way leaves the catalogue as it was rather than half-deleted.
-- ============================================================================
create or replace function public.admin_delete_league(p_league_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  slips uuid[];
  s     uuid;
  n_pred integer;
  n_fix  integer;
  n_team integer;
begin
  if not ((select app.is_super_admin()) or (select auth.role()) = 'service_role') then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct sl.slip_id), '{}')
  into slips
  from public.slip_legs sl
  join public.predictions p on p.id = sl.prediction_id
  join public.fixtures f on f.id = p.fixture_id
  where f.league_id = p_league_id;

  with gone as (
    delete from public.predictions p
    using public.fixtures f
    where f.id = p.fixture_id and f.league_id = p_league_id
    returning p.id
  )
  select count(*) into n_pred from gone;

  with gone as (
    delete from public.fixtures where league_id = p_league_id returning id
  )
  select count(*) into n_fix from gone;

  with gone as (
    delete from public.teams where league_id = p_league_id returning id
  )
  select count(*) into n_team from gone;

  delete from public.leagues where id = p_league_id;

  foreach s in array slips loop
    perform app.refresh_slip(s);
  end loop;

  return jsonb_build_object(
    'deleted', true,
    'predictions', n_pred,
    'fixtures', n_fix,
    'teams', n_team,
    'slipsRepaired', coalesce(array_length(slips, 1), 0)
  );
end;
$$;

revoke all on function public.admin_delete_league(uuid) from public, anon, authenticated;
grant execute on function public.admin_delete_league(uuid) to service_role;
