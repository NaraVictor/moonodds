-- ============================================================================
-- Prediction history, and slips that know what they are about
--
-- Four things:
--   * a public, paginated history of every settled call, with real stats
--   * league performance narrowed to the leagues a user has actually backed
--   * slips whose legs carry their fixture, so a leg reads as a match rather
--     than as the words "View prediction"
--   * settled-slip performance for the same page
--
-- ROI here uses the real price on each pick (odds_snapshots, with the same
-- confidence-shaped fallback app.pick_json uses) rather than the flat 1.8 that
-- get_engine_stats assumes. That flat figure is what produces the ~118% ROI
-- noted in STATUS.md: it pays every winner at 1.8 regardless of what the pick
-- was actually priced at. Staking is one flat unit per settled pick, which is
-- the only honest assumption available, since we never see a real stake.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- app.pick_price, the price a settled pick was taken at
--
-- Extracted so history stats and pick_json cannot drift to different numbers
-- for the same prediction.
-- ---------------------------------------------------------------------------
create or replace function app.pick_price(p public.predictions)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select round(o.pick_odds, 2)
     from public.odds_snapshots o
     where o.prediction_id = p.id and o.pick_odds is not null
     order by o.captured_at desc
     limit 1),
    round((2.60 - (p.confidence_score - 7.0) * 0.28)::numeric, 2)
  );
$$;

