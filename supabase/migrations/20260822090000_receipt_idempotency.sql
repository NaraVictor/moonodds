-- ---------------------------------------------------------------------------
-- Kicka, one receipt per payment
--
-- Three channels settle a payment: the browser's PATCH, the Paystack webhook,
-- and the reconciliation sweep. Granting is already idempotent, the pass upsert
-- is `on conflict (user_id, date_key) do update`, so a customer cannot be given
-- two passes.
--
-- Enqueuing the receipt is not. settlePayment reads payments.status, and only
-- the activation RPC writes it, so two channels arriving together can both pass
-- the "already succeeded?" guard and both insert a payment_receipt job. The
-- customer is charged once and emailed twice, which in a product that promises
-- refunds looks like a double charge.
--
-- A partial unique index is the fix that does not depend on timing: the second
-- insert fails on the constraint rather than racing. It covers only receipts,
-- so every other job kind can still be enqueued freely.
-- ---------------------------------------------------------------------------

-- Collapse any duplicates that already exist, keeping the earliest of each.
delete from jobs j
where j.kind = 'payment_receipt'
  and exists (
    select 1 from jobs k
    where k.kind = 'payment_receipt'
      and k.payload->>'reference' = j.payload->>'reference'
      and (k.created_at, k.id) < (j.created_at, j.id)
  );

create unique index if not exists jobs_one_receipt_per_payment
  on jobs ((payload->>'reference'))
  where kind = 'payment_receipt';

comment on index jobs_one_receipt_per_payment is
  'One receipt per payment reference. Three settlement channels race, and only the pass upsert was idempotent; without this a customer can be emailed twice for a single charge.';
