-- ============================================================================
-- The health check could not see the cron jobs it was counting
--
-- /api/health reported "NO scheduled jobs — nothing runs" while
-- `select jobname from cron.job` in the SQL editor returned all eleven, active,
-- owned by postgres. Both were reporting honestly; they were asking as
-- different users.
--
-- pg_cron puts row-level security on cron.job:
--
--     using (username = current_user)
--
-- get_deploy_settings is SECURITY DEFINER, so inside it `current_user` is the
-- FUNCTION OWNER, not the caller and not necessarily postgres. Where the owner
-- is anything other than the role that scheduled the jobs, the policy filters
-- every row and count(*) returns 0 — indistinguishable, to the health check,
-- from a database with no schedule at all.
--
-- That is the exact failure shape this project keeps hitting: absent and
-- invisible rendered as the same value. Two changes, because either alone
-- leaves it able to lie again.
--
--   1. Own the function as postgres, which is the role cron.schedule runs as in
--      every migration here, so the policy matches and the rows are visible.
--
--   2. Report WHO did the counting. A zero from a role that can see the table
--      means there are no jobs; a zero from a role that cannot means the check
--      is broken. The health route can now tell those apart, and so can anyone
--      reading the JSON.
-- ============================================================================

create or replace function public.get_deploy_settings()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'appBaseUrl', (select value from app.settings where key = 'app_base_url'),
    'cronSecretIsLocal', (
      select value = 'local-dev-cron-secret'
      from app.settings where key = 'cron_secret'
    ),
    -- LIKE treats _ as a single-character wildcard, so these are escaped. The
    -- unescaped form matched more than intended, which was harmless only
    -- because nothing else is named kicka-anything.
    'cronJobsScheduled', (
      select count(*) from cron.job where jobname like 'kicka\_%'
    ),
    'cronJobsActive', (
      select count(*) from cron.job where jobname like 'kicka\_%' and active
    ),
    -- The role the two counts above were taken as. Without it, a zero is
    -- unreadable: it means either "no jobs" or "cannot see the jobs", and those
    -- call for opposite responses.
    'countedAs', current_user
  );
$$;

alter function public.get_deploy_settings() owner to postgres;

revoke execute on function public.get_deploy_settings() from public, anon, authenticated;
grant execute on function public.get_deploy_settings() to service_role;
