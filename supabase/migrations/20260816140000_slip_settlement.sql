-- ============================================================================
-- Slip settlement
--
-- runAutoGrade graded predictions and stopped there. Nothing carried a result
-- into slip_legs or slips, and the slip_settled job handler in the outbox had
-- no producer anywhere in the codebase. Every settled slip visible in the app
-- had been written directly into seed.sql, which is exactly why the feature
-- looked like it worked.
--
-- Done as a trigger rather than in the grading job on purpose. Predictions are
-- settled from three different places: the auto-grade cron, a manual score
-- entry in the Office, and a prediction override. A trigger catches all three
-- and cannot be forgotten by a fourth.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- app.slip_status_for, the accumulator rule in one place
--
-- Any leg lost, the slip is lost, immediately and regardless of what is still
-- pending: an accumulator cannot recover from a dead leg, and telling someone
-- their slip is still open when it cannot win is worse than telling them
-- nothing. Otherwise it settles only once every leg has.
--
-- Void legs are carried, not counted. A voided leg on a real accumulator drops
-- out and the remaining legs stand, so a slip whose legs are all void or won
-- has won, and a slip of nothing but voids is void.
-- ---------------------------------------------------------------------------
create or replace function app.slip_status_for(p_slip_id uuid)
returns public.slip_status
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when count(*) = 0                                    then 'open'::public.slip_status
    when count(*) filter (where status = 'lost')  > 0    then 'lost'::public.slip_status
    when count(*) filter (where status = 'pending') > 0  then 'confirmed'::public.slip_status
    when count(*) filter (where status = 'void')  = count(*) then 'void'::public.slip_status
    else 'won'::public.slip_status
  end
  from public.slip_legs
  where slip_id = p_slip_id;
$$;

-- ---------------------------------------------------------------------------
-- Recompute one slip's combined odds and status.
--
-- Combined odds are recomputed from the surviving legs rather than adjusted in
-- place: a voided leg has to leave the multiplication entirely, and dividing it
-- back out of a rounded numeric drifts.
-- ---------------------------------------------------------------------------
create or replace function app.refresh_slip(p_slip_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_status public.slip_status;
  prev_status public.slip_status;
  live_odds   numeric;
  live_count  integer;
  owner_id    uuid;
begin
  select status, user_id into prev_status, owner_id
  from public.slips where id = p_slip_id;

  if not found then return; end if;

  next_status := app.slip_status_for(p_slip_id);

  -- Odds over the legs that still stand. Void legs return their stake, so they
  -- multiply as 1.0 by simply not being included.
  select coalesce(exp(sum(ln(odds))), 1), count(*)
  into live_odds, live_count
  from public.slip_legs
  where slip_id = p_slip_id and status <> 'void';

  update public.slips
  set status = next_status,
      combined_odds = case when live_count > 0
                           then round(live_odds, 3)
                           else combined_odds end
  where id = p_slip_id;

  -- Notify once, on the transition into a settled state. Without the guard,
  -- every leg settling on a four-leg slip would send four "your slip settled"
  -- messages for the same slip.
  if next_status in ('won', 'lost', 'void')
     and prev_status not in ('won', 'lost', 'void') then
    insert into public.jobs (kind, payload)
    values (
      'slip_settled',
      jsonb_build_object(
        'userId', owner_id,
        'slipId', p_slip_id,
        'status', next_status,
        'legs', (select count(*) from public.slip_legs where slip_id = p_slip_id)
      )
    );
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- The cascade itself.
--
-- review_needed and disputed deliberately leave the leg pending: neither is an
-- outcome, and writing one into a leg would settle a customer's slip on a
-- result we have not actually established.
-- ---------------------------------------------------------------------------
create or replace function app.on_prediction_settled()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  leg_status public.slip_leg_status;
  touched    uuid;
begin
  if new.status is not distinct from old.status then
    return new;
  end if;

  leg_status := case new.status
    when 'won'  then 'won'::public.slip_leg_status
    when 'lost' then 'lost'::public.slip_leg_status
    when 'void' then 'void'::public.slip_leg_status
    else 'pending'::public.slip_leg_status
  end;

  update public.slip_legs
  set status = leg_status
  where prediction_id = new.id and status is distinct from leg_status;

  for touched in
    select distinct slip_id from public.slip_legs where prediction_id = new.id
  loop
    perform app.refresh_slip(touched);
  end loop;

  return new;
end;
$$;

drop trigger if exists predictions_settle_slips on public.predictions;
create trigger predictions_settle_slips
  after update of status on public.predictions
  for each row
  execute function app.on_prediction_settled();

-- ---------------------------------------------------------------------------
-- Backfill: any slip whose legs are already out of step with their prediction.
--
-- Every account that existed before this migration has legs sitting pending
-- against predictions that settled days ago.
-- ---------------------------------------------------------------------------
do $$
declare
  s uuid;
begin
  update public.slip_legs l
  set status = case p.status
    when 'won'  then 'won'::public.slip_leg_status
    when 'lost' then 'lost'::public.slip_leg_status
    when 'void' then 'void'::public.slip_leg_status
    else 'pending'::public.slip_leg_status
  end
  from public.predictions p
  where p.id = l.prediction_id
    and l.status is distinct from (case p.status
      when 'won'  then 'won'::public.slip_leg_status
      when 'lost' then 'lost'::public.slip_leg_status
      when 'void' then 'void'::public.slip_leg_status
      else 'pending'::public.slip_leg_status
    end);

  -- Recompute status only; the notification guard inside refresh_slip would
  -- otherwise mail every historical slip at once on deploy.
  for s in select id from public.slips loop
    update public.slips
    set status = app.slip_status_for(s)
    where id = s;
  end loop;
end;
$$;
