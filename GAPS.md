# Feature gaps vs. the original Oddstar app

Cross-referenced against `~/Desktop/os/oddstar code` — 120 Convex functions and
30 page components, compared by **capability** rather than by function name
(the port renamed nearly everything, so a name diff produced ~100 false
positives and was discarded).

Ported and verified working is omitted. This is what's missing.

---

## ~~1. Bet slip builder~~ — DONE

Built: FAB, sheet, add/remove from the card, localStorage persistence keyed
per day, combined odds, save through the existing `/api/slips` transaction.

**Odds bug found and fixed along the way.** The first version derived a leg
price as 1/confidence — so a 97%-confidence call priced at 1.03 and an
accumulator of strong picks never cleared 1.10. Model confidence is not market
probability; that gap *is* the edge, and collapsing it erased the only number a
slip exists to show. Picks now carry a real price from `odds_snapshots`
(migration `20260815120000_pick_odds.sql`). Same call now reads 1.83.

## ~~1b. Original gap description (kept for context)~~

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

## ~~3 + 4. Manual prediction management & result entry~~ — DONE

Two Office actions, both audited:

- **`setFixtureResult`** — enter a score; it settles the fixture and re-grades
  every pending pick on it **through the same `gradePrediction()` the cron
  uses**, so a manual correction can never diverge from automatic grading.
  Stamps `manual_override` and the operator's identity.
- **`overridePrediction`** — force won/lost/void. Requires a reason of at least
  3 characters (server-enforced) and records it with the actor. An override with
  no audit trail is worse than no override, because nobody can judge it later.

Verified: entry settled a fixture and graded its pick to `won` with
`override=true`; a 1-character reason was rejected; a real one recorded
`void | Fixture abandoned at 70 minutes — <actor>`.

Also added **Fetch stats** as a pipeline stage button.

## ~~3b. Original gap description (kept for context)~~

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

## ~~9. Fixture stats refresh~~ — DONE

`runFetchStats()` + `/api/cron/fetch-stats`, scheduled at 05:00 UTC — between
the fixture pull and the engine run, so stats are in place before picks
generate. Crucially the daily-picks prompt now *includes* them: form, H2H
record, and both sides' season scoring/conceding/clean-sheet/BTTS rates per
fixture, with an explicit instruction to lower confidence where stats are
missing rather than guess.

The live implementation deliberately **throws** rather than returning empty —
silently handing the engine no stats while claiming it reasoned over data is
worse than a loud failure. Needs wiring to `/fixtures/headtohead` and
`/teams/statistics`.

## ~~9b. Original gap description (kept for context)~~

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

1. ~~Bet slip builder~~ — done.
2. ~~Fixture stats fetching~~ — done.
3. ~~Manual result entry + prediction override~~ — done.
4. **Catalog CRUD**, starting with `setSelectedLeagues` — NEXT.
5. Age gate (compliance).
6. Config lifecycle, pass grant/revoke, personal stats, league performance.
