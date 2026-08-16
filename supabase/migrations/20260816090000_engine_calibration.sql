-- Engine calibration trail.
--
-- The v2.2 prompt scores a fixture twice: once from the weighted signals
-- (confidenceRaw), then again after the anchoring ceilings bite. The gap
-- between the two IS the calibration, and until now only the second number
-- survived — so "the engine is overconfident on thin data" was a claim nobody
-- could check against stored data.
--
-- Three columns rather than one jsonb blob, because these are the fields the
-- tuning job groups by. The rest of the engine's audit trail (the H2H, form,
-- personnel and penalty logs) goes in the existing `local_model_output`, which
-- is read one row at a time and never aggregated.

alter table predictions
  add column if not exists confidence_raw numeric(4, 2)
    check (confidence_raw is null or (confidence_raw >= 0 and confidence_raw <= 10)),
  add column if not exists anchor_cap_applied boolean not null default false,
  add column if not exists consistency_override boolean not null default false;

comment on column predictions.confidence_raw is
  'Confidence before anchoring ceilings were applied. Null on picks written before v2.2.';
comment on column predictions.anchor_cap_applied is
  'True when a Step 7 anchoring ceiling lowered the score.';
comment on column predictions.consistency_override is
  'True when Step 9A found predictedValue contradicting its own reasoning and re-derived it.';

-- Settled picks where anchoring bit, newest first: the query behind "is the
-- ceiling doing useful work or just flattening good calls?". Partial, because
-- the pending rows have no outcome to learn from.
create index if not exists predictions_anchor_cap_idx
  on predictions (anchor_cap_applied, settled_at desc)
  where status in ('won', 'lost');

-- A consistency override means the engine talked itself out of its own pick.
-- Rare by design, and worth being able to find every instance instantly.
create index if not exists predictions_consistency_override_idx
  on predictions (created_at desc)
  where consistency_override;
