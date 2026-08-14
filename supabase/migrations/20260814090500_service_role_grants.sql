-- ============================================================================
-- MoonOdds — service_role grants
--
-- The RLS migration does `revoke all ... from anon, authenticated` and then
-- hands back exactly what each client surface needs. That default-deny stance
-- is right, but it left service_role holding nothing: these tables are created
-- by migrations rather than through the dashboard, so Supabase's default
-- privileges never applied to them.
--
-- The symptom is nasty precisely because it fails safe — the pipeline read
-- zero rows from every table and reported "no active engine config" instead of
-- raising. PostgREST was clear about it once asked directly:
--   permission denied for table ai_engine_config
--
-- service_role is the trusted server identity. It is never exposed to a
-- browser, it bypasses RLS by design, and only the cron/checkout route handlers
-- hold its key.
-- ============================================================================

grant usage on schema public to service_role;

grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
grant all privileges on all functions in schema public to service_role;

-- Anything a later migration creates should inherit the same access.
alter default privileges in schema public
  grant all on tables to service_role;
alter default privileges in schema public
  grant all on sequences to service_role;
alter default privileges in schema public
  grant all on functions to service_role;

-- The private helper schema, for the job-queue functions the drain worker calls.
grant usage on schema app to service_role;
grant all privileges on all functions in schema app to service_role;
alter default privileges in schema app
  grant all on functions to service_role;

-- The job-queue helpers are called over PostgREST by the drain route, which
-- authenticates as service_role. Expose thin public wrappers rather than the
-- app schema itself, so the surface stays deliberate.
create or replace function public.claim_jobs(batch_size integer default 20)
returns setof public.jobs
language sql
security definer
set search_path = ''
as $$
  select * from app.claim_jobs(batch_size);
$$;

create or replace function public.complete_job(job_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select app.complete_job(job_id);
$$;

create or replace function public.fail_job(job_id uuid, err text)
returns void
language sql
security definer
set search_path = ''
as $$
  select app.fail_job(job_id, err);
$$;

-- Explicitly NOT callable by browser roles: these mutate the queue.
revoke all on function public.claim_jobs(integer) from public, anon, authenticated;
revoke all on function public.complete_job(uuid) from public, anon, authenticated;
revoke all on function public.fail_job(uuid, text) from public, anon, authenticated;

grant execute on function public.claim_jobs(integer) to service_role;
grant execute on function public.complete_job(uuid) to service_role;
grant execute on function public.fail_job(uuid, text) to service_role;
grant execute on function public.create_slip(uuid, slip_type, numeric, jsonb) to service_role;
grant execute on function public.activate_daily_pass(uuid, text) to service_role;
grant execute on function public.activate_extra_picks(uuid, text, uuid[], uuid[]) to service_role;
grant execute on function public.apply_tuning_report(uuid, text) to service_role;
