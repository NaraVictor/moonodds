# Polls

Every scheduled job and every client refetch in the app: what it does, when it
runs, and what it costs. Thirteen server jobs, four client intervals.

The API-Football plan is **7,500 calls/day** and **300/minute**. One poll
accounts for roughly 97% of that; everything else is rounding. Read the
[Budget](#budget) section before changing any interval.

---

## The daily chain

Four jobs, once each, and **the order is load-bearing**.

| Job | Time (UTC) | Objective | Football API |
|---|---|---|---|
| `kicka_fetch_fixtures` | 00:30 | Pull the day's fixtures for the selected leagues; upsert leagues, teams and fixtures | ~11–22 · one per league, twice where the first season guess misses |
| `kicka_fetch_stats` | 05:00 | Form, head-to-head, season averages and the last-season fallback — the feed the engine reasons over | ~80–120 · ≈4 per fixture, capped at `maxFixturesPerSession` |
| `kicka_fetch_injuries` | 05:30 | Reported absences and suspensions | ~4–6 · one per league+date |
| `kicka_daily_picks` | 06:00 | Run the engine over the board and publish | 0 football · **1 Anthropic**, ~150s |

**Why these times.** Stats at 05:00 centres their 36-hour window on the day
being predicted. Injuries at 05:30 is the entire reason `STEP 6, PERSONNEL` can
fire at all: line-ups publish ~40 minutes before kickoff, twelve hours after the
engine has already run, which is why line-ups feed the reader and injuries feed
the model. Moving `daily_picks` earlier than 06:00 means predicting on data
that has not arrived.

---

## Live polls

Both scale with the number of matches, so both are guarded.

| Job | Interval | Objective | Guard |
|---|---|---|---|
| `kicka_poll_live` | **10 seconds** | Scores, match clock and status; grade the moment a match ends | No fixture in window → **zero upstream calls**. Every fixture in the window batches into one request. Window closes 4h after kickoff |
| `kicka_fetch_lineups` | 5 minutes | Team sheets for the detail page | Only fixtures ≤75 min from kickoff, and a fixture already holding a sheet is **never asked again** |

`poll_live` costs ~1,950 calls on a weekday and ~4,650 on a Saturday.
`fetch_lineups` costs **≤20 per day in total**, not per run — a published XI does
not change, so each fixture is asked about once ever.

Line-ups deliberately do **not** reach the engine. They arrive after the
prediction, so `lineups` stays in the `never` list in `batchAbsentFeeds`.

---

## Settlement and money

| Job | Interval | Objective | Football API |
|---|---|---|---|
| `kicka_auto_grade` | :15, every 2h | Backstop sweep for fixtures still unfinished **4h+** after kickoff — the ones the live poller gave up on | ≤12/day, usually 0 |
| `kicka_clv_check` | :45, every 2h | Flag lines that moved against us past the CLV threshold | 0 — reads stored `odds_snapshots` |
| `kicka_reconcile_payments` | 15 minutes | Settle payments pending >10 min — the net under the Paystack webhook | 0 football · one Paystack verify per stranded row |
| `kicka_weekly_recalibration` | Mon 03:00 | Propose ranking-weight changes from settled results | 0 |

---

## Housekeeping

These call `app.*()` directly instead of `app.call_endpoint()`, so they never
leave the database. A broken `app_base_url` cannot stop them — which is exactly
what happened to the other eleven when the apex domain started redirecting.

| Job | Interval | Objective |
|---|---|---|
| `kicka_drain_jobs` | 1 minute | Drain the outbox: receipts, daily-picks alerts, high-confidence notifications |
| `kicka_reap_stalled` | 10 minutes | Return jobs stuck `running` >10 min to the queue |
| `kicka_sweep_expired` | 30 minutes | Delete expired OTP tokens and rate-limit rows older than 1h |

---

## Client refetch

| Hook | Interval | Condition |
|---|---|---|
| `useTodaysPicks` | 10s | Only while a pick's fixture is `live`, and only when the board is showing "all" |
| `usePicksByStatus` | 10s | Same, and only when the board is **not** showing "all" |
| `usePredictionDetail` | 10s | Only while that fixture is `live` |
| `useJobQueue` (Office) | 15s | Always, while the tab is open |

The first three read the rows they already hold and return an interval only if
something in them is live, so polling stops by itself when the last match ends
rather than running all night. `refetchIntervalInBackground` is left off, so a
hidden tab costs nothing.

---

## No record is polled twice

Every overlap has been made disjoint deliberately. If you change a window,
check it against this list.

| Pair | How they are kept apart |
|---|---|
| `poll_live` ↔ `auto_grade` | The poller owns a fixture for `LIVE_WINDOW_MS` (4h) after kickoff; the sweep takes only fixtures **older** than that. Both derive their cutoff from the same constant, so the boundary cannot drift |
| `fetch_stats` ↔ `fetch_injuries` | Both upsert `fixture_stats`, but disjoint **columns** — stats never writes the absence columns and injuries never writes the stats columns. PostgREST only SETs the columns in the payload, so neither clobbers the other |
| `fetch_fixtures` ↔ `poll_live` | Both write fixture status, score and clock. The scheduled 00:30 run touches nothing that has kicked off; a manual Office run writes **all** of those columns from one response, so it can never leave a fresh score against a stale clock |
| `useTodaysPicks` ↔ `usePicksByStatus` | Exactly one is `enabled` at a time, chosen by whether the board is showing "all" |
| Webhook ↔ `reconcile_payments` ↔ checkout PATCH | **Deliberately** redundant, not disjoint. All three call `settlePayment`, whichever arrives first wins and the rest are no-ops, because the activation RPCs are idempotent. This is the one place duplication is the design |

---

## Budget

| | Weekday | Saturday |
|---|---|---|
| `poll_live` | 1,950 | 4,650 |
| Everything else | ~150 | ~150 |
| **Total, of 7,500** | **28%** | **64%** |

Peak per-minute usage is 6 against a ceiling of 300.

**Why 10 seconds and not 5.** Measured against the worst realistic day — a
Saturday card with kickoffs from 11:30 to 22:00, window open about twelve and a
half hours:

| Interval | Calls/min | Worst day | % of plan |
|---|---|---|---|
| 15s | 4 | 3,150 | 42% |
| **10s** | **6** | **4,650** | **62%** |
| 5s | 12 | 9,150 | **122% — over budget** |

Five seconds does not fail at deploy time. It fails by being refused part-way
through a Saturday evening, which is the worst moment available.

**Known drift:** `api_budget.reservedForResults` is 3,600, and Saturday's poller
alone is ~4,650. Harmless today — `runFetchStats` reads that figure only to size
the stats pull, and has roughly a thousand fixtures of room against a cap of 20
— but the number no longer describes reality.

---

## Health

`GET /api/health` asserts the exact job count (`EXPECTED_CRON_JOBS`). **Bump it
when you add a job here**, or a partial migration that drops one will report
healthy.

It also reports the role the count was taken as. `cron.job` carries row-level
security keyed on `username = current_user`, and `get_deploy_settings` is
`SECURITY DEFINER` — so a function owned by the wrong role reports zero jobs on
a database with a perfectly good schedule. A zero from a role that can see the
table means the schedule is empty; a zero from one that cannot means the check
is broken.
