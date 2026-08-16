-- Per-prediction detail.
--
-- Backs /predictions/[id]. Same entitlement rule as the board: the fixture and
-- its statistics are public football facts, the AI output is not. A viewer
-- without access gets a complete, genuinely useful match page, form, head to
-- head, season splits, recent meetings, with the call itself withheld.
--
-- Entitlement is recomputed here rather than trusted from the client. It has to
-- reproduce the board's rule exactly, or a user could reach a locked pick's
-- reasoning simply by knowing its id, which is precisely the hole this closes.

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

  -- Where this pick sits in the same confidence ordering the board uses. A
  -- pick is unlocked here if and only if it would be unlocked there.
  select count(*) + 1 into rank_of
  from public.predictions p2
  join public.fixtures f2 on f2.id = p2.fixture_id
  join public.fixtures f1 on f1.id = pred.fixture_id
  where f2.fixture_date::date = f1.fixture_date::date
    and p2.confidence_score > pred.confidence_score;

  entitled := rank_of <= st.pick_limit;

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

grant execute on function public.get_prediction_detail(uuid) to anon, authenticated;
