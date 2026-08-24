-- ============================================================================
-- Measure how long an engine run actually takes
--
-- The model call is now the binding constraint on daily-picks, not the API
-- call budget it was sized against. One real run over seven fixtures took 152
-- seconds against a client timeout that was then 120s — it succeeded, but by
-- luck rather than headroom. The timeout is now 240s inside the platform's own
-- 300s ceiling, and the session cap came down to 20 fixtures.
--
-- Neither number is measured against anything. 152s over seven fixtures is the
-- only data point that exists, and a session cap of 20 is an extrapolation from
-- it that nobody has watched run. This is the column that turns the next twenty
-- runs into evidence:
--
--   duration_ms          wall clock for the whole pass, including the model call
--   model_duration_ms    the model call alone, which is what the timeout bounds
--   fixtures_considered  what the run was asked to reason over
--
-- Kept on prediction_runs rather than in a new table because that is already
-- the row written once per pass, and "Recent runs" in the Office already lists
-- it. Nullable throughout: every row written before today is genuinely unknown,
-- and a zero would read as an instant run.
-- ============================================================================

alter table public.prediction_runs
  add column if not exists duration_ms         integer,
  add column if not exists model_duration_ms   integer,
  add column if not exists fixtures_considered integer;

comment on column public.prediction_runs.duration_ms is
  'Wall clock for the whole run in milliseconds. Null for runs recorded before timing was tracked.';
comment on column public.prediction_runs.model_duration_ms is
  'The model call alone, in milliseconds. This is what ANTHROPIC_TIMEOUT_MS bounds; compare the two before raising the session fixture cap.';
comment on column public.prediction_runs.fixtures_considered is
  'How many fixtures the run was asked to analyse. Duration is only readable against this.';
