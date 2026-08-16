-- ============================================================================
-- Player protection, age verification, and an admin audit trail
--
-- The product sells betting analysis to consumers and had none of the three.
-- These are the mechanisms; the policy around them (which markets, what
-- minimum exclusion period, what the operator must do when someone excludes)
-- is a question for counsel in each market, and the schema is deliberately
-- permissive enough not to prejudge it.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Date of birth, held for age verification
--
-- The age gate wrote a boolean to localStorage and asked for nothing. The
-- Terms assert an 18+ restriction, so the product needs to hold something that
-- makes that claim true rather than decorative.
--
-- Stored as a date, not an age: an age is wrong within a year of being written
-- and cannot be re-derived.
-- ---------------------------------------------------------------------------
alter table profiles
  add column if not exists date_of_birth date,
  add column if not exists age_verified_at timestamptz;

comment on column profiles.date_of_birth is
  'Self-declared. Sufficient for an 18+ gate; not identity verification.';

-- ---------------------------------------------------------------------------
-- Self-exclusion and limits
--
-- One row per user. A null excluded_until means not excluded; a future date
-- means they are, and the access RPC honours it above any pass they hold.
--
-- Deliberately NOT self-serve to reverse: the whole point of a cooling-off
-- period is that the person who set it cannot undo it in the moment they most
-- want to. Shortening it requires an operator.
-- ---------------------------------------------------------------------------
create table if not exists player_protection (
  user_id            uuid primary key references profiles (id) on delete cascade,

  -- Self-exclusion. Null when not excluded.
  excluded_at        timestamptz,
  excluded_until     timestamptz,
  exclusion_reason   text,

  -- Spend ceiling, in USD, over a rolling 30 days. Null means no limit set.
  monthly_spend_cap_usd numeric(8, 2)
                       check (monthly_spend_cap_usd is null or monthly_spend_cap_usd > 0),

  -- Reality check: remind me after this many minutes in a session.
  reality_check_minutes integer
                       check (reality_check_minutes is null or reality_check_minutes >= 5),

  updated_at         timestamptz not null default now(),
  created_at         timestamptz not null default now()
);

create index if not exists player_protection_excluded_idx
  on player_protection (excluded_until)
  where excluded_until is not null;

alter table player_protection enable row level security;

create policy player_protection_own_read on player_protection
  for select to authenticated
  using (user_id = (select auth.uid()));

/**
 * Set or extend a self-exclusion.
 *
 * Extending is always allowed; shortening is refused. Someone reaching for this
 * control is protecting themselves from a decision they expect to want to
 * reverse, and honouring the reversal defeats it.
 */
