-- ============================================================================
-- Rebuild the whole schedule, and poll live fixtures every 15 seconds
--
-- WHY THIS EXISTS AT ALL
--
-- The remote has zero kicka_* jobs. Not a subset — none. It also came back with
-- app.settings holding the local development defaults, which is the state a
-- fresh database is seeded in, so the two facts together say the schedule was
-- lost rather than never created: 20260821091000 asserts nine jobs exist and
-- raises if they do not, and it is recorded as applied.
--
-- An applied migration never re-runs, so every migration that creates a cron
-- job is now inert on this database. Editing them would fix nothing. The only
-- thing that restores a schedule is a NEW migration, which is this one, and it
-- deliberately owns the entire set rather than the one job that changed:
-- rebuilding all eleven from a single place is what makes the outcome
-- independent of which of the earlier migrations a given database has seen.
--
-- Idempotent. Unschedules both historical prefixes first, so it is safe on a
-- fresh database where the earlier migrations have just created them, and safe
-- to re-run by hand in the SQL editor if this ever happens again.
--
-- POLLING EVERY 15 SECONDS, AND WHY THE QUOTA SURVIVES IT
--
-- pg_cron 1.5 added interval schedules, so '15 seconds' is a real schedule and
-- not a minute-granularity approximation. Four calls a minute sounds reckless
-- against a 7,500/day plan, so the arithmetic, using the worst realistic day:
--
--   runLiveResults makes NO upstream call unless a fixture is inside its live
--   window, which is most minutes of most days. When one is, every fixture in
--   the window batches into a single request, so the cost is 4 calls/minute
--   whatever is on.
--
--   Weekday card, kickoffs 16:30-19:30: window runs 16:30 to 23:30, seven
--   hours, 1,680 calls.
--   Saturday card, kickoffs 11:30-22:00: window runs 11:30 to 02:00, fourteen
--   and a half hours, 3,480 calls.
--
--   Everything else the app does costs about 150 a day: the fixture pull is one
--   call per league, stats are four per fixture against a session cap of 20.
--
-- So the heaviest plausible day lands near 3,600 of 7,500. The per-minute
-- ceiling the API returns is 300; this uses four. There is room, and if a
-- future card is heavier than any of these, the interval is one word to change.
-- ============================================================================

do $$
declare
  job record;
begin
  for job in
    select jobname from cron.job
    where jobname like 'moonodds\_%' or jobname like 'kicka\_%'
  loop
    perform cron.unschedule(job.jobname);
    raise notice 'unscheduled %', job.jobname;
  end loop;
end;
$$;

select cron.schedule('kicka_fetch_fixtures',       '30 0 * * *',    $$select app.call_endpoint('/api/cron/fetch-fixtures')$$);
select cron.schedule('kicka_fetch_stats',          '0 5 * * *',     $$select app.call_endpoint('/api/cron/fetch-stats')$$);
select cron.schedule('kicka_daily_picks',          '0 6 * * *',     $$select app.call_endpoint('/api/cron/daily-picks')$$);
select cron.schedule('kicka_auto_grade',           '15 */2 * * *',  $$select app.call_endpoint('/api/cron/auto-grade')$$);
select cron.schedule('kicka_clv_check',            '45 */2 * * *',  $$select app.call_endpoint('/api/cron/clv-check')$$);
select cron.schedule('kicka_weekly_recalibration', '0 3 * * 1',     $$select app.call_endpoint('/api/cron/recalibrate')$$);
select cron.schedule('kicka_reconcile_payments',   '*/15 * * * *',  $$select app.call_endpoint('/api/cron/reconcile-payments')$$);
select cron.schedule('kicka_drain_jobs',           '* * * * *',     $$select app.call_endpoint('/api/cron/drain-jobs')$$);
select cron.schedule('kicka_reap_stalled',         '*/10 * * * *',  $$select app.reap_stalled_jobs()$$);
select cron.schedule('kicka_sweep_expired',        '*/30 * * * *',  $$select app.sweep_expired()$$);

-- The live poller. '15 seconds' needs pg_cron 1.5 or later; the assertion below
-- catches a server too old to understand it, because pg_cron rejects the
-- schedule rather than silently rounding it to a minute.
select cron.schedule('kicka_poll_live',            '15 seconds',    $$select app.call_endpoint('/api/cron/live-results')$$);

-- Eleven in, eleven out. Asserted rather than assumed, for the same reason the
-- rename migration asserted nine: a schedule that quietly loses a job fails
-- invisibly and on a delay, which is the worst shape a failure can take here.
do $$
declare
  n integer;
begin
  select count(*) into n from cron.job where jobname like 'kicka\_%';
  if n <> 11 then
    raise exception 'expected 11 kicka_* cron jobs, found %', n;
  end if;
  if exists (select 1 from cron.job where jobname like 'moonodds\_%') then
    raise exception 'moonodds_* cron jobs survived the rebuild';
  end if;
  if not exists (
    select 1 from cron.job where jobname = 'kicka_poll_live' and schedule = '15 seconds'
  ) then
    raise exception 'kicka_poll_live is not on the 15-second schedule';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Make the results reserve tell the truth
--
-- api_budget.reservedForResults was 500, set when results arrived from a
-- two-hourly sweep. Polling every fifteen seconds spends several thousand on a
-- busy day, and runFetchStats sizes the stats pull against dailyTotal minus
-- this figure — so leaving it at 500 means the budget arithmetic is computed
-- against a reserve the app no longer respects.
--
-- 3,600 is the Saturday figure above. It still leaves 3,900 spendable, which at
-- four calls per fixture is nearly a thousand fixtures of stats against a
-- session cap of 20, so nothing is constrained by the change.
--
-- Scoped to rows still holding exactly the old pair, so a budget somebody has
-- deliberately tuned is left alone.
-- ---------------------------------------------------------------------------
update public.ai_engine_config
set api_budget = api_budget || jsonb_build_object('reservedForResults', 3600)
where (api_budget->>'dailyTotal')::numeric = 7500
  and (api_budget->>'reservedForResults')::numeric = 500;
