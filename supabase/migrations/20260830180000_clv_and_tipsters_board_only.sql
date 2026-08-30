-- ============================================================================
-- The last two public reads that would have counted the paid tier
--
-- Both panels sit under the win rate on /history, and get_history_stats above
-- them already counts board picks only. Left as they were, the page would have
-- reported one number of settled calls at the top and measured a different set
-- underneath — and the set underneath would have included picks the visitor
-- never got to see.
--
-- get_tipster_performance takes its filter in the JOIN rather than a WHERE:
-- the join is a LEFT JOIN, and a WHERE on the right-hand table would quietly
-- turn it into an inner one, dropping any tipster whose picks all landed in
-- the basket instead of showing them with a settled count of zero.
--
-- Not changed, deliberately: backtest_thresholds, get_dashboard_metrics and
-- the CLV check job. Those measure the ENGINE rather than the product, they
-- are Office-only, and a floor backtest that ignored everything below the
-- board would be answering a question nobody asked.
-- ============================================================================

create or replace function public.get_clv_summary()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with priced as (
    select
      o.clv_delta,
      o.market_opposed,
      p.status
    from public.odds_snapshots o
    join public.predictions p on p.id = o.prediction_id
    where o.clv_delta is not null
      and p.tier = 'primary'
      and p.status in ('won', 'lost')
  )
  select jsonb_build_object(
    'measured', (select count(*) from priced),
    -- The headline: how often we took a price better than the close. Positive
    -- delta means the line moved toward us after we called it.
    'beatCloseRate', (
      select round(count(*) filter (where clv_delta > 0)::numeric
                   / nullif(count(*), 0), 4) from priced
    ),
    'avgClvPct', (
      select round(avg(clv_delta) * 100, 2) from priced
    ),
    'marketOpposed', (select count(*) from priced where market_opposed),
    -- The question CLV exists to answer: when the market agreed with us, did we
    -- actually win more often than when it moved against us? If these two are
    -- the same, our CLV is noise rather than edge.
    'winRateWhenBeatingClose', (
      select round(count(*) filter (where status = 'won')::numeric
                   / nullif(count(*), 0), 4)
      from priced where clv_delta > 0
    ),
    'winRateWhenOpposed', (
      select round(count(*) filter (where status = 'won')::numeric
                   / nullif(count(*), 0), 4)
      from priced where market_opposed
    )
  );
$$;

create or replace function public.get_tipster_performance()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(row_to_json(t) order by t.settled desc), '[]'::jsonb)
  from (
    select
      ti.id,
      ti.display_name as name,
      ti.slug,
      ti.is_active as "isActive",
      count(*) filter (where p.status in ('won','lost')) as settled,
      count(*) filter (where p.status = 'won')  as wins,
      count(*) filter (where p.status = 'lost') as losses,
      round(count(*) filter (where p.status = 'won')::numeric
            / nullif(count(*) filter (where p.status in ('won','lost')), 0), 4) as "winRate",
      app.wilson_interval(
        (count(*) filter (where p.status = 'won'))::integer,
        (count(*) filter (where p.status in ('won','lost')))::integer
      ) as "winRateInterval",
      round(avg(p.confidence_score) filter (where p.status in ('won','lost')), 2) as "avgConfidence",
      round(
        (coalesce(sum(app.pick_price(p)) filter (where p.status = 'won'), 0)
         - count(*) filter (where p.status in ('won','lost')))
        / nullif(count(*) filter (where p.status in ('won','lost')), 0), 4) as roi
    from public.tipsters ti
    left join public.predictions p on p.tipster_id = ti.id and p.tier = 'primary'
    group by ti.id, ti.display_name, ti.slug, ti.is_active
    having count(*) filter (where p.status in ('won','lost')) > 0
  ) t;
$$;
