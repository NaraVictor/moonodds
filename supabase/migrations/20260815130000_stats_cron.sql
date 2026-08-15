-- Fetch pre-match stats between the fixture pull (00:30) and the engine run
-- (06:00), so the prompt has real numbers by the time picks are generated.
select cron.schedule(
  'moonodds_fetch_stats',
  '0 5 * * *',
  $$select app.call_endpoint('/api/cron/fetch-stats')$$
);
