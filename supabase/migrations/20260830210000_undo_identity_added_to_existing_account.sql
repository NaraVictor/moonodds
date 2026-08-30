-- ============================================================================
-- The legacy import touched an account it should have left alone
--
-- WHAT HAPPENED
--
-- michael201704scott@gmail.com was on the import roster and already had an
-- account here — created 2026-08-23, months after the 2026-06-07 date in the
-- export, and carrying a GOOGLE identity.
--
-- The auth.users insert skipped it correctly: it is guarded on the address not
-- already existing, and it did not fire. The identity step is where it went
-- wrong. That step was scoped to the roster and guarded on the user having no
-- identity WITH PROVIDER 'email' — and this account had a google identity and
-- no email one, so the guard read as "needs one" and it was given one.
--
-- The account went from google to [email, google]. Nobody was locked out and
-- nothing was exposed, but its provider list now describes a link that was
-- never made, and that is not a thing an import of OTHER people's accounts is
-- entitled to change.
--
-- THE GUARD WAS THE WRONG QUESTION
--
-- "Does this roster address lack an email identity" is not the same question
-- as "did this import create this account". Only rows the import inserted
-- should have been given identities, and the discriminator was available the
-- whole time: an account this import created has auth.users.created_at equal
-- to the export's signup date, because that insert is what set it. The
-- pre-existing one is months off.
--
-- Restoring rather than improving. The account had no email identity before
-- this ran, so it should have none after — even though an email identity would
-- arguably be tidier next to raw_app_meta_data, which already said 'email'.
-- Tidying somebody's account is a decision for somebody else to make.
--
-- Sign-in is unaffected either way: GoTrue matches a one-time code against the
-- address on auth.users, not against an identity row, and the google route is
-- untouched.
-- ============================================================================

do $$
declare
  target uuid;
  removed integer := 0;
begin
  select u.id into target
  from auth.users u
  where lower(u.email) = 'michael201704scott@gmail.com'
    -- Only if this really is the pre-existing account rather than one the
    -- import created. On a database where the import DID create it, this
    -- migration correctly does nothing.
    and (u.created_at at time zone 'utc')::date <> date '2026-06-07';

  if target is null then
    raise notice 'nothing to undo: no pre-existing account for that address';
    return;
  end if;

  -- Never leave an account with no identities at all. If the email one is the
  -- only row there, something other than this import put it there and it is
  -- not ours to remove.
  if not exists (
    select 1 from auth.identities
    where user_id = target and provider <> 'email'
  ) then
    raise notice 'leaving the email identity alone: it is the only one on the account';
    return;
  end if;

  delete from auth.identities
  where user_id = target and provider = 'email';

  get diagnostics removed = row_count;
  raise notice 'removed % email identity row(s) added in error', removed;
end;
$$;
