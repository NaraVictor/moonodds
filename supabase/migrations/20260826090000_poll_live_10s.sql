-- ============================================================================
-- Poll live fixtures every ten seconds
--
-- Fifteen worked and the budget was barely touched, so the question was how far
-- it could come down. The arithmetic, against the 7,500/day plan and using the
-- worst realistic day — a Saturday card with kickoffs from 11:30 to 22:00, so a
-- window open about twelve and a half hours:
--
--     15s   4 calls/min   3,150/day    42%
--     10s   6 calls/min   4,650/day    62%
--      5s  12 calls/min   9,150/day   122%   over budget
--
-- So ten, which is a third off the delay for a quarter of the remaining
-- headroom. Five is not a close call: it exceeds the daily plan on any busy
-- Saturday, and it would do so silently — the poller would simply start getting
-- refused part-way through the evening, which is the worst possible time.
--
-- The per-minute ceiling the API reports is 300. Six is not near it.
--
-- Everything that made fifteen affordable still holds: no fixture in the window
-- means no upstream call at all, and every fixture in the window batches into a
-- single request, so the cost per tick is one call however many matches are on.
-- ============================================================================

do $$
begin
  if exists (select 1 from cron.job where jobname = 'kicka_poll_live') then
    perform cron.unschedule('kicka_poll_live');
  end if;
end;
$$;

select cron.schedule(
  'kicka_poll_live',
  '10 seconds',
  $$select app.call_endpoint('/api/cron/live-results')$$
);

do $$
begin
  if not exists (
    select 1 from cron.job where jobname = 'kicka_poll_live' and schedule = '10 seconds'
  ) then
    raise exception 'kicka_poll_live is not on the 10-second schedule';
  end if;
end;
$$;
