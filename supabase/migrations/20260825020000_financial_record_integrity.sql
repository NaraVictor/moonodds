-- ============================================================================
-- Financial record integrity: keep payments, settle refunds atomically, and
-- stop a double-tap becoming a double charge
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Deleting an account destroyed every payment it ever made
--
-- payments.user_id cascaded from profiles, profiles cascades from auth.users,
-- and the deletion route calls auth.admin.deleteUser. So the whole chain ran
-- and the payment rows went with it — while the route's own comment said:
--
--     "Payments are kept: they are financial records with their own retention
--      obligations, and they are unlinked from the person rather than
--      destroyed."
--
-- It unlinked nothing. It overwrote metadata, then deleted the row. A comment
-- describing the opposite of the code is worse than no comment: anyone
-- auditing retention would have read it and stopped looking.
--
-- SET NULL is what the comment always described. The money record survives with
-- its reference, amount, currency and timestamps — everything a chargeback or a
-- revenue report needs — and the person it belonged to is gone from it, which
-- is also what erasure actually requires. A null owner is invisible under the
-- RLS policy below, which selects on user_id = auth.uid().
-- ---------------------------------------------------------------------------

alter table public.payments alter column user_id drop not null;

alter table public.payments drop constraint if exists payments_user_id_fkey;
alter table public.payments
  add constraint payments_user_id_fkey
  foreign key (user_id) references public.profiles (id) on delete set null;

alter table public.payments
  add column if not exists owner_erased_at timestamptz;

comment on column public.payments.owner_erased_at is
  'Set when the buying account was deleted. The row is retained as a financial record; user_id is null from that point.';

-- ---------------------------------------------------------------------------
-- 2. A refund could leave the money gone and the database unchanged
--
-- refundPayment called Paystack, then ran three updates whose errors it never
-- read, then returned ok. If the payments update failed the row still said
-- 'succeeded', the pass stayed active, and the caller was told the refund
-- worked. Money out, access retained, reporting wrong, nobody any the wiser.
--
-- Two concurrent refunds were also both admitted: each read status
-- 'succeeded', each called the provider.
--
-- refund_started_at is the claim. Taking it is a conditional UPDATE, so exactly
-- one caller can win it, and it is taken BEFORE the provider is called —
-- unlike the status, which must not move until the money is actually back.
-- ---------------------------------------------------------------------------

alter table public.payments
  add column if not exists refund_started_at timestamptz;

comment on column public.payments.refund_started_at is
  'Claimed by whichever caller is refunding this payment, before the provider is called. Cleared if the provider declines.';

/**
 * Claim a payment for refund. Returns the row only to the caller that won it.
 *
 * Callers that lose the race, or that find the payment already refunded or
 * never settled, get nothing back and must not call the provider.
 */
create or replace function public.claim_payment_refund(p_reference text)
returns public.payments
language plpgsql
security definer
set search_path = ''
as $$
declare
  claimed public.payments%rowtype;
begin
  update public.payments
  set refund_started_at = now()
  where reference = p_reference
    and status = 'succeeded'
    and refund_started_at is null
  returning * into claimed;

  return claimed;
end;
$$;

revoke all on function public.claim_payment_refund(text) from public, anon, authenticated;
grant execute on function public.claim_payment_refund(text) to service_role;

/**
 * Finish a refund: mark the payment and revoke what it bought, in one
 * statement each, inside one function so a partial application is not
 * something the caller has to notice and unwind.
 */
