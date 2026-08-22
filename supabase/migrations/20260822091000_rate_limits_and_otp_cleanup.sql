-- ---------------------------------------------------------------------------
-- Kicka, rate limiting that survives more than one instance, and OTP cleanup
--
-- The limiter was an in-process Map. On a serverless deployment every instance
-- carries its own counters, so the effective limit was the configured limit
-- multiplied by however many instances happened to be warm — weakest under
-- exactly the load that spins up more of them. Checkout was the surface that
-- mattered: unbounded `payments` row creation is cheap to trigger and
-- permanent for us.
--
-- Postgres rather than Redis because the database is already a hard dependency
-- on every one of these paths, so this adds no new failure mode and no new
-- service. One row per (key, window), incremented atomically.
-- ---------------------------------------------------------------------------

create table if not exists rate_limits (
  key         text        not null,
  window_end  timestamptz not null,
  count       integer     not null default 0,
  primary key (key, window_end)
);

-- Reads never scan this; only the sweep does.
create index if not exists rate_limits_expiry_idx on rate_limits (window_end);

alter table rate_limits enable row level security;
-- No policies, deliberately: this is written only by the service role through
-- the function below. RLS on with no policy denies every client role outright.

revoke all on table rate_limits from anon, authenticated;

/**
 * Count one hit and say whether it is allowed.
 *
 * The window is a fixed bucket derived from the current time, so two instances
 * computing it independently land on the same row and the insert collides
 * rather than diverging. `on conflict do update` makes the increment atomic,
 * which is the whole reason this is a function and not two statements.
 */
create or replace function public.hit_rate_limit(
  p_key text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, remaining integer, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  bucket_end timestamptz;
  new_count  integer;
begin
  -- Align to a fixed grid so concurrent callers agree on the bucket.
  bucket_end := to_timestamp(
    (ceil(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds)
  );

  insert into public.rate_limits (key, window_end, count)
  values (p_key, bucket_end, 1)
  on conflict (key, window_end)
    do update set count = public.rate_limits.count + 1
  returning count into new_count;

  return query select
    new_count <= p_limit,
    greatest(0, p_limit - new_count),
    greatest(1, ceil(extract(epoch from bucket_end - clock_timestamp()))::integer);
end;
$$;

revoke all on function public.hit_rate_limit(text, integer, integer)
  from public, anon, authenticated;

/**
 * Housekeeping for both tables.
 *
 * otp_tokens rows were marked used and left forever, one per prompt edit. They
 * are denied to every client role so this was size rather than exposure, but a
 * table that only grows is a table nobody notices until it matters.
 */
create or replace function app.sweep_expired()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  limits_removed integer;
  otps_removed   integer;
begin
  delete from public.rate_limits where window_end < now() - interval '1 hour';
  get diagnostics limits_removed = row_count;

  delete from public.otp_tokens
  where used = true or expires_at < now() - interval '1 day';
  get diagnostics otps_removed = row_count;

  return jsonb_build_object('rateLimits', limits_removed, 'otpTokens', otps_removed);
end;
$$;

-- Rides along with the existing stalled-job reaper rather than adding a cron
-- entry: it runs every ten minutes and this is the same kind of housekeeping.
select cron.schedule(
  'kicka_sweep_expired',
  '*/30 * * * *',
  $$select app.sweep_expired()$$
);
