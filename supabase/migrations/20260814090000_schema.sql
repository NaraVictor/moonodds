-- ============================================================================
-- MoonOdds — core schema
--
-- Ported from the Convex document model. Notable translations:
--   Id<"table">        -> uuid, with real foreign keys
--   ISO 8601 strings   -> timestamptz
--   "YYYY-MM-DD" keys  -> date  (all day boundaries are UTC)
--   JSON-encoded text  -> jsonb
--   v.union(literals)  -> native enum types
--
-- Convex forced an index declaration for every query. Postgres will happily
-- sequential-scan forever without complaining, so indexes here are deliberate
-- and mirror the access patterns the app actually has.
-- ============================================================================

create extension if not exists "pgcrypto" with schema extensions;

-- Private schema for helpers that must never be reachable through PostgREST.
create schema if not exists app;
revoke all on schema app from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------

create type fixture_status as enum ('scheduled', 'live', 'finished');

create type prediction_type as enum (
  '1x2',
  'over_under_2_5',
  'over_under_1_5',
  'over_under_3_5',
  'btts',
  'double_chance',
  'handicap',
  'corners_over_under',
  'correct_score',
  'draw_no_bet',
  'first_half_goals',
  'second_half_goals'
);

create type prediction_status as enum (
  'pending', 'won', 'lost', 'void', 'review_needed', 'disputed'
);

create type slip_type as enum ('single', 'accumulator');
create type slip_status as enum ('open', 'confirmed', 'won', 'lost', 'partial', 'void');
create type slip_leg_status as enum ('pending', 'won', 'lost', 'void');

create type pass_status as enum ('active', 'expired', 'refunded');
create type order_status as enum ('active', 'refunded');
create type payment_status as enum ('pending', 'succeeded', 'failed', 'refunded');

create type efficiency_flag as enum ('high_edge', 'standard', 'low_edge');
create type config_status as enum ('active', 'draft', 'archived');
create type tuning_status as enum ('pending', 'approved', 'rejected');
create type job_status as enum ('queued', 'running', 'done', 'failed', 'dead');

-- ---------------------------------------------------------------------------
-- Identity
--
-- auth.users is the source of truth. profiles carries app-level attributes.
-- Authorization flags live HERE, never in user_metadata: raw_user_meta_data is
-- user-writable and surfaces in auth.jwt(), so an is_super_admin claim stored
-- there would let any user grant themselves the Office panel.
-- ---------------------------------------------------------------------------

