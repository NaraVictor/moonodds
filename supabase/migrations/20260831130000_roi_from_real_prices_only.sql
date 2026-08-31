-- ============================================================================
-- A return figure computed from prices nobody offered
--
-- app.pick_price falls back to `2.60 - (confidence - 7.0) * 0.28` when a pick
-- has no odds snapshot, and until this week nothing wrote snapshots — so every
-- price in the product came from that line. get_history_stats and
-- get_engine_stats both compute ROI with it, which means the +119.7% return
-- published on /history was arithmetic over numbers no bookmaker quoted.
--
-- The win rate is not affected: it comes from graded results and is real. The
-- return is the one published figure that was not.
--
-- WHAT CHANGES
--
-- ROI is now computed ONLY over settled picks that carry a real bookmaker
-- price, and the count of those picks is returned beside it as roiSample. Zero
-- sample means the figure is unavailable rather than zero, and the page hides
-- it instead of printing 0%.
--
-- This is self-healing. As the odds feed fills the table, roiSample climbs and
-- the figure appears on its own — describing the picks it actually covers,
-- with the sample stated next to it so nobody reads a fortnight as a record.
-- ============================================================================

-- The real price, or nothing. app.pick_price_low still falls back, because a
-- null inside an email's total is a broken email; a null here is the honest
-- answer to "what did this return".
create or replace function app.pick_price_real(p_prediction_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select round(min(o.pick_odds), 2)
  from public.odds_snapshots o
  where o.prediction_id = p_prediction_id and o.pick_odds is not null;
$$;

comment on function app.pick_price_real(uuid) is
  'The lowest price a bookmaker actually offered, or null. Used wherever a number is published as a return, so no claim rests on the confidence-derived estimate.';

create or replace function public.get_engine_stats()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with graded as (
    select p.status, app.pick_price_real(p.id) as price
    from public.predictions p
    where p.status in ('won', 'lost') and p.tier = 'primary'
  ),
  priced as (select * from graded where price is not null)
  select jsonb_build_object(
    'winRate', coalesce(round(count(*) filter (where status = 'won')::numeric
                              / nullif(count(*), 0), 4), 0),
    'totalPicks', count(*),
    -- One unit staked per settled pick, returned at the lowest price actually
    -- quoted. Null rather than zero when nothing is priced: "we do not know"
    -- and "you broke even" are different statements.
    'roi', (
      select round((coalesce(sum(price) filter (where status = 'won'), 0)
                    - count(*)) / nullif(count(*), 0), 4)
      from priced
    ),
    'roiSample', (select count(*) from priced)
  )
  from graded;
$$;

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

grant execute on function public.get_history_stats(text, text) to anon, authenticated;
