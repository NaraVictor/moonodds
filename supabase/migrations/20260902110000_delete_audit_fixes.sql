-- ============================================================================
-- Three things the delete work got wrong
--
-- 1. A SLIP KEPT A LEG COUNT IT NO LONGER HAD
--
-- admin_delete_prediction calls app.refresh_slip so a slip losing a leg comes
-- out consistent. refresh_slip recomputes status and combined_odds and has
-- never touched leg_count — it did not need to, because until now legs only
-- ever changed STATUS and never disappeared. Deleting a prediction makes them
-- disappear, so the field the whole repair was supposed to fix was the one
-- field left stale.
--
-- Recomputed from the legs that remain. Idempotent for the settlement path
-- that calls this every time a leg lands: the count is simply unchanged there.
--
-- 2. A SLIP CAN NOW END WITH NO LEGS AT ALL
--
-- Delete the only pick on a single-leg slip and what is left is a row claiming
-- to be a bet on nothing, which renders as an empty card in the customer's
-- slips and can never settle. It is removed, and the count comes back in the
-- result so the operator is told a slip went rather than discovering it.
--
-- 3. DELETING NOTHING REPORTED SUCCESS
--
-- admin_delete_prediction returned {"deleted": true} for an id that was not
-- there, so a double-click or an already-removed row told the operator it had
-- worked. It reports what actually happened now.
-- ============================================================================

create or replace function app.refresh_slip(
  p_slip_id uuid,
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

  select coalesce(exp(sum(ln(odds))), 1), count(*)
  into live_odds, live_count
  from public.slip_legs
  where slip_id = p_slip_id and status <> 'void';

  select count(*), count(*) filter (where status <> 'pending')
  into leg_total, leg_done
  from public.slip_legs where slip_id = p_slip_id;

  update public.slips
  set status = next_status,
      -- Recomputed rather than left as written. Legs used to change status and
      -- never vanish; an admin delete makes them vanish.
      leg_count = leg_total,
      combined_odds = case when live_count > 0
                           then round(live_odds, 3)
                           else combined_odds end
  where id = p_slip_id;

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
end;
$$;

create or replace function public.admin_delete_prediction(p_prediction_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  slips   uuid[];
  s       uuid;
  removed integer;
  emptied integer := 0;
begin
  if not ((select app.is_super_admin()) or (select auth.role()) = 'service_role') then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct slip_id), '{}')
  into slips
  from public.slip_legs
  where prediction_id = p_prediction_id;

  with gone as (
    delete from public.predictions where id = p_prediction_id returning id
  )
  select count(*) into removed from gone;

  if removed = 0 then
    return jsonb_build_object('deleted', false, 'reason', 'no such prediction');
  end if;

  foreach s in array slips loop
    perform app.refresh_slip(s);

    -- A slip with nothing left on it is a bet on nothing: it can never settle
    -- and shows as an empty card. Removed, and counted so the operator hears.
    if not exists (select 1 from public.slip_legs where slip_id = s) then
      delete from public.slips where id = s;
      emptied := emptied + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'deleted', true,
    'slipsRepaired', coalesce(array_length(slips, 1), 0) - emptied,
    'slipsRemoved', emptied
  );
end;
$$;

revoke all on function public.admin_delete_prediction(uuid) from public, anon, authenticated;
grant execute on function public.admin_delete_prediction(uuid) to service_role;
