-- ============================================================================
-- Actually fetch the odds
--
-- odds_snapshots has existed since the first migration and nothing has ever
-- written to it. app.pick_price falls back to
-- `2.60 - (confidence - 7.0) * 0.28` when it finds no row, and with the table
-- empty that fallback WAS the product's odds — a straight line off the
-- confidence score with no bookmaker in it anywhere.
--
-- It reads high because it is not a price. A 74% call was shown at 2.49, which
-- implies 40%: the two numbers on the same card disagreed by thirty-four
-- points, and in the direction that flatters us. Backing them at those prices,
-- if the confidence were sound, would have returned 84% a bet.
--
-- Twice, at 06:00 and 10:00. Once is enough to have a price; twice means a
-- fixture the feed had not priced at six — common for lower divisions — gets a
-- second chance before kickoff. The job skips anything already priced, so the
-- second run costs nothing when the first one worked.
-- ============================================================================
do $$
begin
  if exists (select 1 from cron.job where jobname = 'kicka_fetch_odds_early') then
    perform cron.unschedule('kicka_fetch_odds_early');
  end if;
  if exists (select 1 from cron.job where jobname = 'kicka_fetch_odds_late') then
    perform cron.unschedule('kicka_fetch_odds_late');
  end if;
end;
$$;

select cron.schedule(
  'kicka_fetch_odds_early',
  '0 6 * * *',
  $$select app.call_endpoint('/api/cron/fetch-odds')$$
);

select cron.schedule(
  'kicka_fetch_odds_late',
  '0 10 * * *',
  $$select app.call_endpoint('/api/cron/fetch-odds')$$
);