create or replace function public.set_self_exclusion(p_days integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  until_ts timestamptz;
  current_until timestamptz;
begin
  if uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;
  if p_days is null or p_days < 1 or p_days > 3650 then
    raise exception 'exclusion must be between 1 and 3650 days' using errcode = '22023';
  end if;

  until_ts := now() + make_interval(days => p_days);

  select pp.excluded_until into current_until
  from public.player_protection pp where pp.user_id = uid;

  if current_until is not null and current_until > until_ts then
    raise exception 'an existing exclusion runs longer than that and cannot be shortened here'
      using errcode = '22023';
  end if;

  insert into public.player_protection as pp (user_id, excluded_at, excluded_until)
  values (uid, now(), until_ts)
  on conflict (user_id) do update
    set excluded_at    = coalesce(pp.excluded_at, now()),
        excluded_until = excluded.excluded_until,
        updated_at     = now();

  return jsonb_build_object('excludedUntil', until_ts);
end;
$$;

/** Set or clear a monthly spend cap and a reality-check interval. */
create or replace function public.set_play_limits(
  p_monthly_cap_usd numeric default null,
  p_reality_check_minutes integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
begin
  if uid is null then
    raise exception 'sign in first' using errcode = '42501';
  end if;

  insert into public.player_protection as pp (user_id, monthly_spend_cap_usd, reality_check_minutes)
  values (uid, p_monthly_cap_usd, p_reality_check_minutes)
  on conflict (user_id) do update
    set monthly_spend_cap_usd = excluded.monthly_spend_cap_usd,
        reality_check_minutes = excluded.reality_check_minutes,
        updated_at            = now();

  return jsonb_build_object(
    'monthlyCapUsd', p_monthly_cap_usd,
    'realityCheckMinutes', p_reality_check_minutes
  );
end;
$$;

/** The caller's own protection settings, plus what they have spent this month. */
create or replace function public.get_play_limits()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'excludedUntil', pp.excluded_until,
    'isExcluded', pp.excluded_until is not null and pp.excluded_until > now(),
    'monthlyCapUsd', pp.monthly_spend_cap_usd,
    'realityCheckMinutes', pp.reality_check_minutes,
    'spentThisMonthUsd', coalesce((
      select round(sum(amount_usd), 2)
      from public.payments
      where user_id = (select auth.uid())
        and status = 'succeeded'
        and created_at > now() - interval '30 days'
    ), 0)
  )
  from (select 1) _
  left join public.player_protection pp on pp.user_id = (select auth.uid());
$$;

/**
 * Is this user allowed to buy right now?
 *
 * Called by the checkout routes before any money moves. Returns the reason when
 * the answer is no, so the interface can say something specific rather than
 * failing generically.
 */
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
-- Admin audit trail
--
-- The Office can delete accounts, comp passes, override predictions, promote
-- engine configs and rewrite the system prompt. Only prediction overrides
-- recorded who did it. After an incident, none of the rest could be
-- reconstructed.
--
-- No update or delete policy exists for anyone, including admins: an audit log
-- an operator can edit is not an audit log.
-- ---------------------------------------------------------------------------
create table if not exists admin_audit_log (
  id           bigint generated always as identity primary key,
  actor_id     uuid references profiles (id) on delete set null,
  actor_email  text,
  action       text not null,
  target_type  text,
  target_id    text,
  detail       jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists admin_audit_log_created_idx on admin_audit_log (created_at desc);
create index if not exists admin_audit_log_actor_idx on admin_audit_log (actor_id, created_at desc);
create index if not exists admin_audit_log_action_idx on admin_audit_log (action, created_at desc);

alter table admin_audit_log enable row level security;

create policy admin_audit_read on admin_audit_log
  for select to authenticated
  using (
    exists (
      select 1 from public.profiles
      where id = (select auth.uid()) and is_super_admin
    )
  );

/** Write one line into the audit log. Service role only; never from a client. */
create or replace function public.record_admin_action(
  p_actor_id    uuid,
  p_actor_email text,
  p_action      text,
  p_target_type text default null,
  p_target_id   text default null,
  p_detail      jsonb default '{}'::jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.admin_audit_log
    (actor_id, actor_email, action, target_type, target_id, detail)
  values (p_actor_id, p_actor_email, p_action, p_target_type, p_target_id, p_detail);
$$;

revoke execute on function public.record_admin_action(uuid, text, text, text, text, jsonb) from public, anon, authenticated;

grant execute on function public.set_self_exclusion(integer) to authenticated;
grant execute on function public.set_play_limits(numeric, integer) to authenticated;
grant execute on function public.get_play_limits() to authenticated;
grant execute on function public.can_purchase(numeric) to authenticated;
grant select on player_protection, admin_audit_log to authenticated;

-- ---------------------------------------------------------------------------
-- Enforcement
--
-- A self-exclusion that records intent and changes nothing is worse than none
-- at all: it tells someone they are protected while the product keeps selling
-- to them. This is the half that makes it real.
--
-- Checked immediately after suspension and before any pass, so an active pass
-- does not survive an exclusion. That is the deliberate direction: someone who
-- excludes mid-pass loses access they paid for, which is the correct trade and
-- is why the checkout warns before the exclusion is set.
-- ---------------------------------------------------------------------------
create or replace function app.access_state()
returns table (has_full_access boolean, is_first_day boolean, pick_limit integer)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  free_pick_limit constant integer := 2;
  today date := (select app.utc_today());
  prof public.profiles%rowtype;
  has_pass boolean;
  excluded_to timestamptz;
begin
  -- Signed out: the same free allowance a new account gets on its first day.
  if uid is null then
    return query select false, false, free_pick_limit;
    return;
  end if;

  select * into prof from public.profiles p where p.id = uid;

  -- A missing profile is treated as untrusted rather than as a guest: it means
  -- an authenticated session with no matching row, which should never happen
  -- and should not be rewarded with picks.
  if not found or prof.is_suspended then
    return query select false, false, 0;
    return;
  end if;

  -- Self-exclusion outranks everything below it, including an active pass and
  -- the standing free allowance. Zero, not free_pick_limit: someone who has
  -- excluded themselves should not be handed two picks as a consolation.
  select pp.excluded_until into excluded_to
  from public.player_protection pp where pp.user_id = uid;

  if excluded_to is not null and excluded_to > now() then
    return query select false, false, 0;
    return;
  end if;

  if prof.is_super_admin then
    return query select true, false, 2147483647;
    return;
  end if;

  select exists (
    select 1 from public.daily_passes dp
    where dp.user_id = uid and dp.date_key = today and dp.status = 'active'
  ) into has_pass;

  if has_pass then
    return query select true, false, 2147483647;
    return;
  end if;

  if (select app.first_seen_date(uid)) = today then
    return query select false, true, free_pick_limit;
    return;
  end if;

  -- Returning visitor with no pass still gets the standing free allowance,
  -- so the board is never a wall of locks for anyone.
  return query select false, false, free_pick_limit;
end;
$$;

-- Surface the exclusion so the interface can explain why the board is empty
-- rather than looking broken.
create or replace function public.get_access_state()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'hasFullAccess', s.has_full_access,
    'isFirstDay', s.is_first_day,
    'freePickLimit', case when s.pick_limit > 1000000 then 0 else s.pick_limit end,
    'isSuperAdmin', (select app.is_super_admin()),
    'isSuspended', (select app.is_suspended()),
    'isSelfExcluded', coalesce((
      select pp.excluded_until > now()
      from public.player_protection pp where pp.user_id = (select auth.uid())
    ), false),
    'excludedUntil', (
      select pp.excluded_until
      from public.player_protection pp
      where pp.user_id = (select auth.uid()) and pp.excluded_until > now()
    )
  )
  from app.access_state() s;
$$;

-- ---------------------------------------------------------------------------
-- Extra picks honour the exclusion too
--
-- Found by testing the exclusion rather than by reading the code: this RPC
-- reads straight from extra_pick_orders and never consulted access_state, so a
-- self-excluded user with a paid order still received the full unlocked pick,
-- reasoning included. Suspension had the same hole.
--
-- The order stays valid and is not refunded here. Access resumes when the
-- exclusion lapses, which is the same treatment a day pass gets.
-- ---------------------------------------------------------------------------
create or replace function public.get_my_extra_picks()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(app.pick_json(p) order by p.confidence_score desc), '[]'::jsonb)
  from public.predictions p
  where (select auth.uid()) is not null
    and not (select app.is_suspended())
    and not coalesce((
      select pp.excluded_until > now()
      from public.player_protection pp
      where pp.user_id = (select auth.uid())
    ), false)
    and p.fixture_id in (
      select unnest(o.fixture_ids)
      from public.extra_pick_orders o
      where o.user_id = (select auth.uid())
        and o.date_key = (select app.utc_today())
        and o.status = 'active'
    );
$$;

-- ---------------------------------------------------------------------------
-- Carry the declared date of birth onto the profile
--
-- The sign-up action validates the age and passes the date in user metadata,
-- which is user-writable. The check that matters already happened server-side
-- in the action; this stores the value so the claim is auditable rather than
-- momentary. Treat the column as declared, not verified.
-- ---------------------------------------------------------------------------
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  declared_dob date;
begin
  begin
    declared_dob := (new.raw_user_meta_data ->> 'date_of_birth')::date;
  exception when others then
    declared_dob := null;
  end;

  insert into public.profiles (id, email, display_name, date_of_birth, age_verified_at)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'display_name',
      new.raw_user_meta_data ->> 'full_name',
      split_part(coalesce(new.email, 'player'), '@', 1)
    ),
    declared_dob,
    case when declared_dob is not null then now() else null end
  )
  on conflict (id) do nothing;

  insert into public.notification_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

-- date_of_birth joins the columns a user may not rewrite on themselves.
-- Without this, anyone could PATCH their own profile and move the date the 18+
-- claim rests on.
--
-- Replaces app.guard_profile_privileges in place, keeping both escape hatches
-- it already had: a null auth.uid() (a direct database connection, which cannot
-- be a privilege-escalation vector) and the service role.
create or replace function app.guard_profile_privileges()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or (select auth.role()) = 'service_role'
     or (select app.is_super_admin()) then
    return new;
  end if;

  if new.is_super_admin is distinct from old.is_super_admin
     or new.is_suspended is distinct from old.is_suspended
     or new.date_of_birth is distinct from old.date_of_birth
     or new.age_verified_at is distinct from old.age_verified_at then
    raise exception 'cannot modify privilege columns' using errcode = '42501';
  end if;

  return new;
end;
$$;
