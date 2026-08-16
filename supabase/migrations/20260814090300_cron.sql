-- ============================================================================
-- MoonOdds, scheduling
--
-- Replaces convex/crons.ts. pg_cron drives the schedule and pg_net makes the
-- outbound call to the Next.js route handlers.
--
-- Why not Vercel Cron? The Hobby plan allows one run per day with up to 59
-- minutes of drift, and this app grades results every two hours. pg_cron has no
-- such limit, costs nothing, and keeps the schedule in version control beside
-- the schema instead of in vercel.json.
--
-- Every call carries a bearer secret so the endpoints can reject anything that
-- didn't come from the scheduler.
-- ============================================================================

create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

/**
 * Fire-and-forget POST to an app route. pg_net queues the request and returns
 * immediately, so a slow endpoint never holds a cron slot open.
 */
create or replace function app.call_endpoint(path text, body jsonb default '{}'::jsonb)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  request_id bigint;
begin
  select net.http_post(
    url := app.setting('app_base_url') || path,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || app.setting('cron_secret')
    ),
    body := body,
    timeout_milliseconds := 120000
  ) into request_id;

  return request_id;
end;
$$;

-- Remove any prior definitions so this migration is safe to re-run.
do $$
declare
  job record;
begin
  for job in
    select jobname from cron.job
    where jobname like 'moonodds_%'
  loop
    perform cron.unschedule(job.jobname);
  end loop;
end;
$$;

-- Fetch the day's fixtures from API-Football, 00:30 UTC.
select cron.schedule(
  'moonodds_fetch_fixtures',
  '30 0 * * *',
  $$select app.call_endpoint('/api/cron/fetch-fixtures')$$
);

-- Generate predictions for today's scheduled fixtures, 06:00 UTC.
select cron.schedule(
  'moonodds_daily_picks',
  '0 6 * * *',
  $$select app.call_endpoint('/api/cron/daily-picks')$$
);

-- Grade fixtures whose kickoff was more than ~2.5h ago, every 2 hours.
select cron.schedule(
  'moonodds_auto_grade',
  '15 */2 * * *',
  $$select app.call_endpoint('/api/cron/auto-grade')$$
);

-- Flag closing-line value moves against our position, every 2 hours.
select cron.schedule(
  'moonodds_clv_check',
  '45 */2 * * *',
  $$select app.call_endpoint('/api/cron/clv-check')$$
);

-- Weekly weight recalibration, Mondays 03:00 UTC.
select cron.schedule(
  'moonodds_weekly_recalibration',
  '0 3 * * 1',
  $$select app.call_endpoint('/api/cron/recalibrate')$$
);

-- Drain the jobs outbox every minute. This is what actually delivers the
-- notification fan-out that ctx.scheduler.runAfter used to handle.
select cron.schedule(
  'moonodds_drain_jobs',
  '* * * * *',
  $$select app.call_endpoint('/api/cron/drain-jobs')$$
);

-- Return jobs abandoned by a crashed worker to the queue, every 10 minutes.
select cron.schedule(
  'moonodds_reap_stalled',
  '*/10 * * * *',
  $$select app.reap_stalled_jobs()$$
);
