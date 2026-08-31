-- ============================================================================
-- The results email: who gets it, and what decides it is time to send
--
-- The board tells people what it predicted every morning and never told them
-- what happened. This adds the bookend — one message once every game on the
-- day's board has finished, carrying the calls, the verdicts and the day's win
-- rate — and the switch an operator needs to control it.
--
-- WHY A POLICY TABLE RATHER THAN app.settings
--
-- app.settings holds cron_secret. Every read of it is written carefully for
-- that reason, and adding a routine, Office-editable value beside a credential
-- is how the careful reads eventually stop being careful. This lives in its
-- own table, in public, where RLS can describe it honestly.
--
-- THE POLICY DOES NOT OVERRIDE A PERSON'S OWN CHOICE
--
-- Mode 'all' means "everyone who has asked to hear from us", not "everyone".
-- The send intersects this policy with notification_preferences, so somebody
-- who turned alerts off stays off whatever an operator selects. An admin
-- toggle that could mail people who opted out is not a feature, it is a
-- complaint waiting to be filed.
-- ============================================================================

create table if not exists public.settlement_email_policy (
  -- Single row, enforced by the primary key rather than by everyone
  -- remembering. `check (id)` makes true the only permitted value.
  id          boolean primary key default true check (id),
  mode        text not null default 'all' check (mode in ('all', 'selected', 'off')),
  user_ids    uuid[] not null default '{}',
  updated_at  timestamptz not null default now(),
  updated_by  text
);

insert into public.settlement_email_policy (id) values (true)
on conflict (id) do nothing;

alter table public.settlement_email_policy enable row level security;

comment on table public.settlement_email_policy is
  'Who receives the end-of-day results email. Intersected with notification_preferences at send time: this widens nothing, it only narrows.';

-- No client touches this table directly; both directions go through the
-- functions below, which check app.is_super_admin().
revoke all on table public.settlement_email_policy from anon, authenticated;

create or replace function public.get_settlement_policy()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.settlement_email_policy%rowtype;
begin
  if not (select app.is_super_admin()) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select * into p from public.settlement_email_policy where id;

  return jsonb_build_object(
    'mode', coalesce(p.mode, 'all'),
    'userIds', coalesce(to_jsonb(p.user_ids), '[]'::jsonb),
    'updatedAt', p.updated_at,
    'updatedBy', p.updated_by
  );
end;
$$;

grant execute on function public.get_settlement_policy() to authenticated;

create or replace function public.set_settlement_policy(
  p_mode text,
  p_user_ids uuid[],
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (select app.is_super_admin()) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  if p_mode not in ('all', 'selected', 'off') then
    raise exception 'unknown mode %', p_mode using errcode = '22023';
  end if;

  -- "Selected" with nobody selected is 'off' wearing a different label, and
  -- the difference matters when somebody reads the setting back later and
  -- believes mail is going out.
  if p_mode = 'selected' and coalesce(array_length(p_user_ids, 1), 0) = 0 then
    raise exception 'choose at least one recipient, or set the mode to off'
      using errcode = '22023';
  end if;

  update public.settlement_email_policy
  set mode = p_mode,
      user_ids = case when p_mode = 'selected' then p_user_ids else '{}'::uuid[] end,
      updated_at = now(),
      updated_by = p_actor
  where id;

  return public.get_settlement_policy();
end;
$$;

revoke all on function public.set_settlement_policy(text, uuid[], text)
  from public, anon, authenticated;
grant execute on function public.set_settlement_policy(text, uuid[], text) to service_role;

-- ============================================================================
-- Deciding the day is over, exactly once
--
-- Called after every grading pass. It answers a narrow question — is the whole
-- of today's board settled, and has nobody queued this yet — and queues the
-- job if so.
--
-- The advisory lock is what makes "exactly once" true rather than likely. Two
-- graders finishing together would both read no existing job and both insert
-- one, and the result is every subscriber receiving the day's results twice.
-- The lock is transaction-scoped, so it is released whatever happens next.
-- ============================================================================
create or replace function app.queue_daily_results(p_date date)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  total    integer;
  pending  integer;
begin
  perform pg_advisory_xact_lock(hashtext('kicka_daily_results_' || p_date::text));

  if exists (
    select 1 from public.jobs
    where kind = 'daily_results_ready'
      and payload ->> 'dateKey' = p_date::text
  ) then
    return false;
  end if;

  select
    count(*),
    count(*) filter (where p.status = 'pending')
  into total, pending
  from public.predictions p
  join public.fixtures f on f.id = p.fixture_id
  where p.tier = 'primary'
    and f.fixture_date >= p_date::timestamp at time zone 'utc'
    and f.fixture_date <  (p_date + 1)::timestamp at time zone 'utc';

  -- Nothing to report on, or the day is still running.
  if total = 0 or pending > 0 then
    return false;
  end if;

  insert into public.jobs (kind, payload)
  values ('daily_results_ready', jsonb_build_object('dateKey', p_date::text));

  return true;
end;
$$;

comment on function app.queue_daily_results(date) is
  'Queues the end-of-day results email once, when every board pick for the day has settled.';

create or replace function public.queue_daily_results(p_date date)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select app.queue_daily_results(p_date);
$$;

revoke all on function public.queue_daily_results(date) from public, anon, authenticated;
grant execute on function public.queue_daily_results(date) to service_role;
