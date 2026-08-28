-- ============================================================================
-- Publish the board at 05:00 instead of 06:00
--
-- An hour earlier for the reader: a day-pass buyer checking at 07:00 finds a
-- board that has been up two hours rather than one, and runDailyPicks selects
-- fixtures from NOW to midnight, so starting earlier also stops excluding
-- anything that kicks off in the small hours.
--
-- THE WHOLE CHAIN MOVES, because only the last link was ever the point of it:
--
--     fetch_fixtures  ->  fetch_stats  ->  fetch_injuries  ->  daily_picks
--
-- daily_picks reads what the three before it wrote. Moving it alone would have
-- left it running before the day's stats existed at all — the previous stats
-- run happens a full day earlier, when today's fixtures were not yet in the
-- database for it to enrich — and statsBlock would have handed the engine
-- "no stats for this fixture, reason from league and venue only" for every
-- fixture on the board. Against a floor of 7 and anchoring rules that count
-- conditions resting on absent data as unmet, that publishes nothing, daily.
--
-- New times, with the gaps sized for the work rather than for neatness:
--
--     00:30  fetch_fixtures   unchanged; it only needs to be after UTC midnight
--                             so "today" resolves to the right date
--     03:30  fetch_stats      was 05:00. The heaviest of the four, ~4 calls per
--                             fixture; 90 minutes of headroom before the engine
--     04:15  fetch_injuries   was 05:30. A handful of calls, one per league-day
--     05:00  daily_picks      was 06:00
--
-- The 36-hour stats horizon still covers the day comfortably from 03:30, and
-- injuries moving 75 minutes earlier is a small enough step that the feed's
-- match-day population should be unaffected — and if it is not, the
-- empty-means-absent guard skips STEP 6 rather than reporting a fit squad.
--
-- Notifications ride the picks: daily_picks_ready is enqueued by the run and
-- drained within the minute, so the "Today's picks are ready" email and SMS now
-- go out at 05:00. That is deliberate and was decided explicitly.
-- ============================================================================

do $$
declare
  job record;
begin
  for job in
    select jobname from cron.job
    where jobname in ('kicka_fetch_stats', 'kicka_fetch_injuries', 'kicka_daily_picks')
  loop
    perform cron.unschedule(job.jobname);
  end loop;
end;
$$;

select cron.schedule('kicka_fetch_stats',    '30 3 * * *',  $$select app.call_endpoint('/api/cron/fetch-stats')$$);
select cron.schedule('kicka_fetch_injuries', '15 4 * * *',  $$select app.call_endpoint('/api/cron/fetch-injuries')$$);
select cron.schedule('kicka_daily_picks',    '0 5 * * *',   $$select app.call_endpoint('/api/cron/daily-picks')$$);

-- The order is the whole point, so it is asserted rather than assumed. A future
-- edit that moves one of these past another would otherwise fail silently, once
-- a day, by publishing a board reasoned from nothing.
do $$
declare
  stats_min integer;
  inj_min   integer;
  picks_min integer;
begin
  select (split_part(schedule, ' ', 2)::int * 60 + split_part(schedule, ' ', 1)::int)
    into stats_min from cron.job where jobname = 'kicka_fetch_stats';
  select (split_part(schedule, ' ', 2)::int * 60 + split_part(schedule, ' ', 1)::int)
    into inj_min   from cron.job where jobname = 'kicka_fetch_injuries';
  select (split_part(schedule, ' ', 2)::int * 60 + split_part(schedule, ' ', 1)::int)
    into picks_min from cron.job where jobname = 'kicka_daily_picks';

  if stats_min is null or inj_min is null or picks_min is null then
    raise exception 'one of the daily chain jobs is missing after rescheduling';
  end if;

  if not (stats_min < picks_min and inj_min < picks_min) then
    raise exception
      'daily_picks (% min) must run after fetch_stats (% min) and fetch_injuries (% min)',
      picks_min, stats_min, inj_min;
  end if;
end;
$$;