create table profiles (
  id              uuid primary key references auth.users (id) on delete cascade,
  display_name    text,
  email           text,
  phone           text,
  is_super_admin  boolean not null default false,
  is_suspended    boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on column profiles.is_super_admin is
  'Authorization flag. Must never be mirrored into user_metadata.';

-- Free-trial eligibility is derived from auth.users.created_at rather than a
-- stored first_seen_date, so it cannot drift or be edited.
create or replace function app.first_seen_date(uid uuid)
returns date
language sql
stable
security definer
set search_path = ''
as $$
  select (u.created_at at time zone 'utc')::date
  from auth.users u
  where u.id = uid;
$$;

-- ---------------------------------------------------------------------------
-- Football catalogue
-- ---------------------------------------------------------------------------

create table leagues (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  slug         text not null unique,
  country      text not null,
  is_active    boolean not null default true,
  external_id  integer unique,
  season       integer,
  logo         text,
  created_at   timestamptz not null default now()
);

create index leagues_country_idx on leagues (country);
create index leagues_active_idx on leagues (is_active) where is_active;

create table teams (
  id           uuid primary key default gen_random_uuid(),
  league_id    uuid not null references leagues (id) on delete cascade,
  name         text not null,
  short_name   text not null,
  slug         text not null unique,
  is_active    boolean not null default true,
  external_id  integer unique,
  logo         text,
  created_at   timestamptz not null default now()
);

create index teams_league_idx on teams (league_id);

create table fixtures (
  id             uuid primary key default gen_random_uuid(),
  league_id      uuid not null references leagues (id) on delete cascade,
  home_team_id   uuid not null references teams (id),
  away_team_id   uuid not null references teams (id),
  slug           text not null unique,
  fixture_date   timestamptz not null,
  started_at     timestamptz,
  ended_at       timestamptz,
  status         fixture_status not null default 'scheduled',
  home_goals     smallint,
  away_goals     smallint,
  ht_home_goals  smallint,
  ht_away_goals  smallint,
  venue          text,
  referee        text,
  round          text,
  raw_metadata   jsonb not null default '{}'::jsonb,
  external_id    integer unique,
  created_at     timestamptz not null default now(),
  constraint fixtures_distinct_teams check (home_team_id <> away_team_id)
);

-- getTodaysPicks scans a day window; the pipeline scans by league within a day.
create index fixtures_date_idx on fixtures (fixture_date);
create index fixtures_league_date_idx on fixtures (league_id, fixture_date);
create index fixtures_status_idx on fixtures (status);
-- Grading looks for finished fixtures that still have no score.
create index fixtures_ungraded_idx on fixtures (fixture_date)
  where status <> 'finished';

create table fixture_stats (
  id                    uuid primary key default gen_random_uuid(),
  fixture_id            uuid references fixtures (id) on delete cascade,
  fixture_external_id   integer,
  fetched_at            timestamptz not null default now(),

  home_form             text,
  away_form             text,

  h2h_home_wins         smallint,
  h2h_away_wins         smallint,
  h2h_draws             smallint,
  h2h_avg_goals         numeric(5, 2),
  h2h_btts_rate         numeric(4, 3),

  home_season           jsonb not null default '{}'::jsonb,
  away_season           jsonb not null default '{}'::jsonb,

  h2h_matches           jsonb not null default '[]'::jsonb,
  home_recent_matches   jsonb not null default '[]'::jsonb,
  away_recent_matches   jsonb not null default '[]'::jsonb
);

create unique index fixture_stats_fixture_idx on fixture_stats (fixture_id);
create index fixture_stats_external_idx on fixture_stats (fixture_external_id);

-- ---------------------------------------------------------------------------
-- Predictions
-- ---------------------------------------------------------------------------

create table tipsters (
  id            uuid primary key default gen_random_uuid(),
  display_name  text not null,
  slug          text not null unique,
  avatar_url    text,
  is_active     boolean not null default true
);

create table prediction_runs (
  id                 uuid primary key default gen_random_uuid(),
  run_at             timestamptz not null default now(),
  league_ids         uuid[] not null default '{}',
  num_picks          integer not null default 0,
  criteria_snapshot  jsonb,
  model_version      text not null
);

create index prediction_runs_run_at_idx on prediction_runs (run_at desc);

create table predictions (
  id                    uuid primary key default gen_random_uuid(),
  fixture_id            uuid not null references fixtures (id) on delete cascade,
  tipster_id            uuid not null references tipsters (id),
  prediction_run_id     uuid references prediction_runs (id) on delete set null,

  prediction_type       prediction_type not null,
  predicted_value       text not null,
  -- 0–10 scale, matching the engine's confidence thresholds.
  confidence_score      numeric(4, 2) not null
                          check (confidence_score >= 0 and confidence_score <= 10),
  staking_unit          smallint not null check (staking_unit between 1 and 5),
  frontier_explanation  text not null,
  status                prediction_status not null default 'pending',

  model_version         text,
  local_model_output    jsonb,
  manual_override       boolean not null default false,
  override_reason       text,
  actual_result         jsonb,

  reasoning_tags        text[] not null default '{}',
  alt_market            prediction_type,
  alt_predicted_value   text,
  alt_confidence        numeric(4, 2),

  mra_signal_home       text,
  mra_signal_away       text,
  filters_applied       jsonb not null default '{}'::jsonb,
  void_reason           text,

  created_at            timestamptz not null default now(),
  settled_at            timestamptz
);

create index predictions_fixture_idx on predictions (fixture_id);
create index predictions_status_idx on predictions (status);
create index predictions_run_idx on predictions (prediction_run_id);
-- The public track record and the self-tuning window both read settled picks
-- newest-first; a partial index keeps that off the pending rows.
create index predictions_settled_idx on predictions (settled_at desc)
  where status in ('won', 'lost');
-- Ordering picks by confidence is the single hottest read in the app.
create index predictions_confidence_idx on predictions (confidence_score desc);

create table odds_snapshots (
  id              uuid primary key default gen_random_uuid(),
  fixture_id      uuid not null references fixtures (id) on delete cascade,
  prediction_id   uuid references predictions (id) on delete cascade,
  market_type     text not null,
  bookmaker       text,
  opening_odds    numeric(8, 3),
  pick_odds       numeric(8, 3),
  closing_odds    numeric(8, 3),
  clv_delta       numeric(6, 4),
  market_opposed  boolean,
  captured_at     timestamptz not null default now()
);

create index odds_snapshots_fixture_idx on odds_snapshots (fixture_id);
create index odds_snapshots_prediction_idx on odds_snapshots (prediction_id);

create table league_performance_log (
  id              uuid primary key default gen_random_uuid(),
  league_id       uuid not null references leagues (id) on delete cascade,
  evaluated_at    timestamptz not null default now(),
  total_picks     integer not null,
  wins            integer not null,
  losses          integer not null,
  accuracy_rate   numeric(4, 3) not null,
  avg_clv_delta   numeric(6, 4),
  efficiency_flag efficiency_flag not null
);

create index league_performance_league_idx on league_performance_log (league_id);
create index league_performance_evaluated_idx on league_performance_log (evaluated_at desc);

-- ---------------------------------------------------------------------------
-- User activity
-- ---------------------------------------------------------------------------

create table slips (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references profiles (id) on delete cascade,
  slip_type      slip_type not null,
  status         slip_status not null default 'confirmed',
  combined_odds  numeric(10, 3) not null,
  leg_count      smallint not null,
  confirmed_at   timestamptz not null default now()
);

create index slips_user_idx on slips (user_id, confirmed_at desc);
create index slips_user_status_idx on slips (user_id, status);

create table slip_legs (
  id             uuid primary key default gen_random_uuid(),
  slip_id        uuid not null references slips (id) on delete cascade,
  prediction_id  uuid not null references predictions (id) on delete cascade,
  odds           numeric(8, 3) not null,
  status         slip_leg_status not null default 'pending'
);

create index slip_legs_slip_idx on slip_legs (slip_id);
create index slip_legs_prediction_idx on slip_legs (prediction_id);
create unique index slip_legs_unique_idx on slip_legs (slip_id, prediction_id);

create table notification_preferences (
  user_id                uuid primary key references profiles (id) on delete cascade,
  email_enabled          boolean not null default true,
  sms_enabled            boolean not null default false,
  daily_picks_alert      boolean not null default true,
  slip_result_alert      boolean not null default true,
  high_confidence_alert  boolean not null default true
);

-- ---------------------------------------------------------------------------
-- Monetisation
--
-- payments is new. In the Convex app, verifyPass checked Paystack status,
-- currency and a minimum amount but never that the reference belonged to the
-- caller — so a known-good reference could activate a pass on any account.
-- Recording the reference against its buyer at initialise time closes that.
-- ---------------------------------------------------------------------------

create table payments (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references profiles (id) on delete cascade,
  reference     text not null unique,
  purpose       text not null check (purpose in ('daily_pass', 'extra_picks')),
  amount_minor  integer not null check (amount_minor > 0),
  currency      text not null default 'GHS',
  amount_usd    numeric(8, 2) not null,
  status        payment_status not null default 'pending',
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  settled_at    timestamptz
);

create index payments_user_idx on payments (user_id, created_at desc);

create table daily_passes (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles (id) on delete cascade,
  date_key     date not null,
  amount_usd   numeric(8, 2) not null,
  currency     text not null default 'GHS',
  payment_id   uuid references payments (id) on delete set null,
  status       pass_status not null default 'active',
  created_at   timestamptz not null default now()
);

-- One pass per user per day. The Convex version enforced this in code; here the
-- database guarantees it, so a double-charge can't produce two passes.
create unique index daily_passes_user_date_idx on daily_passes (user_id, date_key);
create index daily_passes_active_idx on daily_passes (user_id, date_key)
  where status = 'active';

create table extra_pick_orders (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references profiles (id) on delete cascade,
  date_key     date not null,
  league_ids   uuid[] not null default '{}',
  fixture_ids  uuid[] not null default '{}',
  num_games    smallint not null,
  amount_usd   numeric(8, 2) not null,
  currency     text not null default 'GHS',
  payment_id   uuid references payments (id) on delete set null,
  status       order_status not null default 'active',
  created_at   timestamptz not null default now()
);

create index extra_pick_orders_user_date_idx on extra_pick_orders (user_id, date_key);

-- ---------------------------------------------------------------------------
-- AI engine
--
-- The nested Convex objects (rankingWeights, confidenceThresholds, ...) stay
-- as jsonb: they are always read and written whole, and keeping them as blobs
-- means adding a threshold needs no migration.
-- ---------------------------------------------------------------------------

create table ai_engine_config (
  id                     uuid primary key default gen_random_uuid(),
  name                   text not null,
  version                text not null,
  status                 config_status not null default 'draft',

  system_prompt          text not null,

  ranking_weights        jsonb not null,
  weight_constraints     jsonb not null,
  confidence_thresholds  jsonb not null,
  filter_thresholds      jsonb not null,
  market_pivots          jsonb not null,
  slip_building          jsonb not null,
  self_tuning            jsonb not null,
  api_budget             jsonb not null,

  selected_league_ids    integer[] not null default '{}',

  notes                  text,
  approved_by            text,
  last_updated_at        timestamptz not null default now(),
  created_at             timestamptz not null default now()
);

-- Exactly one active config at a time — the daily job assumes it.
create unique index ai_engine_config_single_active_idx on ai_engine_config (status)
  where status = 'active';

create table tuning_reports (
  id                             uuid primary key default gen_random_uuid(),
  config_id                      uuid not null references ai_engine_config (id) on delete cascade,
  report_type                    text not null default 'weight_review',

  review_period                  jsonb not null,
  performance_by_market          jsonb not null default '{}'::jsonb,
  performance_by_league          jsonb not null default '{}'::jsonb,
  performance_by_confidence_band jsonb not null default '{}'::jsonb,
  performance_by_filter          jsonb not null default '{}'::jsonb,
  performance_by_mra_signal      jsonb not null default '{}'::jsonb,

  proposed_weight_changes        jsonb not null default '[]'::jsonb,
  proposed_threshold_changes     jsonb not null default '[]'::jsonb,
  proposed_filter_changes        jsonb not null default '[]'::jsonb,

  status                         tuning_status not null default 'pending',
  approved_by                    text,
  approved_at                    timestamptz,
  rejection_reason               text,
  generated_at                   timestamptz not null default now()
);

create index tuning_reports_status_idx on tuning_reports (status);
create index tuning_reports_config_idx on tuning_reports (config_id, generated_at desc);

create table otp_tokens (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  code        text not null,
  purpose     text not null,
  expires_at  timestamptz not null,
  used        boolean not null default false,
  created_at  timestamptz not null default now()
);

create index otp_tokens_lookup_idx on otp_tokens (email, purpose, used);

-- ---------------------------------------------------------------------------
-- Jobs outbox
--
-- Replaces ctx.scheduler.runAfter(0, ...). Rows are written in the same
-- transaction as the work that triggered them, so a notification fan-out can
-- never be half-committed, and unlike the Convex scheduler this gives us
-- retries, a dead-letter state and an audit trail.
-- ---------------------------------------------------------------------------

create table jobs (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null,
  payload       jsonb not null default '{}'::jsonb,
  status        job_status not null default 'queued',
  run_after     timestamptz not null default now(),
  attempts      smallint not null default 0,
  max_attempts  smallint not null default 5,
  last_error    text,
  locked_at     timestamptz,
  created_at    timestamptz not null default now(),
  completed_at  timestamptz
);

-- The drain query: claimable work, oldest first.
create index jobs_claimable_idx on jobs (run_after)
  where status = 'queued';
create index jobs_kind_idx on jobs (kind, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------

create or replace function app.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger profiles_touch_updated_at
  before update on profiles
  for each row execute function app.touch_updated_at();
