-- ============================================================================
-- Kicka, row level security and the gated-picks RPC
--
-- THE CENTRAL CONSTRAINT OF THIS FILE:
--
-- In the Convex app, `predictions` was unreachable except through query
-- functions that called getAccessState first. Postgres has no such guarantee,
-- if the table is granted to `authenticated`, any signed-in user can read every
-- locked pick straight from the browser with one PostgREST call, and the
-- paywall is decoration.
--
-- So: predictions is granted to NOBODY. Reads go through SECURITY DEFINER RPCs
-- that reproduce the original gating logic in one auditable place.
--
-- The free tier ("top 2 by confidence on your first day") is rank-based, which
-- RLS cannot express, a row policy decides WHICH rows you see, not HOW MANY.
-- That is the second reason the RPC exists rather than a policy.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helpers (private schema, never exposed through the Data API)
-- ---------------------------------------------------------------------------

-- Read the admin flag from profiles, not from the JWT. app_metadata claims go
-- stale until a token refresh, and user_metadata is user-writable outright.
create or replace function app.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.is_super_admin from public.profiles p where p.id = (select auth.uid())),
    false
  );
$$;

create or replace function app.is_suspended()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select p.is_suspended from public.profiles p where p.id = (select auth.uid())),
    false
  );
$$;

create or replace function app.utc_today()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'utc')::date;
$$;

/**
 * The single source of truth for pick access. Mirrors getAccessState():
 *   suspended        -> nothing, regardless of any pass
 *   super-admin      -> everything
 *   active pass today-> everything
 *   first day only   -> FREE_PICK_LIMIT picks
 *   otherwise        -> nothing
 */
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
  if uid is null then
    return query select false, false, 0;
    return;
  end if;

  select * into prof from public.profiles p where p.id = uid;

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

  return query select false, false, 0;
end;
$$;

-- Shared projection so every pick-returning RPC agrees on shape.
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

-- ---------------------------------------------------------------------------
-- Public RPCs
--
-- Every one of these is SECURITY DEFINER, which means it bypasses RLS and is
-- callable by anon/authenticated by default. Each therefore does its own
-- authorization in the body, that is not optional here.
-- ---------------------------------------------------------------------------

/**
 * Today's picks, already gated. Returns the full count so the UI can say
 * "3 of 11 shown" without ever receiving the 8 it may not display.
 */
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

  if st.pick_limit <= 0 then
    visible := '[]'::jsonb;
  else
    select coalesce(jsonb_agg(app.pick_json(p) order by p.confidence_score desc), '[]'::jsonb)
    into visible
    from (
      select p.*
      from public.predictions p
      join public.fixtures f on f.id = p.fixture_id
      where f.fixture_date >= start_ts and f.fixture_date < end_ts
      order by p.confidence_score desc
      limit st.pick_limit
    ) p;
  end if;

  return jsonb_build_object(
    'picks', visible,
    'totalCount', total,
    'hasFullAccess', st.has_full_access,
    'isFirstDay', st.is_first_day,
    'freePickLimit', case when st.pick_limit > 1000000 then 0 else st.pick_limit end
  );
end;
$$;

/** Picks filtered by lifecycle state, gated identically. */
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

  if st.pick_limit <= 0 then
    visible := '[]'::jsonb;
  else
    select coalesce(jsonb_agg(app.pick_json(p) order by p.confidence_score desc), '[]'::jsonb)
    into visible
    from (
      select p.*
      from public.predictions p
      join public.fixtures f on f.id = p.fixture_id
      where case filter
        when 'upcoming' then p.status = 'pending' and f.status = 'scheduled'
        when 'live'     then p.status = 'pending' and f.status = 'live'
        when 'settled'  then p.status in ('won', 'lost')
        else true
      end
      order by p.confidence_score desc
      limit least(st.pick_limit, 100)
    ) p;
  end if;

  return jsonb_build_object(
    'picks', visible,
    'totalCount', total,
    'hasFullAccess', st.has_full_access,
    'isFirstDay', st.is_first_day,
    'freePickLimit', case when st.pick_limit > 1000000 then 0 else st.pick_limit end
  );
end;
$$;

/**
 * The public track record. Settled picks only, the outcome is already known,
 * so there is nothing to gate, and the landing page needs it for guests.
 */
create or replace function public.get_recent_results(max_rows integer default 50)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(app.pick_json(p) order by p.settled_at desc), '[]'::jsonb)
  from (
    select * from public.predictions
    where status in ('won', 'lost')
    order by settled_at desc
    limit least(coalesce(max_rows, 50), 100)
  ) p;
