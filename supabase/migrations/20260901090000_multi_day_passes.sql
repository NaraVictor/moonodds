-- ============================================================================
-- A pass that lasts longer than a day
--
-- $3 a day is not an expensive product; it is an expensive HABIT. Somebody who
-- wants this every morning was being asked for roughly $90 a month, one
-- transaction at a time, each with its own moment to reconsider — and on this
-- account not one of five attempts has completed. The daily price was never
-- the obstacle. The daily decision was.
--
-- N ROWS, NOT A DATE RANGE
--
-- The obvious design is valid_from/valid_to on one row. It is the wrong one
-- here: app.access_state, roll_unserved_passes, the checkout's "you already
-- have today" check and the Office all read (user_id, date_key), and a range
-- would mean editing every one of them and hoping none was missed.
--
-- A seven-day pass writes seven rows instead. Every guarantee already in place
-- keeps working untouched: the unique index still prevents a double-grant, the
-- nightly rollover still moves a day that published nothing, and access_state
-- does not learn a new concept. Thirty rows for a month is nothing.
--
-- WHICH DAYS
--
-- Not simply "the next N dates". The cursor advances past any day the buyer
-- already holds, so buying a week on top of a day you own gives you seven MORE
-- days rather than six and a collision. And the first day still rolls forward
-- when nothing on today's board is left to kick off, exactly as before — a
-- pass bought at 23:50 starts tomorrow whether it is one day or thirty.
-- ============================================================================
create or replace function public.activate_daily_pass(
  p_user_id uuid,
  p_reference text,
  p_days integer default 1
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  pay      public.payments%rowtype;
  first_id uuid;
  granted  uuid;
  key      date;
  cursor   date;
  n        integer := greatest(coalesce(p_days, 1), 1);
  i        integer := 0;
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

  -- A pass bought after the last kickoff is a pass for tomorrow. Unchanged
  -- from the single-day version; it now decides where a run of days STARTS.
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
    key := key + 1;
  end if;

  update public.payments
  set status = 'succeeded', settled_at = coalesce(settled_at, now())
  where id = pay.id;

  cursor := key;

  while i < n loop
    -- Skip anything already held, so a second purchase extends rather than
    -- colliding. Without this, buying a week while holding today would land on
    -- the unique index and the buyer would silently lose a day they paid for.
    while exists (
      select 1 from public.daily_passes
      where user_id = p_user_id and date_key = cursor and status = 'active'
    ) loop
      cursor := cursor + 1;
    end loop;

    insert into public.daily_passes (user_id, date_key, amount_usd, currency, payment_id, status)
    values (p_user_id, cursor, pay.amount_usd, pay.currency, pay.id, 'active')
    on conflict (user_id, date_key) do update
      set status = 'active', payment_id = excluded.payment_id
    returning id into granted;

    if first_id is null then
      first_id := granted;
    end if;

    cursor := cursor + 1;
    i := i + 1;
  end loop;

  return first_id;
end;
$$;

-- The old two-argument signature has to go: adding a defaulted parameter
-- creates a second function rather than replacing the first, and a call with
-- two arguments would then be ambiguous.
drop function if exists public.activate_daily_pass(uuid, text);

revoke all on function public.activate_daily_pass(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.activate_daily_pass(uuid, text, integer) to service_role;
