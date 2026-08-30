-- ============================================================================
-- The eighteen accounts from the previous app, minus the two that already exist
--
-- naravictor4@gmail.com and arkell.cs@gmail.com are omitted: both already have
-- accounts here, and the owner's is the super-admin. Sixteen rows go in.
--
-- WHY auth.users AND NOT profiles
--
-- profiles.id is a foreign key onto auth.users(id), so a profile cannot exist
-- without the auth row. It does not need writing by hand either: the
-- app.handle_new_user trigger fires on this insert and creates both the
-- profile and the notification preferences, taking the display name out of
-- raw_user_meta_data. So this writes the auth row, then fills in the two
-- things the trigger does not know about — the phone number, and the date the
-- person actually signed up.
--
-- THE EMAIL IS NOT MARKED CONFIRMED, DELIBERATELY
--
-- email_confirmed_at stays null. We did not verify these addresses; another
-- application did, and asserting its result as our own would let an imported
-- address reach checkout on nothing but our say-so. It costs the person
-- nothing: sign-in here is a one-time code, so receiving it IS the proof, and
-- GoTrue stamps email_confirmed_at the moment they verify. The account
-- confirms itself the first time it is used, which is the first moment the
-- claim is actually true.
--
-- Same reasoning for the phone. It goes on profiles, where the app reads it
-- for display and for SMS, and NOT on auth.users, where it would sit beside an
-- unset phone_confirmed_at and imply a verification nobody performed.
--
-- THEIR SIGN-UP DATE IS KEPT
--
-- created_at carries the real date. It is worth checking what that costs them,
-- because app.first_seen_date derives free-trial eligibility from it — and the
-- answer is nothing. app.access_state hands a first-day visitor and a
-- returning one the same two free picks; is_first_day only changes the copy.
-- So the honest date is free to keep.
--
-- SAFE TO RUN TWICE
--
-- Every write is guarded on the address not already being present, so a re-run
-- adds nobody. If one of these sixteen signs up on their own between now and
-- this running, they are left alone rather than duplicated.
-- ============================================================================

-- One copy of the roster, used by all four steps below. Temporary, so it lives
-- for this migration and no longer — the alternative was the same sixteen
-- addresses written out three times and drifting apart at the first edit.
-- Session-scoped and dropped explicitly at the end. NOT `on commit drop`:
-- outside an explicit transaction block that fires the moment the CREATE
-- commits, and every statement after it would fail on a missing table.
create temporary table legacy_roster (
  display_name text not null,
  email        text not null,
  phone        text
);

insert into legacy_roster (display_name, email, phone) values
  ('Daniel Adjei Mensah', 'securedanny11@gmail.com',      '+233243999682'),
  ('michael scott',       'michael201704scott@gmail.com', null),
  ('maale Marcel',        'jnrmaale@gmail.com',           '+233507581688'),
  ('DE CORBAN',           'zellekhris@gmail.com',         '+233247391311'),
  ('Crispin Zelle',       'zellecrispin@gmail.com',       '+233593441333'),
  ('Isaac Lebena',        'lebenaisaac@gmail.com',        null),
  ('Lebena Sylvanus',     'lebenavanus@gmail.com',        '+233543371748'),
  ('Frederick Amu',       'frederickamu21@gmail.com',     null),
  ('Ganaa Camillus',      'camiganaa07@gmail.com',        '+233548420939'),
  ('Jerry Nkansah',       'nkansahjerry0@gmail.com',      '+233535821612'),
  ('Jordan Boadi',        'jordanboadi980@gmail.com',     null),
  ('Lena Few',            'fewlena1@gmail.com',           null),
  ('Erich Neves',         'erichneves8@gmail.com',        null),
  -- Written 0545876377 in the export. The app's own normaliser reads a leading
  -- zero on ten digits as Ghanaian, so it is stored the way the app would have
  -- stored it rather than the way it was typed.
  ('Seyram Atitso',       'atitsoseyram3@gmail.com',      '+233545876377'),
  ('Kaique Lopes',        'kaique.f.a.lopes@gmail.com',   null),
  ('Mawu Ak.',            'mawu4867@gmail.com',           null);

-- Signup dates, kept beside the roster rather than inside it so the addresses
-- read as a list and the dates as a mapping.
create temporary table legacy_signup (email text not null, signed_up date not null);

insert into legacy_signup (email, signed_up) values
  ('securedanny11@gmail.com',      date '2026-06-07'),
  ('michael201704scott@gmail.com', date '2026-06-07'),
  ('jnrmaale@gmail.com',           date '2026-06-08'),
  ('zellekhris@gmail.com',         date '2026-06-08'),
  ('zellecrispin@gmail.com',       date '2026-06-09'),
  ('lebenaisaac@gmail.com',        date '2026-06-09'),
  ('lebenavanus@gmail.com',        date '2026-06-10'),
  ('frederickamu21@gmail.com',     date '2026-06-10'),
  ('camiganaa07@gmail.com',        date '2026-06-11'),
  ('nkansahjerry0@gmail.com',      date '2026-06-14'),
  ('jordanboadi980@gmail.com',     date '2026-06-14'),
  ('fewlena1@gmail.com',           date '2026-06-14'),
  ('erichneves8@gmail.com',        date '2026-06-17'),
  ('atitsoseyram3@gmail.com',      date '2026-06-20'),
  ('kaique.f.a.lopes@gmail.com',   date '2026-06-20'),
  ('mawu4867@gmail.com',           date '2026-06-23');

