-- Which of these predictions still exist?
--
-- A slip lives in the browser until it is saved, so it can go stale: if the
-- board is regenerated while someone is still building one, the ids they hold
-- no longer resolve. Saving then fails on a foreign-key violation, which
-- reaches the user as "one or more picks no longer exist", true, unhelpful,
-- and impossible to act on because it never says which.
--
-- This lets the slip sheet mark the dead legs individually, so the fix is one
-- click rather than discarding the whole slip.
--
-- Returning which of a set of ids exist is not a disclosure: the caller already
-- holds the ids, and the answer says nothing about the prediction's content.
-- The rows themselves stay unreadable, this returns ids, never picks.

create or replace function public.filter_live_predictions(p_ids uuid[])
returns uuid[]
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(array_agg(p.id), '{}')
  from public.predictions p
  where p.id = any(p_ids);
$$;

grant execute on function public.filter_live_predictions(uuid[]) to anon, authenticated;
