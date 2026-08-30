-- ============================================================================
-- Every function this project has added since day one was callable by anyone
--
-- Supabase ships a default-privileges rule on the public schema that grants
-- EXECUTE on new functions to anon, authenticated and service_role. Not the
-- PUBLIC pseudo-role — three named grants, written onto every function at
-- creation. This project revoked them once, in 20260814090100, and that
-- statement covered the functions that existed that day and nothing since.
-- Fifty migrations and roughly forty functions later, each one arrived with
-- `anon=X` on its ACL.
--
-- (Checked rather than assumed: the ACL on backtest_thresholds reads
-- `postgres=X/postgres ; anon=X/postgres ; authenticated=X/postgres ;
-- service_role=X/postgres`. A first attempt at this migration revoked from
-- PUBLIC, which changed nothing, and its own assertion caught that.)
--
-- MOSTLY THIS DID NOT MATTER, AND ONCE IT DID
--
-- A function that reads auth.uid() returns nothing to a caller who has none,
-- and every Office function raises on app.is_super_admin(). That is why forty
-- open functions produced no leak.
--
-- backtest_thresholds is the exception. It had no guard — the only Office
-- read without one — so an anonymous request returned the engine's win rate,
-- ROI, units staked, and the record of the calls BELOW the publish floor.
-- Confirmed by calling it with the anon key: it answered.
--
-- THE FIX IS IN THREE PARTS AND THE THIRD IS THE ONE THAT LASTS
--
--   1. Guard backtest_thresholds like its siblings.
--   2. Revoke EXECUTE from anon and authenticated across the schema, then
--      re-grant exactly the intended set. The list below was derived from
--      every explicit grant in migration history, plus the six client reads
--      that had been living on the Supabase default without one.
--   3. Change the default so the next function added is not world-callable
--      for however long it takes somebody to notice.
--
-- The assertion at the end names every RPC the application calls. If this
-- migration ever takes away something the app needs, it fails here rather
-- than in front of a customer.
-- ============================================================================

