-- ============================================================================
-- The Office could read the policy and never save it
--
-- Both functions guard on app.is_super_admin(), which resolves auth.uid() from
-- the caller's JWT. The Office route calls them with the SERVICE client, which
-- has no user attached — so auth.uid() is null, is_super_admin() is false, and
-- every save came back "not authorised" no matter who was signed in.
--
-- The read failed the same way and was quieter about it: the route did not
-- check the RPC's error, so the panel simply rendered its default of "all" and
-- looked fine until somebody pressed a button.
--
-- The service role is a server-only credential and the route has already run
-- requireSuperAdmin() before it gets here, so accepting it is not a loosening.
-- The is_super_admin() branch stays for the case where these are ever called
-- with a user's own JWT, so the function does not depend on its caller having
-- checked.
-- ============================================================================
create or replace function public.get_settlement_policy()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  p public.settlement_email_policy%rowtype;
begin
  if not ((select app.is_super_admin()) or (select auth.role()) = 'service_role') then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  select * into p from public.settlement_email_policy where id;

  return jsonb_build_object(
    'mode', coalesce(p.mode, 'all'),
    'userIds', coalesce(to_jsonb(p.user_ids), '[]'::jsonb),
    'updatedAt', p.updated_at,
    'updatedBy', p.updated_by
  );
end;
$$;

grant execute on function public.get_settlement_policy() to authenticated;

create or replace function public.set_settlement_policy(
  p_mode text,
  p_user_ids uuid[],
  p_actor text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not ((select app.is_super_admin()) or (select auth.role()) = 'service_role') then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  if p_mode not in ('all', 'selected', 'off') then
    raise exception 'unknown mode %', p_mode using errcode = '22023';
  end if;

  if p_mode = 'selected' and coalesce(array_length(p_user_ids, 1), 0) = 0 then
    raise exception 'choose at least one recipient, or set the mode to off'
      using errcode = '22023';
  end if;

  update public.settlement_email_policy
  set mode = p_mode,
      user_ids = case when p_mode = 'selected' then p_user_ids else '{}'::uuid[] end,
      updated_at = now(),
      updated_by = p_actor
  where id;

  return public.get_settlement_policy();
end;
$$;

revoke all on function public.set_settlement_policy(text, uuid[], text)
  from public, anon, authenticated;
grant execute on function public.set_settlement_policy(text, uuid[], text) to service_role;