$$;

/** Headline win rate / ROI / volume. Aggregates only, safe for guests. */
create or replace function public.get_engine_stats()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'winRate', case when count(*) = 0 then 0
                    else round(count(*) filter (where status = 'won')::numeric / count(*), 4) end,
    'totalPicks', count(*),
    'roi', case when coalesce(sum(staking_unit), 0) = 0 then 0
                else round((
                  sum(staking_unit) filter (where status = 'won') * 1.8
                  - coalesce(sum(staking_unit) filter (where status = 'lost'), 0)
                )::numeric / sum(staking_unit), 4) end
  )
  from public.predictions
  where status in ('won', 'lost');
$$;

/** Counts for the status filter chips. Aggregates only. */
create or replace function public.get_status_counts()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'all', count(*),
    'upcoming', count(*) filter (where p.status = 'pending' and f.status = 'scheduled'),
    'live', count(*) filter (where p.status = 'pending' and f.status = 'live'),
    'settled', count(*) filter (where p.status in ('won', 'lost'))
  )
  from public.predictions p
  join public.fixtures f on f.id = p.fixture_id;
$$;

/** Extra picks the caller has actually paid for today. */
create or replace function public.get_my_extra_picks()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(app.pick_json(p) order by p.confidence_score desc), '[]'::jsonb)
  from public.predictions p
  where (select auth.uid()) is not null
    and p.fixture_id in (
      select unnest(o.fixture_ids)
      from public.extra_pick_orders o
      where o.user_id = (select auth.uid())
        and o.date_key = (select app.utc_today())
        and o.status = 'active'
    );
$$;

/** Access state for the UI (paywall copy, badges). Never a gate by itself. */
create or replace function public.get_access_state()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'hasFullAccess', s.has_full_access,
    'isFirstDay', s.is_first_day,
    'freePickLimit', case when s.pick_limit > 1000000 then 0 else s.pick_limit end,
    'isSuperAdmin', (select app.is_super_admin()),
    'isSuspended', (select app.is_suspended())
  )
  from app.access_state() s;
$$;

-- ---------------------------------------------------------------------------
-- Grants
--
-- Default-deny, then hand back exactly what each surface needs.
-- ---------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from anon, authenticated;

-- Catalogue data is public knowledge (fixtures, teams, leagues); reading it
-- reveals nothing that isn't on a TV listing.
grant select on leagues, teams, fixtures to anon, authenticated;

-- Personal data: readable by its owner, enforced by policy below.
grant select, insert, update on slips to authenticated;
grant select, insert, delete on slip_legs to authenticated;
grant select on daily_passes, extra_pick_orders, payments to authenticated;
grant select, insert, update on notification_preferences to authenticated;
grant select, update on profiles to authenticated;

-- Admin surfaces, RLS restricts these to super-admins.
grant select on prediction_runs, odds_snapshots, league_performance_log,
                fixture_stats, tipsters to authenticated;
grant select, insert, update on ai_engine_config to authenticated;
grant select, update on tuning_reports to authenticated;
grant select on jobs to authenticated;

-- predictions is deliberately absent. It is reachable only via the RPCs above.

grant execute on function
  public.get_todays_picks(timestamptz, timestamptz),
  public.get_picks_by_status(text),
  public.get_recent_results(integer),
  public.get_engine_stats(),
  public.get_status_counts(),
  public.get_my_extra_picks(),
  public.get_access_state()
to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------

alter table profiles                enable row level security;
alter table leagues                 enable row level security;
alter table teams                   enable row level security;
alter table fixtures                enable row level security;
alter table fixture_stats           enable row level security;
alter table tipsters                enable row level security;
alter table prediction_runs         enable row level security;
alter table predictions             enable row level security;
alter table odds_snapshots          enable row level security;
alter table league_performance_log  enable row level security;
alter table slips                   enable row level security;
alter table slip_legs               enable row level security;
alter table notification_preferences enable row level security;
alter table payments                enable row level security;
alter table daily_passes            enable row level security;
alter table extra_pick_orders       enable row level security;
alter table ai_engine_config        enable row level security;
alter table tuning_reports          enable row level security;
alter table otp_tokens              enable row level security;
alter table jobs                    enable row level security;

-- predictions: RLS on, zero policies. Nothing but the service role and the
-- SECURITY DEFINER RPCs can see a row. This is intentional, do not add a
-- "readable by authenticated" policy here without re-reading the header.

-- ---------------------------------------------------------------------------
-- Policies, catalogue (public read)
-- ---------------------------------------------------------------------------

