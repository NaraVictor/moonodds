-- Your record, and the engine's record by league.
--
-- Two different questions that the profile page asks side by side:
--   * how have MY slips gone?, private, derived from slips
--   * where is the engine actually good?, public, derived from settled picks
--
-- League performance is computed live rather than read from
-- league_performance_log. That table exists and is indexed but nothing has ever
-- written to it, it was designed as a cache for the recalibration job, and
-- reading a cache that is never filled would show every league at zero. When
-- the job starts populating it this can become a read of that table; until
-- then, deriving from the source is the only version that tells the truth.

/**
 * The signed-in user's own betting record.
 *
 * ROI assumes one flat unit staked per slip, which is the only assumption
 * available, we never see what anyone actually staked, and inventing a
 * variable stake would make the number look precise while meaning less.
 */
create or replace function public.get_profile_stats()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := (select auth.uid());
  total integer;
  won integer;
  lost integer;
  pending integer;
  returned numeric;
  avg_conf numeric;
begin
  if uid is null then
    return null;
  end if;

  select
    count(*),
    count(*) filter (where s.status = 'won'),
    count(*) filter (where s.status = 'lost'),
    count(*) filter (where s.status in ('open', 'confirmed')),
    coalesce(sum(s.combined_odds) filter (where s.status = 'won'), 0)
  into total, won, lost, pending, returned
  from public.slips s
  where s.user_id = uid;

  -- Average confidence across every leg the user actually followed. Says
  -- something about their taste rather than the engine's.
  select round(avg(p.confidence_score), 2) into avg_conf
  from public.slip_legs l
  join public.slips s on s.id = l.slip_id
  join public.predictions p on p.id = l.prediction_id
  where s.user_id = uid;

  return jsonb_build_object(
    'totalSlips', total,
    'won', won,
    'lost', lost,
    'pending', pending,
    'settled', won + lost,
    'winRate', case when (won + lost) > 0
                    then round(won::numeric / (won + lost), 4) else null end,
    -- Staking one unit per settled slip: profit over outlay.
    'roi', case when (won + lost) > 0
                then round((returned - (won + lost)) / (won + lost), 4) else null end,
    'avgConfidence', avg_conf
  );
end;
$$;

/**
 * Engine accuracy per league.
 *
 * Public: it is the same track record already visible on every settled pick,
 * just grouped. Leagues with too few settled calls to mean anything are
 * excluded rather than shown at 100% off a single result.
 */
create or replace function public.get_league_performance()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(row_to_json(t) order by t.settled desc), '[]'::jsonb)
  from (
    select
      l.name        as "leagueName",
      l.country     as "country",
      l.logo        as "logo",
      count(*) filter (where p.status = 'won')  as wins,
      count(*) filter (where p.status = 'lost') as losses,
      count(*) filter (where p.status in ('won','lost')) as settled,
      round(
        count(*) filter (where p.status = 'won')::numeric
        / nullif(count(*) filter (where p.status in ('won','lost')), 0),
        4
      ) as "accuracyRate"
    from public.predictions p
    join public.fixtures f on f.id = p.fixture_id
    join public.leagues l on l.id = f.league_id
    where p.status in ('won', 'lost')
    group by l.id, l.name, l.country, l.logo
    having count(*) filter (where p.status in ('won','lost')) >= 3
  ) t;
$$;

grant execute on function public.get_profile_stats() to authenticated;
grant execute on function public.get_league_performance() to anon, authenticated;
