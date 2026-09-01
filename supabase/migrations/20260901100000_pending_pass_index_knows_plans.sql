-- ============================================================================
-- Changing your mind about the plan locked you out of buying at all
--
-- payments_one_pending_pass is unique on (user_id, dateKey) for pending day
-- passes. It was written when a day pass was the only thing on sale, and it
-- says "one pending pass per person per day", which was the same sentence as
-- "one pending pass per person per PRODUCT".
--
-- It is not any more, and the checkout now looks up an in-flight payment by
-- (dateKey, plan) — it has to, or somebody who opened the week and then chose
-- the day would be handed the week's reference and charged $10 for a day.
--
-- Those two disagree, and the gap is reachable in about fifteen seconds:
--
--   1. open the checkout, which now defaults to the WEEK, press Pay
--   2. abandon at Paystack — four of the five attempts on this account did
--      exactly that
--   3. come back, choose the DAY, press Pay
--   4. the lookup finds no pending DAY row, so the route inserts one
--   5. the index fires on (user_id, dateKey) — 23505
--   6. the handler re-reads, still finds no pending day row, and returns
--      "Could not start checkout"
--
-- The buyer is then blocked from paying anything at all for the rest of the
-- day, and it looks like one more abandonment from the outside.
--
-- The plan joins the key. A double-tap on the same plan still collapses into
-- one charge, which is what the index is for; two different plans are two
-- different products, exactly as the extras route already treats a second
-- checkout for different leagues as a real second purchase.
--
-- coalesce, because the five payments taken before plans existed carry no
-- plan at all. Left as null they would be distinct from each other under the
-- index and from everything else; read as 'day' they are what they were sold
-- as.
-- ============================================================================
drop index if exists public.payments_one_pending_pass;

create unique index payments_one_pending_pass
  on public.payments (
    user_id,
    (metadata ->> 'dateKey'),
    (coalesce(metadata ->> 'plan', 'day'))
  )
  where status = 'pending' and purpose = 'daily_pass';
