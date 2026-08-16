-- ============================================================================
-- MoonOdds, transactional RPCs
--
-- Convex mutations were single ACID transactions. Anywhere the port turned one
-- mutation into several writes, the writes go back into one function so a
-- partial failure can't leave inconsistent rows.
-- ============================================================================

/**
 * Create a slip and its legs atomically.
 *
 * Without this, a failure between the two inserts leaves a slip with a
 * combined-odds figure and no legs to justify it.
 */
create or replace function public.create_slip(
  p_user_id uuid,
  p_slip_type slip_type,
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
begin
  if p_user_id is null or jsonb_array_length(p_legs) = 0 then
    raise exception 'a slip needs an owner and at least one leg'
      using errcode = '22023';
  end if;

  insert into public.slips (user_id, slip_type, status, combined_odds, leg_count)
  values (p_user_id, p_slip_type, 'confirmed', p_combined_odds,
          jsonb_array_length(p_legs))
  returning id into new_slip_id;

  for leg in select * from jsonb_array_elements(p_legs)
  loop
    insert into public.slip_legs (slip_id, prediction_id, odds, status)
    values (
      new_slip_id,
      (leg ->> 'prediction_id')::uuid,
      (leg ->> 'odds')::numeric,
      'pending'
    );
  end loop;

  return new_slip_id;
end;
$$;

revoke all on function public.create_slip(uuid, slip_type, numeric, jsonb)
  from public, anon, authenticated;

/**
 * Activate a daily pass against an already-verified payment.
 *
 * The payment row is what binds a Paystack reference to its buyer. The Convex
 * original checked only that the reference was valid and paid, never that it
 * belonged to the caller, so a known-good reference could unlock a pass on any
 * account. Here the ownership check is a WHERE clause.
 */
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
begin
  select * into pay
  from public.payments
  where reference = p_reference and user_id = p_user_id and purpose = 'daily_pass';

  if not found then
    raise exception 'no matching payment for this account'
      using errcode = '42501';
  end if;

  update public.payments
  set status = 'succeeded', settled_at = coalesce(settled_at, now())
  where id = pay.id;

  insert into public.daily_passes (user_id, date_key, amount_usd, currency, payment_id, status)
  values (p_user_id, (now() at time zone 'utc')::date, pay.amount_usd, pay.currency, pay.id, 'active')
  on conflict (user_id, date_key) do update
    set status = 'active', payment_id = excluded.payment_id
  returning id into pass_id;

  return pass_id;
end;
$$;

revoke all on function public.activate_daily_pass(uuid, text)
  from public, anon, authenticated;

/** Record an extra-picks order against a verified, owned payment. */
create or replace function public.activate_extra_picks(
  p_user_id uuid,
  p_reference text,
  p_league_ids uuid[],
  p_fixture_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  pay public.payments%rowtype;
  order_id uuid;
begin
  select * into pay
  from public.payments
  where reference = p_reference and user_id = p_user_id and purpose = 'extra_picks';

  if not found then
    raise exception 'no matching payment for this account'
      using errcode = '42501';
  end if;

  -- Idempotent: the same reference must never produce two orders.
  select id into order_id from public.extra_pick_orders where payment_id = pay.id;
  if found then
    return order_id;
  end if;

  update public.payments
  set status = 'succeeded', settled_at = coalesce(settled_at, now())
  where id = pay.id;

  insert into public.extra_pick_orders (
    user_id, date_key, league_ids, fixture_ids, num_games,
    amount_usd, currency, payment_id, status
  )
  values (
    p_user_id, (now() at time zone 'utc')::date, p_league_ids, p_fixture_ids,
    coalesce(array_length(p_fixture_ids, 1), 0), pay.amount_usd, pay.currency,
    pay.id, 'active'
  )
  returning id into order_id;

  return order_id;
end;
$$;

revoke all on function public.activate_extra_picks(uuid, text, uuid[], uuid[])
  from public, anon, authenticated;

/**
 * Apply an approved tuning report to the active config.
 *
 * Reads the proposals off the report rather than taking them as arguments, so
 * the Office panel cannot submit changes that were never reviewed.
 */
create or replace function public.apply_tuning_report(p_report_id uuid, p_approver text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  rep public.tuning_reports%rowtype;
  cfg public.ai_engine_config%rowtype;
  weights jsonb;
  thresholds jsonb;
  change jsonb;
begin
  select * into rep from public.tuning_reports where id = p_report_id;
  if not found then
    raise exception 'report not found' using errcode = 'P0002';
  end if;
  if rep.status <> 'pending' then
    raise exception 'report is already %', rep.status using errcode = '22023';
  end if;

  select * into cfg from public.ai_engine_config where id = rep.config_id;
  weights := cfg.ranking_weights;
  thresholds := cfg.confidence_thresholds;

  for change in select * from jsonb_array_elements(rep.proposed_weight_changes)
  loop
    weights := jsonb_set(
      weights,
      array[change ->> 'parameter'],
      to_jsonb((change ->> 'proposed_value')::numeric)
    );
  end loop;

  for change in select * from jsonb_array_elements(rep.proposed_threshold_changes)
  loop
    thresholds := jsonb_set(
      thresholds,
      array[change ->> 'parameter'],
      to_jsonb((change ->> 'proposed_value')::numeric)
    );
  end loop;

  update public.ai_engine_config
  set ranking_weights = weights,
      confidence_thresholds = thresholds,
      last_updated_at = now(),
      approved_by = p_approver
  where id = cfg.id;

  update public.tuning_reports
  set status = 'approved', approved_by = p_approver, approved_at = now()
  where id = p_report_id;
end;
$$;

revoke all on function public.apply_tuning_report(uuid, text)
  from public, anon, authenticated;