-- Refuse to run on a roster that does not line up with itself. Sixteen names,
-- sixteen dates, one date each. A silent mismatch here would import someone
-- with the wrong sign-up date and nothing downstream would ever notice.
do $$
declare
  n_roster integer;
  n_dates  integer;
  n_joined integer;
begin
  select count(*) into n_roster from legacy_roster;
  select count(*) into n_dates  from legacy_signup;
  select count(*) into n_joined
  from legacy_roster r join legacy_signup s on lower(s.email) = lower(r.email);

  if n_roster <> 16 or n_dates <> 16 or n_joined <> 16 then
    raise exception
      'legacy roster is inconsistent: % names, % dates, % matched',
      n_roster, n_dates, n_joined;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. The auth rows.
-- ---------------------------------------------------------------------------
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  -- GoTrue reads these as strings, not as nullable ones. A null here is the
  -- classic broken-import symptom: the row looks correct in the dashboard and
  -- every sign-in fails on a type conversion deep inside the auth server.
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select
  '00000000-0000-0000-0000-000000000000',
  gen_random_uuid(),
  'authenticated',
  'authenticated',
  lower(r.email),
  '',
  null,
  '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('display_name', r.display_name),
  s.signed_up::timestamptz,
  now(),
  '', '', '', ''
from legacy_roster r
join legacy_signup s on lower(s.email) = lower(r.email)
where not exists (
  select 1 from auth.users u where lower(u.email) = lower(r.email)
);

-- ---------------------------------------------------------------------------
-- 2. An email identity for each of them.
--
-- GoTrue creates one of these alongside every email signup, and code that
-- links or lists a user's providers reads it rather than auth.users. A user
-- without one can still receive a one-time code, so this is not what makes
-- sign-in work — it is what stops these sixteen looking unlike every account
-- created normally.
--
-- Scoped to accounts THIS IMPORT CREATED, not to the roster.
--
-- Those are two different sets and the difference bit: scoping to the roster
-- and guarding on "has no email identity" gave an email identity to a roster
-- address that already had a Google account here, changing its provider list
-- to describe a link nobody made. See 20260830210000, which undoes it.
--
-- An account this import created has created_at equal to the export's signup
-- date, because the insert above is what set it. A pre-existing one does not.
--
-- provider_id arrived in a later GoTrue than provider did, and this has to
-- apply on whichever version this project runs, so the column list is decided
-- by looking rather than by assuming.
-- ---------------------------------------------------------------------------
do $$
declare
  has_provider_id boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'auth' and table_name = 'identities'
      and column_name = 'provider_id'
  ) into has_provider_id;

  if has_provider_id then
    insert into auth.identities (
      id, user_id, identity_data, provider, provider_id,
      last_sign_in_at, created_at, updated_at
    )
    select
      gen_random_uuid(), u.id,
      jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', false),
      'email', u.id::text,
      null, u.created_at, now()
    from auth.users u
    join legacy_roster r on lower(r.email) = lower(u.email)
    join legacy_signup s on lower(s.email) = lower(u.email)
    where (u.created_at at time zone 'utc')::date = s.signed_up
      and not exists (
        select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email'
      );
  else
    insert into auth.identities (
      id, user_id, identity_data, provider,
      last_sign_in_at, created_at, updated_at
    )
    select
      gen_random_uuid(), u.id,
      jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', false),
      'email',
      null, u.created_at, now()
    from auth.users u
    join legacy_roster r on lower(r.email) = lower(u.email)
    join legacy_signup s on lower(s.email) = lower(u.email)
    where (u.created_at at time zone 'utc')::date = s.signed_up
      and not exists (
        select 1 from auth.identities i where i.user_id = u.id and i.provider = 'email'
      );
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. The two things the trigger could not know.
--
-- It builds the profile from the auth row, so it has the name and the address
-- but not the phone number, and it stamps created_at with now() rather than
-- the date the person signed up.
-- ---------------------------------------------------------------------------
update public.profiles p
set phone      = coalesce(r.phone, p.phone),
    created_at = u.created_at,
    updated_at = now()
from auth.users u
join legacy_roster r on lower(r.email) = lower(u.email)
where p.id = u.id
  and (p.phone is distinct from coalesce(r.phone, p.phone)
       or p.created_at is distinct from u.created_at);

-- ---------------------------------------------------------------------------
-- 4. Say what happened, and refuse to finish quietly if it did not.
-- ---------------------------------------------------------------------------
do $$
declare
  present integer;
  profiled integer;
  identified integer;
begin
  select count(*) into present
  from legacy_roster r join auth.users u on lower(u.email) = lower(r.email);

  select count(*) into profiled
  from legacy_roster r
  join auth.users u on lower(u.email) = lower(r.email)
  join public.profiles p on p.id = u.id;

  select count(*) into identified
  from legacy_roster r
  join auth.users u on lower(u.email) = lower(r.email)
  join auth.identities i on i.user_id = u.id and i.provider = 'email';

  if present <> 16 or profiled <> 16 or identified <> 16 then
    raise exception
      'legacy import incomplete: % auth rows, % profiles, % identities of 16',
      present, profiled, identified;
  end if;

  raise notice 'legacy import: 16 accounts present, profiled and identified';
end;
$$;

drop table legacy_roster;
drop table legacy_signup;
