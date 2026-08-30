-- ============================================================================
-- Three money-and-access gaps from the platform audit, and one credential
--
-- 1. A SUSPENDED ACCOUNT COULD STILL BE CHARGED
--
-- app.access_state gives a suspended user a pick limit of zero; can_purchase
-- checked self-exclusion and the spend cap and never asked about suspension.
-- So checkout took $3 and the board then showed them nothing. The Terms
-- contemplate withholding what somebody already bought — taking NEW money for
-- something we will not deliver is a different thing, and it is the shape of a
-- chargeback rather than a policy.
--
-- 2. A PASS BOUGHT AT 23:50 EXPIRED AT MIDNIGHT
--
-- The pass is keyed to the UTC day, and this product sells into a market that
-- keeps UTC as local time, so a late-night buyer paid full price for minutes
-- of a board whose fixtures had all kicked off. roll_unserved_passes could not
-- catch it — it runs at 23:45, and only for days that published nothing.
--
-- The decision moves to activation, where it is knowable and the customer is
-- still there: if no board pick is left to kick off, the pass is issued for
-- the next day they do not already hold. The extras add-on was accidentally
-- immune to this all along — its draw window empties and it refuses to charge
-- rather than selling an empty basket.
--
-- 3. A PAID EXTRA BECAME FREE THE MOMENT IT SETTLED
--
-- app.pick_json_gated unlocks on `entitled OR settled`. For the board that is
-- right and deliberate: /history publishes every settled call in full. For an
-- extra it silently overrode the rule in get_prediction_detail, which says
-- only the buyer sees one. Not reachable today — no public read hands out an
-- extra's id — but two access rules disagreeing is how the next endpoint leaks.
-- The board keeps the behaviour; the paid tier no longer inherits it.
--
-- 4. THE OFFICE SECOND FACTOR WAS STORED IN PLAINTEXT
--
-- otp_tokens.code held the six digits as typed. RLS keeps every client out, so
-- this needs a database read to matter — a backup, a replica, a support query,
-- an accidental grant. But it is the second factor on system-prompt changes,
-- and the whole point of a second factor is that the first one being
-- compromised is not enough. The column now holds an HMAC; the application
-- keys it with a value that never reaches the database, so a reader cannot
-- brute-force six digits back out of it.
--
-- Outstanding codes are deleted rather than migrated. They live for minutes
-- and there is no plaintext to convert them from.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Suspension is a reason not to charge.
-- ---------------------------------------------------------------------------
create or replace function public.can_purchase(p_amount_usd numeric)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  pp public.player_protection%rowtype;
  spent numeric;
begin
  if uid is null then
    return jsonb_build_object('allowed', false, 'reason', 'Sign in first.');
  end if;

  /*
   * A suspended account cannot be charged.
   *
   * app.access_state already gives a suspended user a pick limit of ZERO, so
   * the money and the product had come apart: checkout took $3 and the board
   * then showed them nothing. The Terms contemplate withholding what somebody
   * already bought — taking NEW money for something we will not deliver is a
   * different thing, and it is the shape of a chargeback rather than a policy.
   *
   * First, before self-exclusion and the spend cap, because it is the reason
   * that outranks both.
   */
  if exists (
    select 1 from public.profiles p where p.id = uid and p.is_suspended
  ) then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'This account is suspended, so there is nothing a pass would unlock. Email hello@kicka.app and we will look at it.'
    );
  end if;

  select * into pp from public.player_protection where user_id = uid;

  if found and pp.excluded_until is not null and pp.excluded_until > now() then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'You have self-excluded until ' || to_char(pp.excluded_until, 'DD Mon YYYY') || '.',
      'excludedUntil', pp.excluded_until
    );
  end if;

  if found and pp.monthly_spend_cap_usd is not null then
    select coalesce(sum(amount_usd), 0) into spent
    from public.payments
    where user_id = uid and status = 'succeeded'
      and created_at > now() - interval '30 days';

    if spent + coalesce(p_amount_usd, 0) > pp.monthly_spend_cap_usd then
      return jsonb_build_object(
        'allowed', false,
        'reason', 'That would take you past the monthly limit you set ($'
                  || pp.monthly_spend_cap_usd || ').',
        'spentThisMonthUsd', spent,
        'monthlyCapUsd', pp.monthly_spend_cap_usd
      );
    end if;
  end if;

  return jsonb_build_object('allowed', true);
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. A pass with nothing left to unlock today is issued for tomorrow.
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

  /*
   * A pass bought after the last kickoff is a pass for tomorrow.
   *
   * A day pass expires at midnight UTC, and this product sells into a market
   * that keeps UTC as local time. Someone buying at 23:50 was charged $3 for
   * ten minutes of a board whose every fixture had already started — nothing
   * left to act on, and the free record shows the results anyway.
   *
   * roll_unserved_passes could not catch it: it runs at 23:45, for days that
   * published nothing at all, and neither condition fits. So the decision
   * moves to the moment of activation, where the answer is knowable and the
   * customer is still watching.
   *
   * The test is whether any BOARD pick is still to kick off. Extras are not
   * part of what a pass buys, and a settled pick is already public.
   */
  if key = (now() at time zone 'utc')::date
     and not exists (
       select 1
       from public.predictions p
       join public.fixtures f on f.id = p.fixture_id
       where p.tier = 'primary'
         and p.status = 'pending'
         and f.status = 'scheduled'
         and f.fixture_date > now()
         and f.fixture_date < ((key + 1)::timestamp at time zone 'utc')
     )
  then
    -- The next day they do not already hold, exactly as roll_unserved_passes
    -- does it: without the walk, a customer who had bought tomorrow in advance
    -- would collide with the unique index and lose the day they just paid for.
    key := key + 1;
    while exists (
      select 1 from public.daily_passes
      where user_id = p_user_id and date_key = key
    ) loop
      key := key + 1;
    end loop;
  end if;

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

-- ---------------------------------------------------------------------------
-- 3. Settled means public only for the tier that was published.
-- ---------------------------------------------------------------------------
create or replace function app.pick_json_gated(
  p public.predictions,
  entitled boolean
)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when entitled or (p.status in ('won', 'lost') and p.tier = 'primary')
      then app.pick_json(p)
    else app.pick_json_locked(p)
  end;
$$;

-- ---------------------------------------------------------------------------
-- 4. The confirmation code is stored as a digest.
-- ---------------------------------------------------------------------------
delete from public.otp_tokens;

alter table public.otp_tokens rename column code to code_hash;

comment on column public.otp_tokens.code_hash is
  'HMAC-SHA256 of the six digits, keyed in the application with a value derived from the service-role secret. The key is never in this database, which is the point: a salted digest of a six-digit code is brute-forced instantly by anyone who can read the row.';
