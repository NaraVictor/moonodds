-- ============================================================================
-- A league delete that fails on a foreign key rather than explaining itself
--
-- admin_delete_league removes the league's teams. fixtures.home_team_id and
-- away_team_id reference teams WITHOUT a cascade, so if any fixture in another
-- competition names one of those teams, the delete aborts on a raw constraint
-- violation and the operator gets "update or delete on table teams violates
-- foreign key constraint" with no idea which fixture or what to do.
--
-- Nothing in the catalogue trips it today — 155 fixtures, none referencing a
-- team from another league — but the two competitions most likely to are
-- already imported: a Super Cup and an All-Star game exist precisely to put
-- teams from elsewhere on a fixture. It is a matter of the next fetch.
--
-- So it is checked before anything is deleted, and refused with the number of
-- blocking fixtures. Refusing beats the alternatives: deleting another
-- competition's fixtures to clear the way would destroy data the operator did
-- not ask about, and nulling the reference is not possible on a not-null
-- column.
--
-- The footprint reports the same figure, so the block is visible in the
-- confirmation rather than discovered by pressing the button.
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
    ),
    -- Fixtures in OTHER competitions that name one of this league's teams.
    -- Any of these blocks the delete.
    'blockedBy', (
      select count(*) from public.fixtures f
      where f.league_id <> p_league_id
        and (
          f.home_team_id in (select id from public.teams where league_id = p_league_id)
          or f.away_team_id in (select id from public.teams where league_id = p_league_id)
        )
    )
  ) into result;

  return result;
end;
$$;

revoke all on function public.admin_league_footprint(uuid) from public, anon, authenticated;
grant execute on function public.admin_league_footprint(uuid) to service_role;

create or replace function public.admin_delete_league(p_league_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  slips   uuid[];
  s       uuid;
  blocked integer;
  n_pred  integer;
  n_fix   integer;
  n_team  integer;
  emptied integer := 0;
begin
  if not ((select app.is_super_admin()) or (select auth.role()) = 'service_role') then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select count(*) into blocked
  from public.fixtures f
  where f.league_id <> p_league_id
    and (
      f.home_team_id in (select id from public.teams where league_id = p_league_id)
      or f.away_team_id in (select id from public.teams where league_id = p_league_id)
    );

  if blocked > 0 then
    raise exception
      '% fixtures in other competitions name teams from this league. Delete or reassign those fixtures first.',
      blocked
      using errcode = '23503';
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
    if not exists (select 1 from public.slip_legs where slip_id = s) then
      delete from public.slips where id = s;
      emptied := emptied + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'deleted', true,
    'predictions', n_pred,
    'fixtures', n_fix,
    'teams', n_team,
    'slipsRepaired', coalesce(array_length(slips, 1), 0) - emptied,
    'slipsRemoved', emptied
  );
end;
$$;

revoke all on function public.admin_delete_league(uuid) from public, anon, authenticated;
grant execute on function public.admin_delete_league(uuid) to service_role;