create policy leagues_read on leagues
  for select to anon, authenticated using (true);

create policy teams_read on teams
  for select to anon, authenticated using (true);

create policy fixtures_read on fixtures
  for select to anon, authenticated using (true);

create policy tipsters_read on tipsters
  for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------------
-- Policies, ownership
--
-- Every one pairs `TO authenticated` with an ownership predicate. `TO
-- authenticated` alone would be authentication without authorization: it checks
-- that you are *someone*, not that the row is *yours*.
-- ---------------------------------------------------------------------------

create policy profiles_read_own on profiles
  for select to authenticated
  using ((select auth.uid()) = id or (select app.is_super_admin()));

-- Note the WITH CHECK: without it a user could reassign their row's id, and
-- the privilege columns are protected by the separate trigger below.
create policy profiles_update_own on profiles
  for update to authenticated
  using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

create policy slips_own on slips
  for select to authenticated using ((select auth.uid()) = user_id);

create policy slips_insert_own on slips
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy slips_update_own on slips
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy slip_legs_own on slip_legs
  for select to authenticated
  using (exists (
    select 1 from slips s where s.id = slip_legs.slip_id and s.user_id = (select auth.uid())
  ));

create policy slip_legs_insert_own on slip_legs
  for insert to authenticated
  with check (exists (
    select 1 from slips s where s.id = slip_legs.slip_id and s.user_id = (select auth.uid())
  ));

create policy slip_legs_delete_own on slip_legs
  for delete to authenticated
  using (exists (
    select 1 from slips s where s.id = slip_legs.slip_id and s.user_id = (select auth.uid())
  ));

create policy passes_own on daily_passes
  for select to authenticated
  using ((select auth.uid()) = user_id or (select app.is_super_admin()));

create policy orders_own on extra_pick_orders
  for select to authenticated
  using ((select auth.uid()) = user_id or (select app.is_super_admin()));

create policy payments_own on payments
  for select to authenticated
  using ((select auth.uid()) = user_id or (select app.is_super_admin()));

create policy notif_read_own on notification_preferences
  for select to authenticated using ((select auth.uid()) = user_id);

create policy notif_insert_own on notification_preferences
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy notif_update_own on notification_preferences
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Policies, admin only
-- ---------------------------------------------------------------------------

create policy runs_admin on prediction_runs
  for select to authenticated using ((select app.is_super_admin()));

create policy odds_admin on odds_snapshots
  for select to authenticated using ((select app.is_super_admin()));

create policy league_perf_admin on league_performance_log
  for select to authenticated using ((select app.is_super_admin()));

create policy fixture_stats_admin on fixture_stats
  for select to authenticated using ((select app.is_super_admin()));

create policy config_admin_read on ai_engine_config
  for select to authenticated using ((select app.is_super_admin()));

create policy config_admin_write on ai_engine_config
  for update to authenticated
  using ((select app.is_super_admin()))
  with check ((select app.is_super_admin()));

create policy config_admin_insert on ai_engine_config
  for insert to authenticated with check ((select app.is_super_admin()));

create policy reports_admin_read on tuning_reports
  for select to authenticated using ((select app.is_super_admin()));

create policy reports_admin_write on tuning_reports
  for update to authenticated
  using ((select app.is_super_admin()))
  with check ((select app.is_super_admin()));

create policy jobs_admin on jobs
  for select to authenticated using ((select app.is_super_admin()));

-- otp_tokens has no policy at all: only the service role ever touches it.

-- ---------------------------------------------------------------------------
-- Privilege escalation guard
--
-- profiles_update_own lets a user edit their own row, which would otherwise let
-- them set is_super_admin = true on themselves. Freeze the privilege columns
-- for anyone who isn't already an admin.
-- ---------------------------------------------------------------------------

create or replace function app.guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- A null auth.uid() means there is no API caller at all: a direct database
  -- connection (seed, migration, psql, service-role job). That cannot be a
  -- privilege-escalation vector, because reaching this trigger through
  -- PostgREST requires passing profiles_update_own first, and that policy is
  -- `TO authenticated` with an ownership predicate, an anonymous request can
  -- never get here. So let those contexts through.
  if (select auth.uid()) is null
     or (select auth.role()) = 'service_role'
     or (select app.is_super_admin()) then
    return new;
  end if;

  if new.is_super_admin is distinct from old.is_super_admin
     or new.is_suspended is distinct from old.is_suspended then
    raise exception 'cannot modify privilege columns' using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger profiles_guard_privileges
  before update on profiles
  for each row execute function app.guard_profile_privileges();
