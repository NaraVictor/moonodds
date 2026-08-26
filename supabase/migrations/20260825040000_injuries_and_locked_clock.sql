-- ============================================================================
-- Absences the engine can actually read, and the clock on a locked card
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. The match minute on a locked pick
--
-- pick_json gained elapsed_minutes last migration; pick_json_locked did not, so
-- a visitor without a pass saw "Kicked off 6:45 PM" on a match in its 67th
-- minute while a pass holder saw the minute.
--
-- There is nothing to protect here. The score is ALREADY in the locked payload
-- and is far more revealing than the clock; the minute is on every scoreboard
-- in the world. What is sold is the call, the confidence and the reasoning, and
-- those stay exactly as absent as they were.
-- ---------------------------------------------------------------------------

create or replace function app.pick_json_locked(p public.predictions)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p.id,
    'locked', true,
    'status', p.status,
    'predictionType', p.prediction_type,
    'fixture', jsonb_build_object(
      'id', f.id,
      'date', f.fixture_date,
      'status', f.status,
      'venue', f.venue,
      'round', f.round,
      'homeGoals', f.home_goals,
      'awayGoals', f.away_goals,
      'elapsed', f.elapsed_minutes,
      'elapsedExtra', f.elapsed_extra,
      'statusShort', f.status_short
    ),
    'homeTeam', jsonb_build_object('name', ht.name, 'shortName', ht.short_name, 'logo', ht.logo),
    'awayTeam', jsonb_build_object('name', at2.name, 'shortName', at2.short_name, 'logo', at2.logo),
    'league', jsonb_build_object('name', l.name, 'country', l.country, 'logo', l.logo)
  )
  from public.fixtures f
  join public.teams ht on ht.id = f.home_team_id
  join public.teams at2 on at2.id = f.away_team_id
  join public.leagues l on l.id = f.league_id
  where f.id = p.fixture_id;
$$;

-- ---------------------------------------------------------------------------
-- 2. Absences
--
-- STEP 6, PERSONNEL has been gated off since the prompt was written, because
-- the only personnel feed anybody had wired was line-ups — and those publish
-- about forty minutes before kickoff, while daily-picks runs at 06:00. Twelve
-- hours too late to inform a prediction, which is why they stay out of it.
--
-- /injuries is the same question asked early. It is keyed per fixture, it
-- covers suspensions as well as injuries (a red card comes back as a reason),
-- and it is populated from roughly match day rather than from an hour before
-- kickoff.
--
-- absences_fetched_at IS THE GUARD, and it is the whole point of the design.
-- An empty array cannot be told from "we never asked", and those mean opposite
-- things: one is a fully fit squad, the other is no information. Getting that
-- wrong is how a side with three defenders out gets scored as clean. So the
-- timestamp records that the question WAS asked, and the pipeline still refuses
-- to treat an empty answer as a clean bill of health — see statsBlock.
-- ---------------------------------------------------------------------------

alter table public.fixture_stats
  add column if not exists home_absences       jsonb,
  add column if not exists away_absences       jsonb,
  add column if not exists absences_fetched_at timestamptz;

comment on column public.fixture_stats.home_absences is
  'Players reported missing for the home side. NULL means never fetched; an empty array means the feed returned nothing, which is not the same as a fit squad.';
comment on column public.fixture_stats.away_absences is
  'Players reported missing for the away side. Same NULL-versus-empty distinction as home_absences.';
comment on column public.fixture_stats.absences_fetched_at is
  'When the injuries feed was last asked about this fixture. Distinguishes "asked and got nothing" from "never asked" — the two look identical in the arrays and mean opposite things.';

-- ---------------------------------------------------------------------------
-- 3. Fetch them before the engine runs, not after
--
-- 05:30, half an hour ahead of daily-picks at 06:00. That ordering is the
-- entire reason this feed is worth having over line-ups: it lands before the
-- prediction rather than after it.
-- ---------------------------------------------------------------------------

do $$
begin
  if exists (select 1 from cron.job where jobname = 'kicka_fetch_injuries') then
    perform cron.unschedule('kicka_fetch_injuries');
  end if;
end;
$$;

select cron.schedule(
  'kicka_fetch_injuries',
  '30 5 * * *',
  $$select app.call_endpoint('/api/cron/fetch-injuries')$$
);
