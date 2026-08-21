-- ---------------------------------------------------------------------------
-- Kicka, inputs for the gated prompt steps
--
-- Steps 1D (split and venue form) and 1E (weighted head-to-head) were gated
-- off for want of data the pipeline was already paying for. `/teams/statistics`
-- reports every counter home, away and total, and we read only `.total`;
-- `/fixtures/headtohead` returns each meeting individually, and we reduced the
-- list to five aggregates before storing it. Neither needs an extra API call,
-- which matters on a plan with a 100-call day.
--
-- `h2h_matches`, `home_recent_matches` and `away_recent_matches` already exist
-- on this table, added with the original schema and never written to. Only the
-- venue splits are new.
-- ---------------------------------------------------------------------------

alter table fixture_stats
  add column if not exists home_split jsonb not null default '{}'::jsonb,
  add column if not exists away_split jsonb not null default '{}'::jsonb;

comment on column fixture_stats.home_split is
  'Home side''s record split by venue: {home:{...},away:{...}}. Empty object means no split available, which gates Step 1D off.';
comment on column fixture_stats.away_split is
  'Away side''s record split by venue. Empty object gates Step 1D off.';
comment on column fixture_stats.h2h_matches is
  'Individual meetings, newest first, for the Step 1E recency weighting. Empty array falls back to the aggregate h2h_* columns as an unweighted signal.';
comment on column fixture_stats.home_recent_matches is
  'Recent fixtures for the home side, for the Step 5 rest overlay. Derived from our own fixtures table: the Free plan refuses the API''s `last` parameter.';
