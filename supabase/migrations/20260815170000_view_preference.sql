-- How a user likes to read the board.
--
-- Lives on the profile rather than in localStorage alone so the choice follows
-- someone between devices, a table-first user is table-first on their phone
-- too. Signed-out visitors still get localStorage; there is nowhere else to put
-- it for them.
--
-- Safe under the existing profile policies: profiles_update_own already lets a
-- user edit their own row, and guard_profile_privileges freezes only
-- is_super_admin and is_suspended, so this column needs no special handling.

alter table profiles
  add column if not exists view_preference text not null default 'cards';

alter table profiles
  drop constraint if exists profiles_view_preference_check;

alter table profiles
  add constraint profiles_view_preference_check
  check (view_preference in ('cards', 'table'));