create or replace function public.finish_payment_refund(
  p_reference text,
  p_reason text,
  p_actor text,
  p_provider_ref text
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  pay public.payments%rowtype;
begin
  update public.payments
  set status = 'refunded',
      -- Merged, not replaced. The rate and dateKey recorded at checkout are
      -- part of the same financial record and must survive the refund.
      metadata = metadata || jsonb_build_object(
        'refundedAt', now(),
        'refundReason', p_reason,
        'refundedBy', p_actor,
        'providerRefundRef', p_provider_ref
      )
  where reference = p_reference
  returning * into pay;

  if not found then
    return false;
  end if;

  update public.daily_passes set status = 'refunded' where payment_id = pay.id;
  update public.extra_pick_orders set status = 'refunded' where payment_id = pay.id;

  return true;
end;
$$;

revoke all on function public.finish_payment_refund(text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.finish_payment_refund(text, text, text, text) to service_role;

/** Release a claim when the provider declined, so it can be retried. */
create or replace function public.release_payment_refund(p_reference text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.payments set refund_started_at = null where reference = p_reference;
$$;

revoke all on function public.release_payment_refund(text) from public, anon, authenticated;
grant execute on function public.release_payment_refund(text) to service_role;

-- ---------------------------------------------------------------------------
-- 3. Two checkouts at once created two charges
--
-- Both routes checked for ACTIVE access before writing a pending payment, and
-- nothing stopped two concurrent requests each writing one and each opening a
-- Paystack transaction. A customer who completed both paid twice; the unique
-- index on daily_passes meant they got exactly one day either way.
--
-- The application reuses an existing pending reference, which handles the
-- realistic case of a double-tap. These indexes are the backstop for the true
-- simultaneous race, where both requests read before either wrote.
--
-- Scoped so they cannot block legitimate repeat business: one pending day pass
-- per user per day, and one pending extra-picks order per DISTINCT SELECTION,
-- so buying a second league while the first is in flight is still allowed.
-- ---------------------------------------------------------------------------

create unique index if not exists payments_one_pending_pass
  on public.payments (user_id, (metadata ->> 'dateKey'))
  where status = 'pending' and purpose = 'daily_pass';

create unique index if not exists payments_one_pending_extra
  on public.payments (user_id, (metadata ->> 'fixtureKey'))
  where status = 'pending' and purpose = 'extra_picks';

-- ---------------------------------------------------------------------------
-- 4. The pass was granted for the day it settled, not the day it was bought
--
-- activate_daily_pass wrote (now() at time zone 'utc')::date and ignored the
-- dateKey the checkout had already recorded on the payment. A purchase at 23:58
-- confirmed at 00:01 unlocked tomorrow.
--
-- Worse, it made the checkout's own duplicate guard unreliable: that reads
-- date_key for the REQUEST day, so across midnight it could not see the pass
-- the previous request had just created.
--
-- The recorded intent wins, and the settlement date is only the fallback for
-- rows written before checkout stored one.
-- ---------------------------------------------------------------------------

create or replace function public.activate_daily_pass(
  p_user_id uuid,
  p_reference text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  pay public.payments%rowtype;
  pass_id uuid;
  key date;
begin
  select * into pay
  from public.payments
  where reference = p_reference and user_id = p_user_id and purpose = 'daily_pass';

  if not found then
    raise exception 'no matching payment for this account'
      using errcode = '42501';
  end if;

  key := coalesce(
    (pay.metadata ->> 'dateKey')::date,
    (now() at time zone 'utc')::date
  );

  update public.payments
  set status = 'succeeded', settled_at = coalesce(settled_at, now())
  where id = pay.id;

  insert into public.daily_passes (user_id, date_key, amount_usd, currency, payment_id, status)
  values (p_user_id, key, pay.amount_usd, pay.currency, pay.id, 'active')
  on conflict (user_id, date_key) do update
    set status = 'active', payment_id = excluded.payment_id
  returning id into pass_id;

  return pass_id;
end;
$$;

revoke all on function public.activate_daily_pass(uuid, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Slip odds were whatever the client sent
--
-- The route validated that each prediction existed and was pending, then stored
-- the price from the request body and multiplied them into combined_odds. A
-- crafted request could store any positive number, and those figures reach the
-- Office's cross-user slip report.
--
-- The trusted price already existed — pick_json has computed it since
-- 20260815120000. It is lifted into a function here so the slip and the card
-- cannot disagree about what a pick was priced at.
-- ---------------------------------------------------------------------------

create or replace function app.pick_odds(p_prediction_id uuid)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select round(o.pick_odds, 2)
     from public.odds_snapshots o
     where o.prediction_id = p_prediction_id and o.pick_odds is not null
     order by o.captured_at desc
     limit 1),
    (select round((2.60 - (p.confidence_score - 7.0) * 0.28)::numeric, 2)
     from public.predictions p
     where p.id = p_prediction_id)
  );
$$;

/**
 * Create a slip, pricing every leg from the server's own figure.
 *
 * p_combined_odds is no longer trusted either: it is recomputed from the legs,
 * because a client that cannot set a leg price should not be able to set the
 * product of them.
 */
create or replace function public.create_slip(
  p_user_id uuid,
  p_slip_type public.slip_type,
  p_combined_odds numeric,
  p_legs jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  new_slip_id uuid;
  leg jsonb;
  leg_odds numeric;
  combined numeric := 1;
begin
  if p_user_id is null or jsonb_array_length(p_legs) = 0 then
    raise exception 'a slip needs an owner and at least one leg'
      using errcode = '22023';
  end if;

  for leg in select * from jsonb_array_elements(p_legs)
  loop
    combined := combined * app.pick_odds((leg ->> 'prediction_id')::uuid);
  end loop;

  insert into public.slips (user_id, slip_type, status, combined_odds, leg_count)
  values (p_user_id, p_slip_type, 'confirmed', round(combined, 2),
          jsonb_array_length(p_legs))
  returning id into new_slip_id;

  for leg in select * from jsonb_array_elements(p_legs)
  loop
    leg_odds := app.pick_odds((leg ->> 'prediction_id')::uuid);
    insert into public.slip_legs (slip_id, prediction_id, odds, status)
    values (new_slip_id, (leg ->> 'prediction_id')::uuid, leg_odds, 'pending');
  end loop;

  return new_slip_id;
end;
$$;

revoke all on function public.create_slip(uuid, public.slip_type, numeric, jsonb)
  from public, anon, authenticated;