-- --------------------------------------------------------------------------
-- 1. The Office backtest becomes an Office function.
-- --------------------------------------------------------------------------
create or replace function public.backtest_thresholds(
  p_floor numeric default null,
  p_unit1 numeric default null,
  p_unit2 numeric default null,
  p_unit3 numeric default null,
  p_unit4 numeric default null,
  p_unit5 numeric default null,
  p_markets text[] default null,
  p_days integer default 90
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  -- Every other Office read checks this. This one never did, and combined with
  -- PostgreSQL's default EXECUTE-to-PUBLIC that made the engine's calibration
  -- readable to anyone at all, signed in or not.
  if not (select app.is_super_admin()) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

with cfg as (
    select
      coalesce(p_floor, 7.0) as floor,
      coalesce(p_unit1, 5.0) as u1,
      coalesce(p_unit2, 6.0) as u2,
      coalesce(p_unit3, 7.0) as u3,
      coalesce(p_unit4, 8.0) as u4,
      coalesce(p_unit5, 9.0) as u5
  ),
  universe as (
    select p.id, p.status, p.confidence_score, p.prediction_type::text as market,
           app.pick_price(p) as price
    from public.predictions p
    where p.status in ('won', 'lost')
      and p.tier = 'primary'
      and p.settled_at > now() - make_interval(days => greatest(coalesce(p_days, 90), 1))
      and (p_markets is null or p.prediction_type::text = any(p_markets))
  ),
  -- What the tier filter removed, reported rather than hidden. The floor is
  -- not what puts a pick in the basket — rank is — so these are settled calls
  -- ABOVE the floor that this backtest can no longer see. If that number is
  -- large, the sweep is reasoning from a fraction of the evidence.
  excluded as (
    select count(*) as n
    from public.predictions p
    where p.status in ('won', 'lost')
      and p.tier = 'extra'
      and p.settled_at > now() - make_interval(days => greatest(coalesce(p_days, 90), 1))
      and (p_markets is null or p.prediction_type::text = any(p_markets))
  ),
  selected as (
    select u.*,
           case
             when u.confidence_score >= c.u5 then 5
             when u.confidence_score >= c.u4 then 4
             when u.confidence_score >= c.u3 then 3
             when u.confidence_score >= c.u2 then 2
             else 1
           end as units
    from universe u cross join cfg c
    where u.confidence_score >= c.floor
  )
  select jsonb_build_object(
    'candidates', (select count(*) from universe),
    'excludedExtras', (select n from excluded),
    'published',  (select count(*) from selected),
    'won',        (select count(*) from selected where status = 'won'),
    'lost',       (select count(*) from selected where status = 'lost'),
    'winRate',    (select round(count(*) filter (where status = 'won')::numeric
                                / nullif(count(*), 0), 4) from selected),
    'winRateInterval', (
      select app.wilson_interval(
        (select count(*)::integer from selected where status = 'won'),
        (select count(*)::integer from selected)
      )
    ),
    -- Staked in units rather than flat, which is the point of having bands.
    'unitsStaked',  (select coalesce(sum(units), 0) from selected),
    'unitsReturned',(select coalesce(round(sum(units * price) filter (where status = 'won'), 2), 0) from selected),
    'roi', (
      select round(
        (coalesce(sum(units * price) filter (where status = 'won'), 0) - coalesce(sum(units), 0))
        / nullif(sum(units), 0), 4)
      from selected
    ),
    -- What the floor threw away. A floor that improves win rate by discarding
    -- every profitable longshot is not an improvement.
    'discarded', (
      select jsonb_build_object(
        'count', count(*),
        'winRate', round(count(*) filter (where status = 'won')::numeric
                         / nullif(count(*), 0), 4)
      )
      from universe u cross join cfg c where u.confidence_score < c.floor
    )
  )
  into result;

  return result;
end;
$$;

-- --------------------------------------------------------------------------
-- 2. Take back what was never granted deliberately, then say what is.
--
-- Order matters: the revoke is broad and the grants that follow are the whole
-- of the intended surface. Anything not named below is service_role only,
-- which is what a function called from a server route wants to be.
-- --------------------------------------------------------------------------
revoke execute on all functions in schema public from anon, authenticated;
-- PUBLIC as well as the named roles. Supabase's default grants the three roles
-- explicitly, but PostgreSQL's own default grants PUBLIC, and anon inherits
-- anything PUBLIC holds — so revoking only the names leaves the second door
-- open on any function that picked up the stock default instead.
revoke execute on all functions in schema public from public;

-- Public reads: the board, the record, and the state that decides which.
grant execute on function public.filter_live_predictions(uuid[]) to anon, authenticated;
grant execute on function public.get_access_state() to anon, authenticated;
grant execute on function public.get_clv_summary() to anon, authenticated;
grant execute on function public.get_engine_stats() to anon, authenticated;
grant execute on function public.get_history_facets() to anon, authenticated;
grant execute on function public.get_history_stats(text, text) to anon, authenticated;
grant execute on function public.get_league_performance() to anon, authenticated;
grant execute on function public.get_picks_by_status(text) to anon, authenticated;
grant execute on function public.get_prediction_detail(uuid) to anon, authenticated;
grant execute on function public.get_prediction_history(integer, integer, text, text, text) to anon, authenticated;
grant execute on function public.get_recent_results(integer) to anon, authenticated;
grant execute on function public.get_status_counts() to anon, authenticated;
grant execute on function public.get_tipster_performance() to anon, authenticated;
grant execute on function public.get_todays_picks(timestamptz, timestamptz) to anon, authenticated;

-- Signed in only. Each of these is scoped by auth.uid() or by
-- app.is_super_admin() inside the function body.
grant execute on function public.backtest_thresholds(numeric, numeric, numeric, numeric, numeric, numeric, text[], integer) to authenticated;
grant execute on function public.can_purchase(numeric) to authenticated;
grant execute on function public.delete_slip(uuid) to authenticated;
grant execute on function public.export_my_data() to authenticated;
grant execute on function public.get_admin_predictions() to authenticated;
grant execute on function public.get_dashboard_metrics(timestamptz, timestamptz) to authenticated;
grant execute on function public.get_extra_pick_offer() to authenticated;
grant execute on function public.get_my_extra_picks() to authenticated;
grant execute on function public.get_my_league_performance() to authenticated;
grant execute on function public.get_my_slip_stats() to authenticated;
grant execute on function public.get_my_slips() to authenticated;
grant execute on function public.get_play_limits() to authenticated;
grant execute on function public.get_prediction_report(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.get_profile_stats() to authenticated;
grant execute on function public.get_stuck_queue() to authenticated;
grant execute on function public.get_user_picks_report() to authenticated;
grant execute on function public.raise_dispute(uuid, text) to authenticated;
grant execute on function public.remove_slip_leg(uuid) to authenticated;
grant execute on function public.set_play_limits(numeric, integer) to authenticated;
grant execute on function public.set_self_exclusion(integer) to authenticated;

-- --------------------------------------------------------------------------
-- 3. And for everything written from here on.
-- --------------------------------------------------------------------------
alter default privileges in schema public revoke execute on functions from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public;

-- --------------------------------------------------------------------------
-- 4. Prove it, both directions.
-- --------------------------------------------------------------------------
do $$
declare
  needed text[] := array[
    'public.get_access_state()',
    'public.get_todays_picks(timestamptz, timestamptz)',
    'public.get_picks_by_status(text)',
    'public.get_engine_stats()',
    'public.get_recent_results(integer)',
    'public.get_status_counts()',
    'public.get_history_stats(text, text)',
    'public.get_history_facets()',
    'public.get_prediction_history(integer, integer, text, text, text)',
    'public.get_prediction_detail(uuid)',
    'public.get_league_performance()',
    'public.get_clv_summary()',
    'public.get_tipster_performance()',
    'public.filter_live_predictions(uuid[])'
  ];
  signed_in text[] := array[
    'public.get_my_extra_picks()',
    'public.get_my_slips()',
    'public.get_my_slip_stats()',
    'public.get_profile_stats()',
    'public.get_my_league_performance()',
    'public.get_extra_pick_offer()',
    'public.get_play_limits()',
    'public.can_purchase(numeric)',
    'public.export_my_data()',
    'public.delete_slip(uuid)',
    'public.remove_slip_leg(uuid)',
    'public.set_play_limits(numeric, integer)',
    'public.set_self_exclusion(integer)',
    'public.raise_dispute(uuid, text)',
    'public.get_admin_predictions()',
    'public.get_dashboard_metrics(timestamptz, timestamptz)',
    'public.get_prediction_report(uuid, timestamptz, timestamptz)',
    'public.get_user_picks_report()',
    'public.get_stuck_queue()',
    'public.backtest_thresholds(numeric, numeric, numeric, numeric, numeric, numeric, text[], integer)'
  ];
  service_only text[] := array[
    'public.claim_jobs(integer)',
    'public.complete_job(uuid)',
    'public.fail_job(uuid, text)',
    'public.create_slip(uuid, slip_type, numeric, jsonb)',
    'public.activate_daily_pass(uuid, text)',
    'public.activate_extra_picks(uuid, text, uuid[])',
    'public.set_fx_fallback(numeric)',
    'public.get_fx_fallback()',
    'public.get_deploy_settings()'
  ];
  f text;
begin
  foreach f in array needed loop
    if not has_function_privilege('anon', f, 'execute') then
      raise exception 'the revoke took a public read the board needs: %', f;
    end if;
  end loop;

  foreach f in array signed_in loop
    if not has_function_privilege('authenticated', f, 'execute') then
      raise exception 'the revoke took a signed-in read the app needs: %', f;
    end if;
    if has_function_privilege('anon', f, 'execute') then
      raise exception 'still reachable without signing in: %', f;
    end if;
  end loop;

  foreach f in array service_only loop
    if not has_function_privilege('service_role', f, 'execute') then
      raise exception 'the revoke took a service function: %', f;
    end if;
    if has_function_privilege('anon', f, 'execute') then
      raise exception 'a service-only function is reachable by anon: %', f;
    end if;
  end loop;
end;
$$;
