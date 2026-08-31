-- ============================================================================
-- Average price was the last figure still resting on the estimate
--
-- The return tile is gated on a real bookmaker price now, and the tile beside
-- it was still averaging app.pick_price — which falls back to
-- `2.60 - (confidence - 7.0) * 0.28`. So /history showed no return, correctly,
-- next to "2.73 average price", which was the mean of a formula.
--
-- Averaged over real prices only, and null when there are none, so the two
-- numbers agree about what is known.
-- ============================================================================

create or replace function public.get_history_stats(
  p_league text default null,
  p_market text default null
)
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
      app.pick_price(p) as price,
      app.pick_price_real(p.id) as real_price
    from public.predictions p
    join public.fixtures f on f.id = p.fixture_id
    join public.leagues l on l.id = f.league_id
    -- Extra picks are the calls the board would not carry, so they must not
    -- appear in the published record. This function predates the tier column
    -- and was the one public read still counting them.
    where p.status in ('won', 'lost', 'void')
      and p.tier = 'primary'
      and (p_league is null or l.name = p_league)
      and (p_market is null or p.prediction_type::text = p_market)
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
    -- Real prices only. See 20260831130000: the published return used to be
    -- arithmetic over a confidence-derived estimate, because nothing wrote
    -- odds_snapshots. Null rather than zero when none is priced — "we do not
    -- know" and "you broke even" are different statements.
    'roi', (
      select round((coalesce(sum(real_price) filter (where status = 'won'), 0)
                    - count(*)) / nullif(count(*), 0), 4)
      from graded where real_price is not null
    ),
    'roiSample', (select count(*) from graded where real_price is not null),
    -- Real prices only, for the same reason as the return above: an average
    -- of confidence-derived estimates is an average of nothing.
    'avgOdds', (select round(avg(real_price), 2) from graded where real_price is not null),
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

grant execute on function public.get_history_stats(text, text) to anon, authenticated;
