-- ============================================================================
-- Last season's averages, for sides whose current season is too short to read
--
-- At matchday 2 a season average is two matches wide. One 4-0 moves goals per
-- game by 2.0, and the payload printed that number in exactly the format it
-- prints a settled 38-game record — same line, same precision, no games-played
-- figure anywhere near it. The engine could not tell a hard number from a
-- coin flip, and Step 1 calls season averages its "primary quantitative
-- signal", so early-season fixtures were scored off noise and then correctly
-- refused by the anchoring rules for resting on thin data.
--
-- These hold the SAME shape as home_season / away_season, for the season
-- before. Null is the normal state: the fetch only asks for them while a side
-- is under the thin-season threshold, so they stop being written a few weeks
-- into a season and stay null for the rest of it.
--
-- Deliberately additive rather than a rewrite of home_season. Both records go
-- to the prompt, each labelled with the games behind it. Silently swapping a
-- stale average in where a live one is expected is the fabrication the whole
-- [GATED] design of the prompt exists to prevent.
-- ============================================================================

alter table public.fixture_stats
  add column if not exists home_season_prior jsonb,
  add column if not exists away_season_prior jsonb;

comment on column public.fixture_stats.home_season_prior is
  'Home side''s previous-season averages. Written only while the current season is under the thin-season threshold; null otherwise, and null for a side with no record in this league last season.';
comment on column public.fixture_stats.away_season_prior is
  'Away side''s previous-season averages. Written only while the current season is under the thin-season threshold; null otherwise, and null for a side with no record in this league last season.';
