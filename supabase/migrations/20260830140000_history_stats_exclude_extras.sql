-- ============================================================================
-- History stats: stop counting extra picks, and stop dropping small markets
--
-- Two faults, found while removing the calibration panel from /history.
--
-- 1. EXTRA PICKS WERE IN THE PUBLISHED RECORD. get_history_stats predates the
--    tier column and was the one public read still counting them — so the very
--    picks that were deliberately kept out of get_engine_stats were landing in
--    the hit rate, the Wilson interval and the market breakdown on the page
--    that exists to be the honest record. Filtered now, like the rest.
--
-- 2. "BY MARKET" SILENTLY DROPPED MARKETS. `having count(*) >= 3` meant a
--    market with one or two settled picks vanished from the card entirely —
--    not folded into an "other" row, just gone. The rows therefore did not add
--    up to the total settled count shown directly above them, which is the
--    kind of quiet inconsistency that makes a reader doubt the whole page.
--
--    Every market is listed now. The guard stays where it belongs: `best`
--    still requires five settled before it will crown a market strongest, so a
--    single lucky call cannot become the headline.
-- ============================================================================

create or replace function public.get_history_stats()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with settled as (
    select
      p.status,
      p.prediction_type::text as market,
      p.confidence_score,
      p.settled_at,
      l.name as league_name,
      app.pick_price(p) as price
    from public.predictions p
    join public.fixtures f on f.id = p.fixture_id
    join public.leagues l on l.id = f.league_id
    -- Extra picks are the calls the board would not carry, so they must not
    -- appear in the published record. This function predates the tier column
    -- and was the one public read still counting them.
    where p.status in ('won', 'lost', 'void')
      and p.tier = 'primary'
  ),
  graded as (select * from settled where status in ('won', 'lost'))
  select jsonb_build_object(
    'settled',   (select count(*) from graded),
    'won',       (select count(*) from graded where status = 'won'),
    'lost',      (select count(*) from graded where status = 'lost'),
    'void',      (select count(*) from settled where status = 'void'),
    'winRate',   (select round(count(*) filter (where status = 'won')::numeric
                               / nullif(count(*), 0), 4) from graded),
    'winRateInterval', (
      select app.wilson_interval(
        (select count(*)::integer from graded where status = 'won'),
        (select count(*)::integer from graded)
      )
    ),
    'roi',       (select round((coalesce(sum(price) filter (where status = 'won'), 0)
                                - count(*)) / nullif(count(*), 0), 4) from graded),
    'avgOdds',   (select round(avg(price), 2) from graded),
    'avgConfidence', (select round(avg(confidence_score), 2) from graded),
    'bestMarket', (
      select m.market from (
        select market,
               count(*) filter (where status = 'won')::numeric / count(*) as rate,
               count(*) as n
        from graded group by market having count(*) >= 5
      ) m order by m.rate desc, m.n desc limit 1
    ),
    'byMarket', coalesce((
      select jsonb_agg(row_to_json(t) order by t.settled desc)
      from (
        select
          market,
          count(*) filter (where status = 'won')  as wins,
          count(*) filter (where status = 'lost') as losses,
          count(*) as settled,
          round(count(*) filter (where status = 'won')::numeric / count(*), 4) as "winRate",
          round((coalesce(sum(price) filter (where status = 'won'), 0) - count(*))
                / count(*), 4) as roi
        from graded
        group by market
      ) t
    ), '[]'::jsonb),
    'byMonth', coalesce((
      select jsonb_agg(row_to_json(t) order by t.month)
      from (
        select
          to_char(date_trunc('month', settled_at), 'YYYY-MM') as month,
          count(*) filter (where status = 'won')  as wins,
          count(*) filter (where status = 'lost') as losses,
          count(*) as settled,
          round(count(*) filter (where status = 'won')::numeric / count(*), 4) as "winRate"
        from graded
        group by date_trunc('month', settled_at)
        order by date_trunc('month', settled_at)
        limit 12
      ) t
    ), '[]'::jsonb),
    -- Calibration: does a 9.0 actually land 90% of the time? The engine has
    -- been recording confidence_raw next to the anchored score since v2.2, so
    -- the data to answer this already existed and nothing was reading it.
    'calibration', coalesce((
      select jsonb_agg(row_to_json(t) order by t.band)
      from (
        select
          width_bucket(confidence_score, 5, 10, 5) as bucket,
          concat(
            round(4 + width_bucket(confidence_score, 5, 10, 5)::numeric, 0), '-',
            round(5 + width_bucket(confidence_score, 5, 10, 5)::numeric, 0)
          ) as band,
          count(*) as settled,
          round(count(*) filter (where status = 'won')::numeric / count(*), 4) as "actualRate",
          round(avg(confidence_score) / 10, 4) as "impliedRate"
        from graded
        group by width_bucket(confidence_score, 5, 10, 5)
        having count(*) >= 5
      ) t
    ), '[]'::jsonb)
  );
$$;