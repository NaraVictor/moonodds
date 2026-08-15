-- Free picks shouldn't be spent on results.
--
-- The entitlement ranking ordered every prediction for the day by confidence
-- and unlocked the top `pick_limit`. But settled picks are public regardless —
-- a called shot whose outcome is known is a track record, not a product — so
-- whenever one happened to top the day's confidence ordering it consumed a free
-- slot while giving the viewer nothing they couldn't already see. On a board
-- with a strong morning result, "two free picks" quietly became one.
--
-- The ranking now runs over unsettled picks only. Settled ones bypass it
-- entirely and stay public, which is what they were already doing — they just
-- no longer charge for the privilege.

create or replace function public.get_todays_picks(
  start_ts timestamptz,
  end_ts timestamptz
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  st record;
  total integer;
  visible jsonb;
begin
  select * into st from app.access_state();

  select count(*) into total
  from public.predictions p
  join public.fixtures f on f.id = p.fixture_id
  where f.fixture_date >= start_ts and f.fixture_date < end_ts;

  select coalesce(
           jsonb_agg(
             app.pick_json_gated(r.pred, r.rn is not null and r.rn <= st.pick_limit)
             order by r.confidence_score desc
           ),
           '[]'::jsonb
         )
    into visible
  from (
    select p as pred,
           p.confidence_score,
           -- Null for settled picks: they are unlocked by pick_json_gated on
           -- their own merit and must not occupy an entitlement slot.
           case
             when p.status in ('won', 'lost') then null
             else row_number() over (
               partition by (p.status in ('won', 'lost'))
               order by p.confidence_score desc
             )
           end as rn
    from public.predictions p
    join public.fixtures f on f.id = p.fixture_id
    where f.fixture_date >= start_ts and f.fixture_date < end_ts
  ) r;

  return jsonb_build_object(
    'picks', visible,
    'totalCount', total,
    'visibleCount', least(greatest(st.pick_limit, 0), total),
    'hasFullAccess', st.has_full_access,
    'isFirstDay', st.is_first_day,
    'freePickLimit', case when st.pick_limit > 1000000 then 0 else st.pick_limit end
  );
end;
$$;

create or replace function public.get_picks_by_status(filter text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  st record;
  total integer;
  visible jsonb;
begin
  if filter not in ('all', 'upcoming', 'live', 'settled') then
    raise exception 'unknown filter %', filter using errcode = '22023';
  end if;

  select * into st from app.access_state();

  select count(*) into total
  from public.predictions p
  join public.fixtures f on f.id = p.fixture_id
  where case filter
    when 'upcoming' then p.status = 'pending' and f.status = 'scheduled'
    when 'live'     then p.status = 'pending' and f.status = 'live'
    when 'settled'  then p.status in ('won', 'lost')
    else true
  end;

  select coalesce(
           jsonb_agg(
             app.pick_json_gated(r.pred, r.rn is not null and r.rn <= st.pick_limit)
             order by r.confidence_score desc
           ),
           '[]'::jsonb
         )
    into visible
  from (
    select p as pred,
           p.confidence_score,
           case
             when p.status in ('won', 'lost') then null
             else row_number() over (
               partition by (p.status in ('won', 'lost'))
               order by p.confidence_score desc
             )
           end as rn
    from public.predictions p
    join public.fixtures f on f.id = p.fixture_id
    where case filter
      when 'upcoming' then p.status = 'pending' and f.status = 'scheduled'
      when 'live'     then p.status = 'pending' and f.status = 'live'
      when 'settled'  then p.status in ('won', 'lost')
      else true
    end
    order by p.confidence_score desc
    limit 200
  ) r;

  return jsonb_build_object(
    'picks', visible,
    'totalCount', total,
    'visibleCount', least(greatest(st.pick_limit, 0), total),
    'hasFullAccess', st.has_full_access,
    'isFirstDay', st.is_first_day,
    'freePickLimit', case when st.pick_limit > 1000000 then 0 else st.pick_limit end
  );
end;
$$;

-- The detail page has to agree with the board, or a pick shown locked on one
-- would open unlocked on the other.
create or replace function public.get_prediction_detail(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  st record;
  pred public.predictions;
  entitled boolean;
  rank_of integer;
  stats public.fixture_stats;
begin
  select * into st from app.access_state();

  select * into pred from public.predictions where id = p_id;
  if not found then
    return null;
  end if;

  if pred.status in ('won', 'lost') then
    entitled := true;
  else
    select count(*) + 1 into rank_of
    from public.predictions p2
    join public.fixtures f2 on f2.id = p2.fixture_id
    join public.fixtures f1 on f1.id = pred.fixture_id
    where f2.fixture_date::date = f1.fixture_date::date
      and p2.status not in ('won', 'lost')
      and p2.confidence_score > pred.confidence_score;

    entitled := rank_of <= st.pick_limit;
  end if;

  select * into stats
  from public.fixture_stats
  where fixture_id = pred.fixture_id
  order by fetched_at desc
  limit 1;

  return jsonb_build_object(
    'pick', app.pick_json_gated(pred, entitled),
    'stats', case
      when stats.id is null then null
      else jsonb_build_object(
        'homeForm', stats.home_form,
        'awayForm', stats.away_form,
        'h2hHomeWins', stats.h2h_home_wins,
        'h2hAwayWins', stats.h2h_away_wins,
        'h2hDraws', stats.h2h_draws,
        'h2hAvgGoals', stats.h2h_avg_goals,
        'h2hBttsRate', stats.h2h_btts_rate,
        'homeSeason', stats.home_season,
        'awaySeason', stats.away_season,
        'h2hMatches', stats.h2h_matches,
        'homeRecentMatches', stats.home_recent_matches,
        'awayRecentMatches', stats.away_recent_matches
      )
    end,
    'hasFullAccess', st.has_full_access,
    'isFirstDay', st.is_first_day
  );
end;
$$;
