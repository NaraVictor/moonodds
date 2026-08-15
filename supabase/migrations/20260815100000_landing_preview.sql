-- ============================================================================
-- MoonOdds — landing page preview
--
-- PRODUCT CHANGE, stated plainly: anonymous visitors previously received zero
-- of today's picks. This grants them exactly ONE, in full, as the landing-page
-- preview that drives signup.
--
-- Two things keep that from being a hole:
--
--   1. It is a hard cap of one, enforced here, not a relaxation of the gate.
--      `predictions` is still granted to no client role, and get_todays_picks
--      is untouched — a guest calling it still gets nothing.
--   2. The locked cards get NO prediction data at all. This function returns a
--      count and nothing else for them. Client-side blur would mean shipping
--      the real picks to the browser and drawing a frosted rectangle over
--      them, which any reader could lift in devtools.
--
-- The access ladder is now: guest 1 · first day 2 · pass holder all.
-- ============================================================================

create or replace function public.get_landing_preview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  st record;
  day_start timestamptz := date_trunc('day', (now() at time zone 'utc')) at time zone 'utc';
  day_end   timestamptz := day_start + interval '1 day';
  total integer;
  preview jsonb;
  visible_count integer;
begin
  select * into st from app.access_state();

  select count(*) into total
  from public.predictions p
  join public.fixtures f on f.id = p.fixture_id
  where f.fixture_date >= day_start and f.fixture_date < day_end;

  -- A signed-in user's own limit governs; a guest gets exactly one.
  visible_count := case
    when st.pick_limit > 1000000 then total
    when st.pick_limit > 0 then least(st.pick_limit, total)
    else least(1, total)
  end;

  -- Only ever ONE full pick leaves this function. The rest are a number.
  select app.pick_json(p) into preview
  from (
    select p.*
    from public.predictions p
    join public.fixtures f on f.id = p.fixture_id
    where f.fixture_date >= day_start and f.fixture_date < day_end
    order by p.confidence_score desc
    limit 1
  ) p;

  return jsonb_build_object(
    'preview', coalesce(preview, 'null'::jsonb),
    'lockedCount', greatest(total - 1, 0),
    'totalToday', total,
    'hasFullAccess', st.has_full_access,
    'isFirstDay', st.is_first_day
  );
end;
$$;

grant execute on function public.get_landing_preview() to anon, authenticated;

comment on function public.get_landing_preview() is
  'Landing-page preview: exactly one full pick plus a count of the rest. Never returns data for locked cards.';
