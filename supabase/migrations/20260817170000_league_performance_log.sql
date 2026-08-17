-- ============================================================================
-- Fill league_performance_log
--
-- The table has existed and been indexed since the first schema migration and
-- nothing has ever written a row to it. profile_stats says so in a comment and
-- computes league performance live from settled predictions instead, which was
-- the right call: reading a cache nobody fills shows every league at zero.
--
-- This makes the recalibration job write the snapshot it was always supposed
-- to. Note what the table is and is not: it is a *historical record of how each
-- league looked at each evaluation*, not a live aggregate. The live figures on
-- the profile stay live. What this adds is the time series, which is the thing
-- you cannot reconstruct after the fact once picks age out of the window.
--
-- efficiency_flag is derived from CLV, not from win rate. Beating the closing
-- line is the measure of edge; winning is the measure of luck plus edge, and
-- collapsing the two would flag a lucky league as an efficient one. Where no
-- snapshot carries a clv_delta the flag is 'standard', because absent evidence
-- of edge is not evidence of its absence, and this codebase has been bitten
-- before by absent data being read as a value.
-- ============================================================================

create or replace function app.log_league_performance(p_since timestamptz)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  insert into public.league_performance_log (
    league_id, total_picks, wins, losses, accuracy_rate, avg_clv_delta, efficiency_flag
  )
  select
    f.league_id,
    count(*),
    count(*) filter (where p.status = 'won'),
    count(*) filter (where p.status = 'lost'),
    round(count(*) filter (where p.status = 'won')::numeric / count(*), 3),
    round(avg(c.clv)::numeric, 4),
    (case
       when avg(c.clv) is null   then 'standard'
       when avg(c.clv) >= 0.02   then 'high_edge'
       when avg(c.clv) <  0      then 'low_edge'
       else 'standard'
     end)::public.efficiency_flag
  from public.predictions p
  join public.fixtures f on f.id = p.fixture_id
  -- One CLV number per prediction first. Joining odds_snapshots directly would
  -- multiply a prediction by its snapshot count and inflate total_picks.
  left join lateral (
    select avg(o.clv_delta) as clv
    from public.odds_snapshots o
    where o.prediction_id = p.id and o.clv_delta is not null
  ) c on true
  where p.status in ('won', 'lost')
    and p.settled_at >= p_since
  group by f.league_id;

  get diagnostics n = row_count;
  return n;
end;
$$;

create or replace function public.log_league_performance(p_since timestamptz)
returns integer
language sql
security definer
set search_path = ''
as $$
  select app.log_league_performance(p_since);
$$;

-- Writes a performance record; never callable from a browser.
revoke all on function public.log_league_performance(timestamptz) from public, anon, authenticated;
grant execute on function public.log_league_performance(timestamptz) to service_role;
