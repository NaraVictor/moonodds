-- ============================================================================
-- A pass for a day we did not publish rolls forward
--
-- Until now a zero-pick day left the buyer with nothing and a Terms clause
-- offering a refund on request — which puts the work on the customer, for a
-- failure that was ours. A pass that carries forward costs them nothing and
-- asks nothing of them.
--
-- WHY A NIGHTLY SWEEP AND NOT THE ZERO-PICK ALERT. The obvious place is the
-- moment the 05:00 run finds nothing, but a pass bought at 10:00 that same day
-- would then never be rolled — the sweep had already run before the money
-- arrived. Running at 23:45 catches everyone who paid for the day, whenever
-- they paid, and a pass rolled minutes before midnight is worth exactly as much
-- as one rolled at dawn.
--
-- Chains naturally: if the next day also publishes nothing, the next night
-- rolls it again.
--
-- A pass is only rolled when the day genuinely had NO published board. A thin
-- day is still a day we delivered, and rolling those would turn a quiet board
-- into a free one.
-- ============================================================================

create or replace function app.roll_unserved_passes(p_date date default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  day     date := coalesce(p_date, (select app.utc_today()));
  pass    record;
  target  date;
  moved   integer := 0;
begin
  -- Did the day publish anything at all? Extra picks do not count: they are
  -- bought separately and a pass does not entitle anyone to them.
  if exists (
    select 1
    from public.predictions p
    join public.fixtures f on f.id = p.fixture_id
    where p.tier = 'primary'
      and f.fixture_date >= day::timestamp at time zone 'utc'
      and f.fixture_date <  (day + 1)::timestamp at time zone 'utc'
  ) then
    return 0;
  end if;

  for pass in
    select id, user_id from public.daily_passes
    where date_key = day and status = 'active'
  loop
    -- The next day this person does not already hold a pass for. Without the
    -- search, a customer who had bought tomorrow in advance would collide with
    -- the unique index on (user_id, date_key) and their rolled day would be
    -- silently lost — which is the exact failure this is meant to fix.
    target := day + 1;
    while exists (
      select 1 from public.daily_passes
      where user_id = pass.user_id and date_key = target
    ) loop
      target := target + 1;
    end loop;

    update public.daily_passes
    set date_key = target
    where id = pass.id;

    moved := moved + 1;
  end loop;

  if moved > 0 then
    raise notice 'rolled % pass(es) from % forward', moved, day;
  end if;

  return moved;
end;
$$;

revoke all on function app.roll_unserved_passes(date) from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'kicka_roll_passes') then
    perform cron.unschedule('kicka_roll_passes');
  end if;
end;
$$;

-- 23:45 UTC: late enough that everyone who was going to buy today has, early
-- enough that the roll lands before the date turns over.
select cron.schedule(
  'kicka_roll_passes',
  '45 23 * * *',
  $$select app.roll_unserved_passes()$$
);