-- ---------------------------------------------------------------------------
-- Public prediction history
--
-- Settled only. A pending pick is the product; a settled one is the record,
-- and the record is what this page exists to make checkable. Guests see it in
-- full, which is the point: a track record nobody can audit is marketing.
-- ---------------------------------------------------------------------------
create or replace function public.get_prediction_history(
  p_limit   integer default 24,
  p_offset  integer default 0,
  p_league  text default null,
  p_market  text default null,
  p_outcome text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  lim   integer := least(greatest(coalesce(p_limit, 24), 1), 100);
  off   integer := greatest(coalesce(p_offset, 0), 0);
  rows_ jsonb;
  total integer;
begin
  select count(*)
  into total
  from public.predictions p
  join public.fixtures f on f.id = p.fixture_id
  join public.leagues l on l.id = f.league_id
  where p.status in ('won', 'lost', 'void')
    and (p_league is null or l.name = p_league)
    and (p_market is null or p.prediction_type::text = p_market)
    and (p_outcome is null or p.status::text = p_outcome);

  select coalesce(jsonb_agg(app.pick_json(p) order by p.settled_at desc), '[]'::jsonb)
  into rows_
  from (
    select p.*
    from public.predictions p
    join public.fixtures f on f.id = p.fixture_id
    join public.leagues l on l.id = f.league_id
    where p.status in ('won', 'lost', 'void')
      and (p_league is null or l.name = p_league)
      and (p_market is null or p.prediction_type::text = p_market)
      and (p_outcome is null or p.status::text = p_outcome)
    order by p.settled_at desc
    limit lim offset off
  ) p;

  return jsonb_build_object(
    'rows', rows_,
    'total', total,
    'limit', lim,
    'offset', off,
    'hasMore', off + lim < total
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Historical performance
--
-- Headline numbers, a market breakdown, and a monthly trend. Voids are counted
-- separately and excluded from win rate: a refunded stake is neither a win nor
-- a loss, and folding it into either flatters or punishes the record falsely.
-- ---------------------------------------------------------------------------
create or replace function public.get_history_stats()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with settled as (
    select
      p.status,
      p.prediction_type::text as market,
      p.confidence_score,
      p.settled_at,
      l.name as league_name,
      app.pick_price(p) as price
    from public.predictions p
    join public.fixtures f on f.id = p.fixture_id
    join public.leagues l on l.id = f.league_id
    where p.status in ('won', 'lost', 'void')
  ),
  graded as (select * from settled where status in ('won', 'lost'))
  select jsonb_build_object(
    'settled',   (select count(*) from graded),
    'won',       (select count(*) from graded where status = 'won'),
    'lost',      (select count(*) from graded where status = 'lost'),
    'void',      (select count(*) from settled where status = 'void'),
    'winRate',   (select round(count(*) filter (where status = 'won')::numeric
                               / nullif(count(*), 0), 4) from graded),
    -- One unit staked per settled pick, returned at the price we took.
    'roi',       (select round((coalesce(sum(price) filter (where status = 'won'), 0)
                                - count(*)) / nullif(count(*), 0), 4) from graded),
    'avgOdds',   (select round(avg(price), 2) from graded),
    'avgConfidence', (select round(avg(confidence_score), 2) from graded),
    'bestMarket', (
      select m.market from (
        select market,
               count(*) filter (where status = 'won')::numeric / count(*) as rate,
               count(*) as n
        from graded group by market having count(*) >= 5
      ) m order by m.rate desc, m.n desc limit 1
    ),
    'byMarket', coalesce((
      select jsonb_agg(row_to_json(t) order by t.settled desc)
      from (
        select
          market,
          count(*) filter (where status = 'won')  as wins,
          count(*) filter (where status = 'lost') as losses,
          count(*) as settled,
          round(count(*) filter (where status = 'won')::numeric / count(*), 4) as "winRate",
          round((coalesce(sum(price) filter (where status = 'won'), 0) - count(*))
                / count(*), 4) as roi
        from graded
        group by market
        having count(*) >= 3
      ) t
    ), '[]'::jsonb),
    'byMonth', coalesce((
      select jsonb_agg(row_to_json(t) order by t.month)
      from (
        select
          to_char(date_trunc('month', settled_at), 'YYYY-MM') as month,
          count(*) filter (where status = 'won')  as wins,
          count(*) filter (where status = 'lost') as losses,
          count(*) as settled,
          round(count(*) filter (where status = 'won')::numeric / count(*), 4) as "winRate"
        from graded
        group by date_trunc('month', settled_at)
        order by date_trunc('month', settled_at)
        limit 12
      ) t
    ), '[]'::jsonb)
  );
$$;

/** Distinct leagues and markets present in the settled record, for the filters. */
create or replace function public.get_history_facets()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'leagues', coalesce((
      select jsonb_agg(distinct l.name order by l.name)
      from public.predictions p
      join public.fixtures f on f.id = p.fixture_id
      join public.leagues l on l.id = f.league_id
      where p.status in ('won', 'lost', 'void')
    ), '[]'::jsonb),
    'markets', coalesce((
      select jsonb_agg(distinct p.prediction_type::text order by p.prediction_type::text)
      from public.predictions p
      where p.status in ('won', 'lost', 'void')
    ), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------------
-- League performance, narrowed to the caller's own slips
--
-- The profile asked "where is the engine good?" and answered across every
-- league in the product, most of which the reader has never backed. On a
-- personal page the useful question is "how has the engine done in the
-- leagues I actually follow", so this restricts to leagues the caller holds a
-- slip leg in. get_league_performance stays as the whole-product view for
-- anywhere that wants it.
-- ---------------------------------------------------------------------------
create or replace function public.get_my_league_performance()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(row_to_json(t) order by t.settled desc), '[]'::jsonb)
  from (
    select
      l.name    as "leagueName",
      l.country as "country",
      l.logo    as "logo",
      count(*) filter (where p.status = 'won')  as wins,
      count(*) filter (where p.status = 'lost') as losses,
      count(*) filter (where p.status in ('won','lost')) as settled,
      round(
        count(*) filter (where p.status = 'won')::numeric
        / nullif(count(*) filter (where p.status in ('won','lost')), 0),
        4
      ) as "accuracyRate",
      -- How many of this league's settled picks the caller actually backed.
      (
        select count(distinct sl.id)
        from public.slip_legs sl
        join public.slips s on s.id = sl.slip_id
        join public.predictions p2 on p2.id = sl.prediction_id
        join public.fixtures f2 on f2.id = p2.fixture_id
        where s.user_id = (select auth.uid()) and f2.league_id = l.id
      ) as "yourLegs"
    from public.predictions p
    join public.fixtures f on f.id = p.fixture_id
    join public.leagues l on l.id = f.league_id
    where p.status in ('won', 'lost')
      and (select auth.uid()) is not null
      and l.id in (
        select f3.league_id
        from public.slip_legs sl
        join public.slips s on s.id = sl.slip_id
        join public.predictions p3 on p3.id = sl.prediction_id
        join public.fixtures f3 on f3.id = p3.fixture_id
        where s.user_id = (select auth.uid())
      )
    group by l.id, l.name, l.country, l.logo
  ) t;
$$;

-- ---------------------------------------------------------------------------
-- Slips, with each leg's fixture attached
--
-- The legs table carries a prediction_id and nothing else, so the page could
-- only ever render the words "View prediction". Joining the fixture through
-- means a leg shows the match it is actually about.
-- ---------------------------------------------------------------------------
create or replace function public.get_my_slips()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(row_to_json(t) order by t."confirmedAt" desc), '[]'::jsonb)
  from (
    select
      s.id,
      s.slip_type       as "slipType",
      s.status,
      s.combined_odds   as "combinedOdds",
      s.leg_count       as "legCount",
      s.confirmed_at    as "confirmedAt",
      -- slips carries no settled_at. The moment a slip finished is the moment
      -- its last leg did, which is the truer number anyway.
      (
        select max(p2.settled_at)
        from public.slip_legs sl2
        join public.predictions p2 on p2.id = sl2.prediction_id
        where sl2.slip_id = s.id
      ) as "settledAt",
      (
        select coalesce(jsonb_agg(leg order by leg->>'kickoff'), '[]'::jsonb)
        from (
          select jsonb_build_object(
            'id', sl.id,
            'predictionId', sl.prediction_id,
            'odds', sl.odds,
            'status', sl.status,
            'market', p.prediction_type,
            'predictedValue', p.predicted_value,
            'confidenceScore', p.confidence_score,
            'kickoff', f.fixture_date,
            'fixtureStatus', f.status,
            'homeGoals', f.home_goals,
            'awayGoals', f.away_goals,
            'homeTeam', jsonb_build_object('name', ht.name, 'shortName', ht.short_name, 'logo', ht.logo),
            'awayTeam', jsonb_build_object('name', at2.name, 'shortName', at2.short_name, 'logo', at2.logo),
            'league', jsonb_build_object('name', l.name, 'country', l.country, 'logo', l.logo)
          ) as leg
          from public.slip_legs sl
          join public.predictions p on p.id = sl.prediction_id
          join public.fixtures f on f.id = p.fixture_id
          join public.teams ht on ht.id = f.home_team_id
          join public.teams at2 on at2.id = f.away_team_id
          join public.leagues l on l.id = f.league_id
          where sl.slip_id = s.id
        ) legs
      ) as legs
    from public.slips s
    where s.user_id = (select auth.uid())
  ) t;
$$;

/**
 * Settled-slip performance.
 *
 * Settled only, deliberately: an open slip has no outcome, and counting it
 * would move the win rate every time someone builds one. Returns is the sum of
 * combined odds on winning slips, against one unit staked per settled slip.
 */
create or replace function public.get_my_slip_stats()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with settled as (
    select s.status, s.combined_odds, s.leg_count
    from public.slips s
    where s.user_id = (select auth.uid())
      and s.status in ('won', 'lost', 'void')
  ),
  graded as (select * from settled where status in ('won', 'lost'))
  select jsonb_build_object(
    'settled', (select count(*) from graded),
    'won',     (select count(*) from graded where status = 'won'),
    'lost',    (select count(*) from graded where status = 'lost'),
    'void',    (select count(*) from settled where status = 'void'),
    'open',    (select count(*) from public.slips
                where user_id = (select auth.uid())
                  and status in ('open', 'confirmed')),
    'winRate', (select round(count(*) filter (where status = 'won')::numeric
                             / nullif(count(*), 0), 4) from graded),
    'roi',     (select round((coalesce(sum(combined_odds) filter (where status = 'won'), 0)
                              - count(*)) / nullif(count(*), 0), 4) from graded),
    'bestWin', (select round(max(combined_odds), 2) from graded where status = 'won'),
    'avgLegs', (select round(avg(leg_count), 1) from graded)
  );
$$;

grant execute on function public.get_prediction_history(integer, integer, text, text, text) to anon, authenticated;
grant execute on function public.get_history_stats() to anon, authenticated;
grant execute on function public.get_history_facets() to anon, authenticated;
grant execute on function public.get_my_league_performance() to authenticated;
grant execute on function public.get_my_slips() to authenticated;
grant execute on function public.get_my_slip_stats() to authenticated;
