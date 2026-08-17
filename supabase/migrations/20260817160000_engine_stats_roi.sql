-- ============================================================================
-- get_engine_stats: real prices, and arithmetic that means what it says
--
-- The ported Convex formula was
--
--     (sum(staking_unit) filter (won) * 1.8 - sum(staking_unit) filter (lost))
--     / sum(staking_unit)
--
-- and it was wrong twice over.
--
--   1. It paid every winner at a flat 1.8 regardless of the price the pick was
--      actually taken at. Average price on the settled book is 2.22, so the
--      flat figure is not even a conservative approximation, it is a different
--      number about a different book.
--
--   2. It never returned the winners' own stake to the denominator's world.
--      ROI is (returns - staked) / staked. The old expression subtracted only
--      the *losers'* stake, so every winning unit was counted as pure profit
--      plus its own stake back. That is the larger of the two errors and it is
--      what put the headline at 112%.
--
-- Both are fixed by reusing app.pick_price, the same helper get_history_stats
-- and app.pick_json already use, and by staking one flat unit per settled
-- pick. The flat unit is deliberate: get_history_stats made that choice first
-- and these two numbers describe the same settled book, so they must agree.
-- Weighting by staking_unit here and not there would put two different ROIs
-- for the same picks on two pages, which is the drift app.pick_price was
-- extracted to prevent.
--
-- On the current seed this moves the headline from 1.1236 to 0.5796, which is
-- exactly get_history_stats. What remains high is the seed's 71% strike rate,
-- not the formula.
-- ============================================================================

create or replace function public.get_engine_stats()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with graded as (
    select p.status, app.pick_price(p) as price
    from public.predictions p
    where p.status in ('won', 'lost')
  )
  select jsonb_build_object(
    'winRate', coalesce(round(count(*) filter (where status = 'won')::numeric
                              / nullif(count(*), 0), 4), 0),
    'totalPicks', count(*),
    -- One unit staked per settled pick, returned at the price we took.
    'roi', coalesce(round((coalesce(sum(price) filter (where status = 'won'), 0)
                           - count(*)) / nullif(count(*), 0), 4), 0)
  )
  from graded;
$$;
