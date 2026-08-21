-- ---------------------------------------------------------------------------
-- Kicka, retire the moonodds_* cron jobs
--
-- The product rename changed the scheduled job names from `moonodds_*` to
-- `kicka_*`, including the unschedule loop at the top of the cron migration
-- that exists to make it re-runnable. That loop now matches only the new
-- prefix, so on any database that had already applied the old migration the
-- old jobs are not removed, they are simply no longer seen: the new names get
-- scheduled alongside them and every endpoint fires twice a day.
--
-- Doubling matters here beyond the duplicate work. The fixture fetch and the
-- stats fetch are metered against a 100-call daily API budget, so a second
-- silent run does not merely repeat the day, it exhausts the plan before
-- grading gets its reserved calls.
--
-- Written as its own migration rather than as an edit to the cron migration,
-- because editing that file only helps a database that has not applied it yet,
-- which is precisely the case that was never at risk.
-- ---------------------------------------------------------------------------

do $$
declare
  job record;
begin
  for job in
    select jobname from cron.job
    where jobname like 'moonodds\_%'
  loop
    perform cron.unschedule(job.jobname);
    raise notice 'unscheduled superseded cron job %', job.jobname;
  end loop;
end;
$$;
