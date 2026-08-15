# Feature gaps vs. the original Oddstar app

Cross-referenced against `~/Desktop/os/oddstar code` — 120 Convex functions and
30 page components, compared by **capability** rather than by function name
(the port renamed nearly everything, so a name diff produced ~100 false
positives and was discarded).

Ported and verified working is omitted. This is what's missing.

---

## 1. Bet slip builder — the largest gap

The original had `bet-slip-sheet.tsx`, `bet-slip-fab.tsx` and a `use-bet-slip`
hook: a floating action button, a sheet you add picks into, running combined
odds, then confirm.

**None of that exists here.** `useConfirmSlip` and the `/api/slips` route and
`create_slip` RPC are all built and working — but nothing calls them. `/slips`
shows saved slips read-only, and there is no way to create one.

This is the biggest user-facing hole: a core product loop is unreachable.

## 2. Office catalog is read-only

Original: `createLeague` `updateLeague` `upsertLeague` `importLeague`
`searchLeagues` `createTeam` `updateTeam` `deleteTeam` `importTeam`
`searchTeams` `fetchTeamsByLeague` `setSelectedLeagues`, plus
`edit-league-dialog` / `edit-team-dialog` / `setup-data-panel`.

Here the Catalog tab lists leagues and teams and nothing else.

**`setSelectedLeagues` matters most** — it controls which leagues the daily
fetch covers. Right now that's only editable by writing to
`ai_engine_config.selected_league_ids` directly in SQL.

## 3. Manual prediction management

Original: `createPrediction` `updatePrediction` `deletePrediction`
`insertPrediction` and `prediction-form-dialog.tsx`.

The Predictions tab here is read-only. The schema carries `manual_override` and
`override_reason` columns — ported faithfully — but nothing writes them, so an
admin cannot correct or withdraw a bad call.

## 4. Manual result entry

Original: `updateFixtureResult`, wired into `grade-results-panel`.

Auto-grading works. But when the feed is wrong or a market needs a human (the
`review_needed` queue), there is no way to type in a score and settle it.

## 5. Engine config lifecycle

Original: `getAllConfigs` `getConfigById` `createConfig` `updateConfig`
`activateConfig` `seedConfig`.

Only the single active config is editable here. The schema supports
`status: active | draft | archived` and enforces one active row — but there's no
UI to draft a new version, compare, or activate/roll back. Editing the live
config is currently the only path.

## 6. Admin pass grant / revoke

Original: `grantDailyPass` `revokeDailyPass` `deleteUser`.

Admins can suspend and reinstate. They cannot comp a pass to a complaining
customer, revoke one, or delete an account.

## 7. Slip management

Original: `deleteSlip` `removeLeg` `getSlipCount` `getMySlipPicks`.

Slips are read-only for the user — no delete, no leg removal.

## 8. Personal stats and reports

Original: `getProfileStats` `getUserPicksReport` `getPredictionReport`.

Profile shows access tier and settings but no personal performance history. The
Office has no per-user or per-prediction report export.

## 9. Fixture stats refresh

Original: `fetchStatsForUpcomingFixtures` `upsertFixtureStats`
`saveFixtureStats` `getFixtureStatsByExternalId`.

`fixture_stats` is populated by the seed and read by the reasoning UI, but the
pipeline never fetches or refreshes it — so on real data the engine prompt would
carry no form/H2H/season numbers.

**This one has teeth**: the whole premise is that the engine reasons over real
stats, and that feed isn't wired.

## 10. Age gate

Original: `age-gate-dialog.tsx` — an 18+ confirmation on first visit.

Here there's only footer text. For a gambling-adjacent product that's likely a
compliance requirement, not a nicety.

## 11. League performance log

`league_performance_log` is in the schema and seeded, and the original had
`getLeaguePerformance` + a leagues panel showing per-league accuracy and
efficiency flags. Nothing reads it here.

---

## Fixed in this pass

**Notification toggles that did nothing.** The profile offered three alert
switches but only `daily_picks_ready` existed as a job kind — so "slip settled"
and "high confidence" were dead switches promising something the backend
couldn't deliver. Both are now implemented (`high_confidence_pick`,
`slip_settled`) and the daily run enqueues high-confidence alerts for anything
clearing 9.5. Verified: job claimed and completed.

---

## Suggested order

1. **Bet slip builder** — restores a core loop; the backend is already done.
2. **Fixture stats fetching** — without it the engine reasons on nothing real.
3. **Manual result entry + prediction override** — the operator escape hatches.
4. **Catalog CRUD**, starting with `setSelectedLeagues`.
5. Age gate (compliance).
6. Config lifecycle, pass grant/revoke, personal stats, league performance.
