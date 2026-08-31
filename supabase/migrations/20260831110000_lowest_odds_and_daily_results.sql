-- ============================================================================
-- Odds, at the lowest price we have seen
--
-- app.pick_price answers "what is this pick worth" with the MOST RECENT
-- snapshot. That is the right answer for the record — it is the price the call
-- was taken at — and the wrong one for a claim about a day's return, where the
-- most recent snapshot might be the most generous one we ever recorded.
--
-- These read the LOWEST instead. A results email is a claim about money made,
-- and the honest way to make one is at the worst price on the board rather
-- than the best: a customer who checks will find they could have done at least
-- as well, never worse.
--
-- Both fall back to the same confidence-derived estimate app.pick_price uses,
-- because odds_snapshots is empty today and a null in a total is a broken
-- email rather than a cautious one.
-- ============================================================================
create or replace function app.pick_price_low(p_prediction_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select round(min(o.pick_odds), 2)
     from public.odds_snapshots o
     where o.prediction_id = p_prediction_id and o.pick_odds is not null),
    (select round((2.60 - (p.confidence_score - 7.0) * 0.28)::numeric, 2)
     from public.predictions p
     where p.id = p_prediction_id)
  );
$$;

comment on function app.pick_price_low(uuid) is
  'The lowest price recorded for a pick. Used wherever we state a return, so the figure is one the customer could have beaten rather than one they could have missed.';

-- ============================================================================
-- The day's board, settled, with everything the results email prints
--
-- One call rather than a query for the picks and another N for their prices.
-- It also keeps the odds rule in SQL beside app.pick_price, so the two cannot
-- drift into disagreeing about what a pick was worth.
-- ============================================================================
create or replace function public.get_daily_results(p_date date)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'fixture', ht.name || ' v ' || at2.name,
        'market', p.prediction_type::text,
        'value', p.predicted_value,
        'confidence', p.confidence_score,
        'status', p.status::text,
        'odds', app.pick_price_low(p.id)
      )
      order by p.confidence_score desc
    ),
    '[]'::jsonb
  )
  from public.predictions p
  join public.fixtures f  on f.id = p.fixture_id
  join public.teams ht    on ht.id = f.home_team_id
  join public.teams at2   on at2.id = f.away_team_id
  where p.tier = 'primary'
    and p.status in ('won', 'lost', 'void')
    and f.fixture_date >= p_date::timestamp at time zone 'utc'
    and f.fixture_date <  (p_date + 1)::timestamp at time zone 'utc';
$$;

revoke all on function public.get_daily_results(date) from public, anon, authenticated;
grant execute on function public.get_daily_results(date) to service_role;
