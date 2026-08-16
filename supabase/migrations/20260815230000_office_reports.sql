-- Office reporting.
--
-- The Reports tab has been showing tuning reports, which in the original app
-- lived under the AI Engine tab. The actual reporting, how the engine has done
-- by league and over a period, and what users are following, was never ported.
--
-- Both are super-admin only and say so in the body rather than relying on the
-- route guard: these are SECURITY DEFINER and callable by anyone who knows the
-- name, so the check has to be here.

/**
 * Engine performance over a period, with a per-league breakdown.
 *
 * Dates are optional and inclusive-start/exclusive-end, so a caller can ask for
 * a month without worrying about the boundary landing inside a fixture.
 */
create or replace function public.get_prediction_report(
  p_league_id uuid default null,
  p_start timestamptz default null,
  p_end timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not (select app.is_super_admin()) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  with scoped as (
    select p.status, f.league_id
    from public.predictions p
    join public.fixtures f on f.id = p.fixture_id
    where (p_league_id is null or f.league_id = p_league_id)
      and (p_start is null or f.fixture_date >= p_start)
      and (p_end is null or f.fixture_date < p_end)
  ),
  totals as (
    select
      count(*) filter (where status = 'won')     as wins,
      count(*) filter (where status = 'lost')    as losses,
      count(*) filter (where status = 'pending') as pending,
      count(*) filter (where status = 'void')    as voided,
      count(*)                                    as total
    from scoped
  ),
  by_league as (
    select
      l.name    as "leagueName",
      l.country as "country",
      l.logo    as "logo",
      count(*) filter (where s.status = 'won')  as wins,
      count(*) filter (where s.status = 'lost') as losses,
      count(*) filter (where s.status = 'pending') as pending,
      count(*) filter (where s.status in ('won','lost')) as graded,
      round(
        count(*) filter (where s.status = 'won')::numeric
        / nullif(count(*) filter (where s.status in ('won','lost')), 0), 4
      ) as "winRate"
    from scoped s
    join public.leagues l on l.id = s.league_id
    group by l.id, l.name, l.country, l.logo
    order by count(*) filter (where s.status in ('won','lost')) desc
  )
  select jsonb_build_object(
    'wins', t.wins,
    'losses', t.losses,
    'pending', t.pending,
    'voided', t.voided,
    'graded', t.wins + t.losses,
    'total', t.total,
    'winRate', case when (t.wins + t.losses) > 0
                    then round(t.wins::numeric / (t.wins + t.losses), 4) end,
    'leagues', coalesce((select jsonb_agg(row_to_json(b)) from by_league b), '[]'::jsonb)
  ) into result
  from totals t;

  return result;
end;
$$;

/**
 * What users are actually following.
 *
 * Emails are included because this is an operator tool for supporting named
 * accounts, anonymising it would make it useless for the one job it has.
 */
create or replace function public.get_user_picks_report()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  result jsonb;
begin
  if not (select app.is_super_admin()) then
    raise exception 'not authorised' using errcode = '42501';
  end if;

  with per_user as (
    select
      pr.id,
      pr.email,
      pr.display_name as "displayName",
      count(s.id)                                        as "totalSlips",
      count(s.id) filter (where s.status = 'won')        as wins,
      count(s.id) filter (where s.status = 'lost')       as losses,
      round(
        count(s.id) filter (where s.status = 'won')::numeric
        / nullif(count(s.id) filter (where s.status in ('won','lost')), 0), 4
      ) as "winRate",
      max(s.confirmed_at) as "lastSlipAt"
    from public.profiles pr
    join public.slips s on s.user_id = pr.id
    group by pr.id, pr.email, pr.display_name
    order by count(s.id) desc
  )
  select jsonb_build_object(
    'totalSlips',  coalesce((select sum("totalSlips") from per_user), 0),
    'totalWins',   coalesce((select sum(wins) from per_user), 0),
    'totalLosses', coalesce((select sum(losses) from per_user), 0),
    'avgWinRate',  (select round(avg("winRate"), 4) from per_user where "winRate" is not null),
    'users',       coalesce((select jsonb_agg(row_to_json(u)) from per_user u), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

grant execute on function public.get_prediction_report(uuid, timestamptz, timestamptz) to authenticated;
grant execute on function public.get_user_picks_report() to authenticated;
