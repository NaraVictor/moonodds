-- ============================================================================
-- Poll in-play fixtures every minute
--
-- Results arrived only from kicka_auto_grade, which runs two-hourly behind a
-- 2.5-hour cutoff. A match finishing at 20:30 was therefore not settled until
-- 23:15 at the earliest: nearly three hours in which the customer who backed it
-- knows the score and the product does not, with the card still showing the
-- fixture as pending.
--
-- THE COST IS BOUNDED BY THE HANDLER, NOT BY THE SCHEDULE. runLiveResults
-- returns before touching API-Football whenever no fixture is inside the live
-- window, which is most minutes of most days. When something IS in play, every
-- fixture in the window goes into a single batched request, so the ceiling is
-- one upstream call per minute however many matches are on — roughly 360 for a
-- six-hour evening card, inside the 500 api_budget.reservedForResults sets
-- aside for results.
--
-- kicka_auto_grade stays. This poller deliberately gives up on a fixture four
-- hours after kickoff, so the two-hourly sweep remains the backstop for one
-- that got stuck, and for anything scheduled while the poller was not running.
--
-- Re-runnable: the job is unscheduled first, matching the pattern the original
-- cron migration uses for the whole kicka_% family.
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
  '* * * * *',
  $$select app.call_endpoint('/api/cron/live-results')$$
);
