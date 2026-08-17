-- ============================================================================
-- Deploy readiness, readable from the app
--
-- app.settings is the single most dangerous thing in this schema, because it is
-- the only misconfiguration that produces no error at all: the cron jobs post
-- to whatever app_base_url says, and if that is still host.docker.internal in
-- production they simply vanish. No fixtures, no picks, no grading, nothing in
-- the logs.
--
-- /api/health needs to read it to say so out loud, but app.settings holds the
-- cron secret, so the app is given a function that reports the SHAPE of the
-- config rather than the config. The secret never leaves the database.
-- ============================================================================

create or replace function public.get_deploy_settings()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    -- The base URL is not a secret; it is the site's own public address, and
    -- seeing it is the whole point of the check.
    'appBaseUrl', (select value from app.settings where key = 'app_base_url'),
    -- The secret itself never crosses this boundary. Whether it is still the
    -- shipped default is all the health check needs to know.
    'cronSecretIsLocal', (
      select value = 'local-dev-cron-secret'
      from app.settings where key = 'cron_secret'
    ),
    'cronJobsScheduled', (
      select count(*) from cron.job where jobname like 'moonodds_%'
    ),
    'cronJobsActive', (
      select count(*) from cron.job where jobname like 'moonodds_%' and active
    )
  );
$$;

-- Service role only. This is called from a server route holding the secret key,
-- never from a browser, and there is no reason for a client to ask.
revoke execute on function public.get_deploy_settings() from public, anon, authenticated;
