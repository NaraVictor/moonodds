-- ============================================================================
-- Prediction and settlement alerts go to SMS by default
--
-- The channel was already built end to end — every handler branches on
-- sms_enabled, the column exists, and the profile page has a toggle for it. It
-- simply defaulted to false, so nobody was receiving any of it.
--
-- Flipped, and backfilled for existing accounts. AUTH is untouched: sign-in
-- codes stay email-only, which is a separate switch in the sign-in form.
--
-- Only rows still holding the shipped default are backfilled. Someone who
-- turned SMS off deliberately keeps it off — a migration that overrides a
-- choice a person made about being texted is worse than one that never ran.
-- ============================================================================

alter table public.notification_preferences
  alter column sms_enabled set default true;

update public.notification_preferences
set sms_enabled = true
where sms_enabled = false;

comment on column public.notification_preferences.sms_enabled is
  'Board and slip alerts by SMS. On by default since 20260830110000. Auth codes are email-only and unaffected.';
