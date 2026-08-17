-- ============================================================================
-- The FX fallback, out of the source and into somewhere reachable
--
-- FALLBACK_USD_TO_GHS was a constant in src/lib/pricing.ts. It is the rate
-- every customer is charged at whenever the FX provider times out or answers
-- with something implausible, so it is a live pricing control that could only
-- be changed by editing source and redeploying. GHS drifts; the constant does
-- not.
--
-- Three layers now, most specific first:
--   1. app.settings.fx_fallback_usd_ghs   editable in the Office, no deploy
--   2. FALLBACK_USD_TO_GHS                environment default
--   3. the constant in pricing.ts         last resort, so a cold boot with no
--                                         env and no row still charges
--
-- Deliberately NOT in ai_engine_config: that table is versioned, draftable and
-- promotable, and a price is none of those things. Rolling the engine back to
-- last week's weights should not roll the exchange rate back with it.
-- ============================================================================

insert into app.settings (key, value) values ('fx_fallback_usd_ghs', '')
on conflict (key) do nothing;

/**
 * Read the Office override. Empty string means "not set, use the env default".
 *
 * Returns null rather than an empty string so the caller's ?? chain works
 * without also having to test for blank.
 */
create or replace function public.get_fx_fallback()
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select nullif(value, '')::numeric
  from app.settings
  where key = 'fx_fallback_usd_ghs';
$$;

/**
 * Set or clear it.
 *
 * Bounded here as well as in the route. This value is reachable from an admin
 * screen and lands directly on what customers are charged, so the floor and
 * ceiling belong next to the write, not only in the caller that happens to be
 * making it today. Passing null clears the override.
 */
create or replace function public.set_fx_fallback(p_rate numeric)
returns numeric
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_rate is not null and (p_rate < 1 or p_rate > 200) then
    raise exception 'fx fallback % is outside the 1 to 200 band', p_rate
      using errcode = '22023';
  end if;

  update app.settings
  set value = coalesce(p_rate::text, '')
  where key = 'fx_fallback_usd_ghs';

  return p_rate;
end;
$$;

-- Server-side only. The read is harmless but there is no client that needs it,
-- and the write sets a price.
revoke execute on function public.get_fx_fallback() from public, anon, authenticated;
revoke execute on function public.set_fx_fallback(numeric) from public, anon, authenticated;
grant execute on function public.get_fx_fallback() to service_role;
grant execute on function public.set_fx_fallback(numeric) to service_role;
