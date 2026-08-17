-- ============================================================================
-- The last of the audit findings that live in the database
--
--   P-04  CLV is computed and never surfaced
--   P-03  no backtesting or challenger comparison
--   P-07  single tipster, no per-tipster record
-- ============================================================================

-- ---------------------------------------------------------------------------
-- P-04: closing line value, where a reader can see it
--
-- runClvCheck has been writing clv_delta and market_opposed to odds_snapshots
-- all along and nothing read them. Beating the closing line is the most
-- credible evidence a tipster can show, it was already being measured, and it
-- was visible to nobody.
--
-- Public, like the rest of the settled record. A CLV figure only means anything
-- if the people deciding whether to trust the product can see it.
-- ---------------------------------------------------------------------------
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

grant execute on function public.get_clv_summary() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- P-03: what a different configuration would have done
--
-- Engine configs could be drafted, promoted and rolled back, but a draft could
-- not be run against history first, so every tuning decision was made forward
-- on live customers with a feedback loop measured in weeks.
--
-- IMPORTANT LIMIT, and the reason this is a threshold replay rather than a true
-- backtest: re-running the engine over past fixtures would need the model's
-- output under the new weights, which means paying for a fresh inference per
-- fixture and reproducing a stats feed that no longer serves those dates. What
-- this does instead is replay the SELECTION AND STAKING rules over the picks
-- the engine actually made: publish floor, staking bands, market exclusions.
--
-- That answers "should we have published this, and at what stake" without
-- pretending to answer "what would the model have said". The distinction
-- matters, and the Office labels it as such.
-- ---------------------------------------------------------------------------
create or replace function public.backtest_thresholds(
  p_floor numeric default null,
  p_unit1 numeric default null,
  p_unit2 numeric default null,
  p_unit3 numeric default null,
  p_unit4 numeric default null,
  p_unit5 numeric default null,
  p_markets text[] default null,
  p_days integer default 90
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with cfg as (
    select
      coalesce(p_floor, 7.0) as floor,
      coalesce(p_unit1, 5.0) as u1,
      coalesce(p_unit2, 6.0) as u2,
      coalesce(p_unit3, 7.0) as u3,
      coalesce(p_unit4, 8.0) as u4,
      coalesce(p_unit5, 9.0) as u5
  ),
  universe as (
    select p.id, p.status, p.confidence_score, p.prediction_type::text as market,
           app.pick_price(p) as price
    from public.predictions p
    where p.status in ('won', 'lost')
      and p.settled_at > now() - make_interval(days => greatest(coalesce(p_days, 90), 1))
      and (p_markets is null or p.prediction_type::text = any(p_markets))
  ),
  selected as (
    select u.*,
           case
             when u.confidence_score >= c.u5 then 5
             when u.confidence_score >= c.u4 then 4
             when u.confidence_score >= c.u3 then 3
             when u.confidence_score >= c.u2 then 2
             else 1
           end as units
    from universe u cross join cfg c
    where u.confidence_score >= c.floor
  )
  select jsonb_build_object(
    'candidates', (select count(*) from universe),
    'published',  (select count(*) from selected),
    'won',        (select count(*) from selected where status = 'won'),
    'lost',       (select count(*) from selected where status = 'lost'),
    'winRate',    (select round(count(*) filter (where status = 'won')::numeric
                                / nullif(count(*), 0), 4) from selected),
    'winRateInterval', (
      select app.wilson_interval(
        (select count(*)::integer from selected where status = 'won'),
        (select count(*)::integer from selected)
      )
    ),
    -- Staked in units rather than flat, which is the point of having bands.
    'unitsStaked',  (select coalesce(sum(units), 0) from selected),
    'unitsReturned',(select coalesce(round(sum(units * price) filter (where status = 'won'), 2), 0) from selected),
    'roi', (
      select round(
        (coalesce(sum(units * price) filter (where status = 'won'), 0) - coalesce(sum(units), 0))
        / nullif(sum(units), 0), 4)
      from selected
    ),
    -- What the floor threw away. A floor that improves win rate by discarding
    -- every profitable longshot is not an improvement.
    'discarded', (
      select jsonb_build_object(
        'count', count(*),
        'winRate', round(count(*) filter (where status = 'won')::numeric
                         / nullif(count(*), 0), 4)
      )
      from universe u cross join cfg c where u.confidence_score < c.floor
    )
  );
$$;

grant execute on function public.backtest_thresholds(numeric, numeric, numeric, numeric, numeric, numeric, text[], integer) to authenticated;

-- ---------------------------------------------------------------------------
-- P-07: a record per tipster
--
-- The schema has always carried tipsters and attributed every pick to one, but
-- exactly one row was active and nothing compared them. This does not make the
-- product a marketplace; it makes the record per-tipster so that adding a
-- second one is a data change rather than a schema change.
-- ---------------------------------------------------------------------------
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
    left join public.predictions p on p.tipster_id = ti.id
    group by ti.id, ti.display_name, ti.slug, ti.is_active
    having count(*) filter (where p.status in ('won','lost')) > 0
  ) t;
$$;

grant execute on function public.get_tipster_performance() to anon, authenticated;
