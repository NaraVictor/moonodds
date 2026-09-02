-- ============================================================================
-- Which markets the engine may select
--
-- The permitted list has been fixed in two places since the engine was
-- written: the JSON-schema enum the model generates against, and a prose
-- section of the system prompt. Neither could be changed without a deploy, so
-- an operator watching a market underperform had no way to stop the engine
-- choosing it.
--
-- It sits on the config beside selected_league_ids, versioned with it, for the
-- same reason: a draft config should be able to try a different set without
-- touching what is live.
--
-- Empty means "everything gradeable", not "nothing". A null-or-empty column on
-- an existing row must not silently switch the board off, and the fallback
-- lives in the application so one definition of "all markets" serves the
-- schema, the prompt and this default.
-- ============================================================================
alter table public.ai_engine_config
  add column if not exists enabled_markets text[] not null default '{}';

comment on column public.ai_engine_config.enabled_markets is
  'Markets the engine may select. Empty means every gradeable market. corners_under_over is never included: it cannot be graded, so a corners pick would sit unresolved on a slip forever.';

-- Seed every existing config with the full gradeable set, so the column reads
-- as a deliberate choice rather than as an empty default nobody has looked at.
update public.ai_engine_config
set enabled_markets = array[
  '1x2', 'double_chance', 'draw_no_bet',
  'over_under_1_5', 'over_under_2_5', 'over_under_3_5',
  'btts', 'first_half_goals', 'second_half_goals',
  'handicap', 'correct_score'
]
where cardinality(enabled_markets) = 0;
