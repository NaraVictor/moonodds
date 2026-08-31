-- ============================================================================
-- The results email states a price only when one was quoted
--
-- get_daily_results used app.pick_price_low, which falls back to the
-- confidence-derived estimate. That is right for an ordering or a display, and
-- wrong for the "Total Odds" line, which is a claim about what the day
-- returned — and a total built from estimates is a number about money that no
-- bookmaker stands behind.
--
-- It returns the real price or null now. The email adds up what it has and
-- omits the line entirely when any winning call is unpriced, rather than
-- quietly totalling a smaller set under a heading that implies all of them.
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
        'odds', app.pick_price_real(p.id)
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
