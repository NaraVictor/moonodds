-- ---------------------------------------------------------------------------
-- Kicka, generated display names and a super-admin allowlist
--
-- Sign-up collects nothing but an email address now: no name, no date of
-- birth, no confirmation step. Two consequences handled here.
--
-- 1. NAMES. The old default was the local part of the email address, which
--    turns "j.okoro.finance@work-domain.com" into a display name and leaks a
--    real name and an employer onto a public-facing profile nobody chose to
--    fill in. A generated pairing is friendlier and reveals nothing.
--
-- 2. SUPER ADMINS. /office is guarded on profiles.is_super_admin, and a
--    privilege-freeze trigger stops anyone setting that column on themselves.
--    That is correct and it leaves no way to appoint the FIRST admin except by
--    hand in a SQL console. This adds an allowlist the trigger consults, so an
--    address on it becomes an admin whenever it signs up, in whichever order
--    those two things happen.
-- ---------------------------------------------------------------------------

/**
 * A friendly, anonymous display name.
 *
 * Football-shaped rather than random characters, because this is what other
 * people see beside a slip. Collision is not checked: display_name is not
 * unique and never identifies an account, so two Sharp Strikers are a
 * curiosity rather than a bug.
 */
create or replace function app.generate_display_name()
returns text
language sql
volatile
set search_path = ''
as $$
  select
    (array['Swift','Sharp','Late','Clinical','Quiet','Bold','Steady','Lucky',
           'Iron','Silver','Northern','Rapid','Cool','Golden','Wily','Brave'])
      [1 + floor(random() * 16)::int]
    || ' ' ||
    (array['Striker','Winger','Sweeper','Keeper','Playmaker','Libero','Poacher',
           'Anchor','Maestro','Trequartista','Fullback','Target','Pivot',
           'Marker','Runner','Captain'])
      [1 + floor(random() * 16)::int]
    || ' ' ||
    lpad(floor(random() * 1000)::text, 3, '0');
$$;

/**
 * Addresses that become super-admins on sight.
 *
 * Deliberately a table rather than a hard-coded email in the trigger: adding
 * the second admin should not require a migration, and a list is auditable in
 * a way that a literal buried in a function body is not.
 */
create table if not exists app.super_admin_allowlist (
  email      text primary key,
  note       text,
  added_at   timestamptz not null default now()
);

revoke all on table app.super_admin_allowlist from anon, authenticated;

insert into app.super_admin_allowlist (email, note)
values ('naravictor4@gmail.com', 'Owner. Seeded 23 August 2026.')
on conflict (email) do nothing;

-- Replace the new-user handler so both behaviours apply at creation time.
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  chosen_name text;
  is_admin    boolean;
begin
  -- A name the person actually supplied wins; Google supplies one too. Only
  -- when neither exists do we invent one, and we never derive it from the
  -- email address any more.
  chosen_name := coalesce(
    nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
    app.generate_display_name()
  );

  select exists (
    select 1 from app.super_admin_allowlist a
    where lower(a.email) = lower(new.email)
  ) into is_admin;

  insert into public.profiles (id, email, display_name, is_super_admin)
  values (new.id, new.email, chosen_name, coalesce(is_admin, false))
  on conflict (id) do nothing;

  insert into public.notification_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

/**
 * Promote anyone already signed up before their address reached the list.
 *
 * Runs as part of the migration and is safe to re-run: it only ever raises a
 * flag that the allowlist already justifies. It writes directly rather than
 * through any client path, so the privilege-freeze trigger's own carve-out for
 * the service role is what lets it through.
 */
do $$
declare
  promoted integer;
begin
  update public.profiles p
  set is_super_admin = true
  from app.super_admin_allowlist a
  where lower(p.email) = lower(a.email)
    and p.is_super_admin is distinct from true;

  get diagnostics promoted = row_count;
  raise notice 'super-admin allowlist applied to % existing profile(s)', promoted;
end;
$$;

comment on table app.super_admin_allowlist is
  'Addresses granted is_super_admin on sign-up, and retroactively by the migration that adds them. The only supported way to appoint an admin, because the privilege-freeze trigger blocks self-promotion.';
