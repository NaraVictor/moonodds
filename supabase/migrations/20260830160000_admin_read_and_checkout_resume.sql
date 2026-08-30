-- ============================================================================
-- Two faults from the extras split, and one stale comment's worth of behaviour
--
-- 1. get_admin_predictions had never been executed, so nothing had proven it
--
-- It aggregated app.pick_json(p) over a FROM-subquery alias. PL/pgSQL plans a
-- statement only when it first runs one, so neither the migration nor the
-- build would have said a word before an operator opened /office — the first
-- execution of that function was going to be in front of a user.
--
-- It is rewritten here to aggregate over a real table alias, which is what
-- every other RPC in this schema does, and the do-block below EXECUTES the
-- shape at push time. That is the actual change: the form that ships is one
-- the database has run, rather than one that looked right.
--
-- (The subquery form it replaces turns out to be legal — get_prediction_history
-- has used it in production all along. The problem was never that it was
-- wrong, it was that nothing had ever run it.)
-- ============================================================================
create or replace function public.get_admin_predictions()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select app.is_super_admin()) then
    raise exception 'not permitted' using errcode = '42501';
  end if;

  return coalesce(
    (select jsonb_agg(x.pick order by x.confidence_score desc)
     from (
       select app.pick_json(p) || jsonb_build_object('tier', p.tier) as pick,
              p.confidence_score
       from public.predictions p
       order by p.confidence_score desc
       limit 500
     ) x),
    '[]'::jsonb
  );
end;
$$;

comment on function public.get_admin_predictions() is
  'Every pick with its tier, for the Office. Super-admin only: this is the read that deliberately ignores the paywall.';

grant execute on function public.get_admin_predictions() to authenticated;

-- The shape the function depends on, executed for real. If app.pick_json ever
-- stops accepting a predictions row here, this migration fails rather than the
-- Office does.
do $$
declare
  probe jsonb;
begin
  select coalesce(
    (select jsonb_agg(x.pick order by x.confidence_score desc)
     from (
       select app.pick_json(p) || jsonb_build_object('tier', p.tier) as pick,
              p.confidence_score
       from public.predictions p
       order by p.confidence_score desc
       limit 5
     ) x),
    '[]'::jsonb
  ) into probe;

  if jsonb_typeof(probe) is distinct from 'array' then
    raise exception 'get_admin_predictions shape check returned %', jsonb_typeof(probe);
  end if;
end;
$$;
