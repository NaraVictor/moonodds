-- ---------------------------------------------------------------------------
-- Kicka, move the scheduled jobs from moonodds_* to kicka_*
--
-- The product rename changed the job names in 20260814090300_cron.sql, which
-- is ALREADY APPLIED on the remote. An applied migration does not re-run, so
-- editing it renamed the jobs only for a database created after the edit. The
-- deployed database still has nine active moonodds_* jobs, confirmed by
-- querying cron.job on the remote.
--
-- That makes the obvious version of this migration, unschedule moonodds_*,
-- the most destructive thing in the repository: it would remove every
-- scheduled job on production and create nothing, because the migration that
-- creates them has already been marked applied. Fixtures, picks, grading,
-- payment reconciliation and the job drain would all simply stop, on a
-- schedule, with no error anywhere. Exactly the silent failure the deploy
-- runbook is written around.
--
-- So this transfers the schedule rather than dropping it: unschedule both
-- prefixes, then create all nine jobs. Unscheduling kicka_* first as well is
-- what makes it idempotent and safe on a fresh database, where cron.sql has
-- just created them under the new names.
--
-- The definitions below duplicate cron.sql. That is deliberate and it is the
-- lesser evil: the alternative is a migration whose correctness depends on
-- which other migrations have run, which is what caused this in the first
-- place. Change a schedule in both places, or delete cron.sql's copy once
-- every database has passed through here.
-- ---------------------------------------------------------------------------

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

-- Nine in, nine out. A rename that loses a job is the failure this exists to
-- prevent, so it is asserted rather than assumed.
do $$
declare
  n integer;
begin
  select count(*) into n from cron.job where jobname like 'kicka\_%';
  if n <> 9 then
    raise exception 'expected 9 kicka_* cron jobs after rename, found %', n;
  end if;
  if exists (select 1 from cron.job where jobname like 'moonodds\_%') then
    raise exception 'moonodds_* cron jobs survived the rename';
  end if;
end;
$$;
