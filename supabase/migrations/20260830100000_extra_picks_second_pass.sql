-- ============================================================================
-- Extra picks become their own pass, and stay out of the public record
--
-- Extra picks used to resell fixtures the board had already predicted, which
-- meant paying for something the buyer could see for free the moment their day
-- pass unlocked it. They now cover the OTHER half of the board: the games the
-- 05:00 run scored and did not publish because they fell below the floor.
--
-- Those calls are real analysis, they are simply less certain — so they get
-- their own lower cutoff (extraPicksFloor, 5.0 against the board's 7.0) and a
-- second engine pass at 05:30 over whatever the first pass left without a pick.
--
-- THEY MUST NOT REACH THE PUBLIC RECORD. They are by definition the calls the
-- board would not carry, so counting them in the published hit rate would
-- report the engine as worse than the product it actually sells — and the hit
-- rate is the one number this product asks to be trusted on. Every public read
-- filters them out below; the buyer sees theirs through get_my_extra_picks.
-- ============================================================================

alter table public.predictions
  add column if not exists tier text not null default 'primary';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'predictions_tier_check'
  ) then
    alter table public.predictions
      add constraint predictions_tier_check check (tier in ('primary', 'extra'));
  end if;
end;
$$;

comment on column public.predictions.tier is
  'primary = published on the board. extra = below the board floor, sold through extra picks and excluded from every public statistic.';

create index if not exists predictions_tier_idx on public.predictions (tier);

-- ---------------------------------------------------------------------------
-- The public reads, each excluding extras
-- ---------------------------------------------------------------------------

create or replace function public.get_recent_results(max_rows integer default 50)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(app.pick_json(p) order by p.settled_at desc), '[]'::jsonb)
  from (
    select * from public.predictions
    where status in ('won', 'lost') and tier = 'primary'
    order by settled_at desc
    limit least(coalesce(max_rows, 50), 100)
  ) p;
$$;

create or replace function public.get_status_counts()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'all', count(*),
    'upcoming', count(*) filter (where p.status = 'pending' and f.status = 'scheduled'),
    'live', count(*) filter (where p.status = 'pending' and f.status = 'live'),
    'settled', count(*) filter (where p.status in ('won', 'lost'))
  )
  from public.predictions p
  join public.fixtures f on f.id = p.fixture_id
  where p.tier = 'primary';
$$;

create or replace function public.get_engine_stats()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with graded as (
    select p.status, app.pick_price(p) as price
    from public.predictions p
    where p.status in ('won', 'lost') and p.tier = 'primary'
  )
  select jsonb_build_object(
    'winRate', coalesce(round(count(*) filter (where status = 'won')::numeric
                              / nullif(count(*), 0), 4), 0),
    'totalPicks', count(*),
    -- One unit staked per settled pick, returned at the price we took.
    'roi', coalesce(round((coalesce(sum(price) filter (where status = 'won'), 0)
                           - count(*)) / nullif(count(*), 0), 4), 0)
  )
  from graded;
$$;

-- get_my_extra_picks returns only the paid tier. A fixture is never sold while
-- it carries a board pick, so this cannot filter anything the buyer paid for —
-- it stops a primary pick being handed over free if that ever changes.
create or replace function public.get_my_extra_picks()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(app.pick_json(p) order by p.confidence_score desc), '[]'::jsonb)
  from public.predictions p
  where (select auth.uid()) is not null
    and p.tier = 'extra'
    and p.fixture_id in (
      select unnest(o.fixture_ids)
      from public.extra_pick_orders o
      where o.user_id = (select auth.uid())
        and o.date_key = (select app.utc_today())
        and o.status = 'active'
    );
$$;

-- The picker sells only fixtures with an EXTRA pick now, since a fixture with a
-- board pick is not for sale.
create or replace function public.get_extra_pick_leagues()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with owned as (
    select unnest(o.fixture_ids) as fixture_id
    from public.extra_pick_orders o
    where o.user_id = (select auth.uid())
      and o.date_key = (select app.utc_today())
      and o.status = 'active'
  ),
  sellable as (
    select f.league_id, f.id
    from public.fixtures f
    join public.predictions p on p.fixture_id = f.id and p.tier = 'extra'
    where f.status = 'scheduled'
      and f.fixture_date >= now()
      and f.fixture_date < ((select app.utc_today()) + 1)::timestamp at time zone 'utc'
      and f.id not in (select fixture_id from owned)
    group by f.league_id, f.id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'leagueId', s.league_id, 'name', l.name, 'country', l.country,
        'logo', l.logo, 'availableGames', s.games
      ) order by l.name
    ), '[]'::jsonb
  )
  from (select league_id, count(*)::int as games from sellable group by league_id) s
  join public.leagues l on l.id = s.league_id;
$$;

grant execute on function public.get_extra_pick_leagues() to authenticated;

-- ---------------------------------------------------------------------------
-- Seed the floor, and schedule the second pass
--
-- 05:30 — after the 05:00 board, which has taken up to five minutes, and well
-- clear of the first kickoffs.
-- ---------------------------------------------------------------------------

update public.ai_engine_config
set confidence_thresholds = confidence_thresholds || jsonb_build_object('extraPicksFloor', 5.0)
where confidence_thresholds ->> 'extraPicksFloor' is null;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'kicka_extra_picks') then
    perform cron.unschedule('kicka_extra_picks');
  end if;
end;
$$;

select cron.schedule(
  'kicka_extra_picks',
  '30 5 * * *',
  $$select app.call_endpoint('/api/cron/extra-picks')$$
);
