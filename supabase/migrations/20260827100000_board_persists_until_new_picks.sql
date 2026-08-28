-- ============================================================================
-- The board keeps yesterday until today has something to replace it with
--
-- get_todays_picks asked for exactly the current UTC day, so at midnight the
-- window rolled and every pick left the home page at once. Nothing replaced
-- them until the engine published at 05:00 — a guaranteed five-hour empty board
-- every night, and an empty board ALL DAY whenever the engine published
-- nothing, which it has done repeatedly.
--
-- A visitor arriving in that window saw a product with no product in it. Not a
-- "come back later" state: the real board, correctly rendered, containing zero
-- rows.
--
-- Worth being precise about the cause, because the obvious reading is wrong.
-- Settled games were never the problem — a won or lost pick stays on the board
-- quite happily until midnight. It is the DATE ROLLOVER that clears it, so the
-- fix belongs in the window rather than in any filter on status.
--
-- Now: if the requested day holds no predictions, fall back to the most recent
-- earlier day that does. The switch happens the moment TODAY has a pick, not
-- when the engine has run — so a day that publishes nothing keeps showing the
-- last real board instead of reverting to the blank page this replaces.
--
-- NOTHING NEW IS EXPOSED. pick_json_gated already returns the full payload when
-- `entitled OR status IN ('won','lost')`, so settled picks are public to
-- everyone by design and are on /history regardless. A pass holder is not
-- suddenly locked out of what they paid for yesterday, and a non-payer sees
-- nothing they could not already see. Any pick still PENDING from that day
-- stays gated exactly as it was.
--
-- boardDate and isPreviousDay come back with the payload so the page can say
-- which day it is showing. The heading reads "Today's predictions", and
-- yesterday's results underneath that heading would be a small lie in a product
-- whose whole argument is that it publishes its own misses.
-- ============================================================================

create or replace function public.get_todays_picks(
  start_ts timestamptz,
  end_ts timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  st record;
  total integer;
  visible jsonb;
  win_start timestamptz := start_ts;
  win_end   timestamptz := end_ts;
  fell_back boolean := false;
  latest    date;
begin
  select * into st from app.access_state();

  -- Only look backwards when the requested day is genuinely empty. A day with
  -- one pick is a real board and must not be replaced by a fuller yesterday.
  if not exists (
    select 1
    from public.predictions p
    join public.fixtures f on f.id = p.fixture_id
    where f.fixture_date >= start_ts and f.fixture_date < end_ts
  ) then
    select max((f.fixture_date at time zone 'utc')::date)
      into latest
    from public.predictions p
    join public.fixtures f on f.id = p.fixture_id
    where f.fixture_date < start_ts;

    if latest is not null then
      win_start := latest::timestamp at time zone 'utc';
      win_end   := (latest + 1)::timestamp at time zone 'utc';
      fell_back := true;
    end if;
  end if;

  select count(*) into total
  from public.predictions p
  join public.fixtures f on f.id = p.fixture_id
  where f.fixture_date >= win_start and f.fixture_date < win_end;

  -- Rank by confidence and unlock down to the viewer's limit. Whole-row `p` is
  -- carried as a composite so the json helpers still receive a predictions row
  -- alongside the window function's ranking.
  select coalesce(
           jsonb_agg(
             app.pick_json_gated(r.pred, r.rn <= st.pick_limit)
             order by r.confidence_score desc
           ),
           '[]'::jsonb
         )
    into visible
  from (
    select p as pred,
           p.confidence_score,
           row_number() over (order by p.confidence_score desc) as rn
    from public.predictions p
    join public.fixtures f on f.id = p.fixture_id
    where f.fixture_date >= win_start and f.fixture_date < win_end
  ) r;

  return jsonb_build_object(
    'picks', visible,
    'totalCount', total,
    'visibleCount', least(greatest(st.pick_limit, 0), total),
    'hasFullAccess', st.has_full_access,
    'isFirstDay', st.is_first_day,
    'freePickLimit', case when st.pick_limit > 1000000 then 0 else st.pick_limit end,
    -- The day actually being shown, and whether it is a fallback. The client
    -- cannot work this out for itself: it asked for today either way.
    'boardDate', (win_start at time zone 'utc')::date,
    'isPreviousDay', fell_back
  );
end;
$$;
