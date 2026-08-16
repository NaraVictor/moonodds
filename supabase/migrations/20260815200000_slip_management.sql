-- Slips you can undo.
--
-- Until now a slip could be created and read and nothing else: no grant or
-- policy allowed deleting one, and while slip_legs had a delete policy, using
-- it directly would leave the parent's leg_count and combined_odds describing a
-- slip that no longer exists. Both operations therefore go through RPCs that
-- keep the parent consistent, rather than through PostgREST against the tables.
--
-- The rule on editing: you may remove a leg only while the whole slip is still
-- unsettled. Once any leg has a result, the slip is a record of what you
-- actually followed, and quietly dropping the losing leg from it would turn
-- your own history into fiction. Deleting the slip outright stays allowed,
-- discarding a record is honest in a way that editing one is not.

grant delete on slips to authenticated;

drop policy if exists slips_delete_own on slips;
create policy slips_delete_own on slips
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------

/** Discard a slip and its legs. Yours only; enforced here, not just by policy. */
create or replace function public.delete_slip(p_slip_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  owner uuid;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select user_id into owner from public.slips where id = p_slip_id;

  if owner is null then
    raise exception 'slip not found' using errcode = 'P0002';
  end if;

  if owner <> uid then
    raise exception 'not your slip' using errcode = '42501';
  end if;

  -- slip_legs cascades on the foreign key.
  delete from public.slips where id = p_slip_id;
end;
$$;

/**
 * Drop one leg and re-derive the parent.
 *
 * Combined odds are recomputed from what remains rather than divided out of the
 * stored figure: repeated division on a rounded numeric drifts, and a slip
 * whose odds no longer match its own legs is worse than one you cannot edit.
 *
 * Removing the last leg removes the slip, an empty slip is not a thing.
 */
create or replace function public.remove_slip_leg(p_leg_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  slip public.slips;
  leg public.slip_legs;
  remaining integer;
  new_odds numeric(10, 3);
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  select * into leg from public.slip_legs where id = p_leg_id;
  if not found then
    raise exception 'leg not found' using errcode = 'P0002';
  end if;

  select * into slip from public.slips where id = leg.slip_id;
  if slip.user_id <> uid then
    raise exception 'not your slip' using errcode = '42501';
  end if;

  if slip.status not in ('open', 'confirmed') then
    raise exception 'this slip has already settled' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.slip_legs l
    where l.slip_id = slip.id and l.status <> 'pending'
  ) then
    raise exception 'a leg on this slip has already settled' using errcode = '22023';
  end if;

  delete from public.slip_legs where id = p_leg_id;

  select count(*), coalesce(round(exp(sum(ln(odds)))::numeric, 3), 0)
    into remaining, new_odds
  from public.slip_legs where slip_id = slip.id;

  if remaining = 0 then
    delete from public.slips where id = slip.id;
    return jsonb_build_object('slipDeleted', true, 'legCount', 0);
  end if;

  update public.slips
     set leg_count = remaining,
         combined_odds = new_odds,
         slip_type = (case when remaining = 1 then 'single' else 'accumulator' end)::public.slip_type
   where id = slip.id;

  return jsonb_build_object(
    'slipDeleted', false,
    'legCount', remaining,
    'combinedOdds', new_odds
  );
end;
$$;

grant execute on function public.delete_slip(uuid) to authenticated;
grant execute on function public.remove_slip_leg(uuid) to authenticated;
