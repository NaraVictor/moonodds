-- ============================================================================
-- Data-subject rights, and honest headline numbers
--
-- Two unrelated fixes that share a migration because both are read-only
-- additions over existing tables.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Export everything we hold about the caller
--
-- Deletion existed only as an Office action against someone else, and there
-- was no export at all. Both are data-subject rights under GDPR and Ghana's
-- Data Protection Act, and both were admin-only or absent.
--
-- Returns the caller's own rows and nothing derived from anyone else's.
-- ---------------------------------------------------------------------------
create or replace function public.export_my_data()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'exportedAt', now(),
    'profile', (
      select to_jsonb(p) - 'is_super_admin'
      from public.profiles p where p.id = (select auth.uid())
    ),
    'notificationPreferences', (
      select to_jsonb(n) from public.notification_preferences n
      where n.user_id = (select auth.uid())
    ),
    'playerProtection', (
      select to_jsonb(pp) from public.player_protection pp
      where pp.user_id = (select auth.uid())
    ),
    'passes', coalesce((
      select jsonb_agg(to_jsonb(d) order by d.date_key desc)
      from public.daily_passes d where d.user_id = (select auth.uid())
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(to_jsonb(pay) order by pay.created_at desc)
      from public.payments pay where pay.user_id = (select auth.uid())
    ), '[]'::jsonb),
    'extraPickOrders', coalesce((
      select jsonb_agg(to_jsonb(o) order by o.created_at desc)
      from public.extra_pick_orders o where o.user_id = (select auth.uid())
    ), '[]'::jsonb),
    'slips', coalesce((
      select jsonb_agg(
        to_jsonb(s) || jsonb_build_object(
          'legs', (
            select coalesce(jsonb_agg(to_jsonb(l)), '[]'::jsonb)
            from public.slip_legs l where l.slip_id = s.id
          )
        )
        order by s.confirmed_at desc
      )
      from public.slips s where s.user_id = (select auth.uid())
    ), '[]'::jsonb)
  );
$$;

grant execute on function public.export_my_data() to authenticated;

-- ---------------------------------------------------------------------------
-- Confidence interval on the headline win rate
--
-- The product leads with a single percentage. On 70 settled calls a 71% strike
-- rate carries a 95% interval of roughly 59% to 81%, which is wide enough that
-- the honest claim and the flattering one are different numbers. Publishing
-- the point estimate alone is both a product gap and a marketing-claims risk.
--
-- Wilson score interval rather than the normal approximation: it does not run
-- off the end of the scale at small samples or extreme rates, which is exactly
-- where a young track record lives.
-- ---------------------------------------------------------------------------
create or replace function app.wilson_interval(wins integer, total integer)
returns jsonb
language sql
immutable
as $$
  select case
    when total is null or total = 0 then jsonb_build_object('low', null, 'high', null)
    else (
      with c as (
        select 1.959964 as z,
               wins::numeric / total as p,
               total::numeric as n
      ),
      m as (
        select p, n, z,
               1 + z * z / n as denom,
               p + z * z / (2 * n) as centre,
               z * sqrt(p * (1 - p) / n + z * z / (4 * n * n)) as spread
        from c
      )
      select jsonb_build_object(
        'low',  round(greatest(0, (centre - spread) / denom), 4),
        'high', round(least(1, (centre + spread) / denom), 4)
      )
      from m
    )
  end;
$$;

/**
 * History stats, now carrying the interval around the win rate.
 *
 * Everything else is unchanged from the previous definition.
 */
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
    where p.status in ('won', 'lost', 'void')
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
        having count(*) >= 3
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

grant execute on function public.get_history_stats() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Sweep payments that were started and never confirmed
--
-- The third and last chance for a customer who paid: the browser's PATCH, then
-- the Paystack webhook, then this. Every quarter hour, because the failure it
-- catches is someone sitting without access they have already been charged for.
-- ---------------------------------------------------------------------------
select cron.schedule(
  'moonodds_reconcile_payments',
  '*/15 * * * *',
  $$select app.call_endpoint('/api/cron/reconcile-payments')$$
);
