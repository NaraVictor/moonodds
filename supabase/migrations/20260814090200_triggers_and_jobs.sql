-- ============================================================================
-- MoonOdds, auth wiring, job queue mechanics, settings
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Settings
--
-- pg_cron runs inside the database and needs to know where the app lives.
-- Keeping it in a table (rather than baked into the cron command) means the
-- same migrations work locally, in preview and in production.
-- ---------------------------------------------------------------------------

create table if not exists app.settings (
  key    text primary key,
  value  text not null
);

insert into app.settings (key, value) values
  ('app_base_url', 'http://host.docker.internal:3100'),
  ('cron_secret', 'local-dev-cron-secret')
on conflict (key) do nothing;

create or replace function app.setting(k text)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select value from app.settings where key = k;
$$;

-- ---------------------------------------------------------------------------
-- New user -> profile
--
-- Replaces Convex's updateCurrentUser bootstrap mutation, which the client had
-- to remember to call on every sign-in. A trigger cannot be forgotten.
-- ---------------------------------------------------------------------------

create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(
      new.raw_user_meta_data ->> 'display_name',
      new.raw_user_meta_data ->> 'full_name',
      split_part(coalesce(new.email, 'player'), '@', 1)
    )
  )
  on conflict (id) do nothing;

  -- Sensible notification defaults so the profile page has something to show.
  insert into public.notification_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();

-- Keep the denormalised email in step if the user changes it.
create or replace function app.handle_user_email_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_updated on auth.users;
create trigger on_auth_user_updated
  after update on auth.users
  for each row execute function app.handle_user_email_change();

-- ---------------------------------------------------------------------------
-- Job queue
-- ---------------------------------------------------------------------------

create or replace function app.enqueue(
  job_kind text,
  job_payload jsonb default '{}'::jsonb,
  delay interval default '0 seconds'
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  insert into public.jobs (kind, payload, run_after)
  values (job_kind, job_payload, now() + delay)
  returning id;
$$;

/**
 * Claim a batch of due jobs.
 *
 * FOR UPDATE SKIP LOCKED is what makes this safe to run from several workers
 * at once, each transaction takes rows nobody else holds, instead of blocking.
 */
create or replace function app.claim_jobs(batch_size integer default 20)
returns setof public.jobs
language sql
security definer
set search_path = ''
as $$
  update public.jobs j
  set status = 'running',
      locked_at = now(),
      attempts = j.attempts + 1
  where j.id in (
    select id from public.jobs
    where status = 'queued' and run_after <= now()
    order by run_after
    limit greatest(coalesce(batch_size, 20), 1)
    for update skip locked
  )
  returning j.*;
$$;

create or replace function app.complete_job(job_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.jobs
  set status = 'done', completed_at = now(), last_error = null, locked_at = null
  where id = job_id;
$$;

/**
 * Fail a job. Retries with exponential backoff until max_attempts, then parks
 * the row in 'dead' so it stays visible instead of disappearing.
 */
create or replace function app.fail_job(job_id uuid, err text)
returns void
language sql
security definer
set search_path = ''
as $$
  update public.jobs
  set status = (case when attempts >= max_attempts then 'dead' else 'queued' end)::public.job_status,
      run_after = now() + (interval '30 seconds' * power(2, least(attempts, 6))),
      last_error = left(err, 2000),
      locked_at = null
  where id = job_id;
$$;

-- Requeue anything a crashed worker left claimed.
create or replace function app.reap_stalled_jobs(older_than interval default '10 minutes')
returns integer
language sql
security definer
set search_path = ''
as $$
  with reaped as (
    update public.jobs
    set status = 'queued', locked_at = null
    where status = 'running' and locked_at < now() - older_than
    returning 1
  )
  select count(*)::integer from reaped;
$$;
