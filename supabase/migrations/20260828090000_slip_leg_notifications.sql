-- ============================================================================
-- Tell people how each leg went, not only how the slip ended
--
-- A settled slip already produced one message, fired by refresh_slip on the
-- transition into a settled state. Nothing reported the legs, so somebody
-- holding a four-fold heard nothing for three days and then one line telling
-- them it was over — with no way to follow it while it was live.
--
-- WHEN A LEG DOES *NOT* NOTIFY, which is most of the design:
--
--   Single-leg slips.        The slip result IS the leg result; two messages
--                            saying the same thing is worse than one.
--   The deciding leg.        Whichever leg settles the slip is covered by the
--                            slip message that follows it in the same
--                            transaction. Without this, the last leg of a
--                            four-fold sends two notifications a second apart.
--   Legs of a decided slip.  An accumulator dies the moment any leg loses, so
--                            the remaining legs settle afterwards against a
--                            slip that is already over. "Leg 4 won" after
--                            "your slip lost" is noise at best and cruel at
--                            worst.
--
-- What is left is exactly the useful case: a leg landing while the slip is
-- still alive.
-- ============================================================================

create or replace function app.refresh_slip(
  p_slip_id uuid,
  -- Which prediction triggered this, when one did. Needed only to name the leg
  -- in the notification; the backfill and any manual call pass nothing and get
  -- the previous behaviour exactly.
  p_prediction_id uuid default null
)
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
  leg_total   integer;
  leg_done    integer;
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

  select count(*), count(*) filter (where status <> 'pending')
  into leg_total, leg_done
  from public.slip_legs where slip_id = p_slip_id;

  -- A leg landing while the slip is still alive. Every exclusion in the header
  -- comment is one of the conditions below.
  if p_prediction_id is not null
     and leg_total > 1
     and prev_status not in ('won', 'lost', 'void')
     and next_status not in ('won', 'lost', 'void')
  then
    insert into public.jobs (kind, payload)
    values (
      'slip_leg_settled',
      jsonb_build_object(
        'userId', owner_id,
        'slipId', p_slip_id,
        'predictionId', p_prediction_id,
        'legStatus', (
          select status from public.slip_legs
          where slip_id = p_slip_id and prediction_id = p_prediction_id
          limit 1
        ),
        'legsSettled', leg_done,
        'legsTotal', leg_total
      )
    );
  end if;

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
        'legs', leg_total
      )
    );
  end if;
end;
$$;

-- The cascade now passes the prediction through, so refresh_slip can name the
-- leg. Everything else about it is unchanged.
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
    perform app.refresh_slip(touched, new.id);
  end loop;

  return new;
end;
$$;
