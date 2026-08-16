# Feature parity vs. the original Convex app

MoonOdds is the product; the Convex + Hercules build it replaces is referred to
here as "the original". Cross-referenced against that codebase, 120 Convex
functions and 30 page components, compared by **capability** rather than by function name (the
port renamed nearly everything, so a name diff produced ~100 false positives and
was discarded).

**Every gap identified in that audit is now closed.** This file is kept as the
record of what was missing and how each was resolved, because several were
resolved differently from the original and the reasoning matters more than the
checklist.

---

## Closed

### 1. Bet slip builder

FAB, sheet, add/remove from the card, localStorage persistence, combined odds,
saved through a transactional RPC.

**An odds bug surfaced while building it.** The first version derived a leg
price as 1/confidence, so a 97%-confidence call priced at 1.03 and an
accumulator of strong picks never cleared 1.10. Model confidence is not market
probability; that gap *is* the edge, and collapsing it erased the only number a
slip exists to show. Legs now carry a real price from `odds_snapshots`.

### 2. Office catalog CRUD

Leagues and teams are creatable, editable and importable; `setSelectedLeagues`
decides which leagues the daily fetch covers and was previously editable only by
writing SQL.

Two things worth knowing: `apiFootball` now checks the `errors` body, because
API-Football answers a dead key or an exhausted quota with **HTTP 200** plus an
errors object, trusting `res.ok` turns "your key is dead" into "no leagues
matched". And team deletion is guarded rather than cascaded: `fixtures`
references `teams` with no ON DELETE rule, so the action counts fixtures first
and explains itself instead of surfacing a raw foreign-key violation.

### 3 + 4. Manual result entry and prediction override

Both audited. A manual score re-grades every pending pick on the fixture
**through the same `gradePrediction()` the cron uses**, so a correction can never
diverge from automatic grading. Overrides require a reason and record the actor.

### 5. Engine config lifecycle

Draft, promote, archive, roll back. A draft is a full copy of the live config,
so experimenting costs nothing and the incumbent keeps running until someone
deliberately promotes its replacement.

Promotion demotes the incumbent first, the partial unique index won't hold two
active rows. A failure between the two statements leaves nothing active, which
the daily job treats as "no config" and skips: the safe direction to fail in.

`version` is a semver-shaped TEXT column. Bumping it arithmetically yields NaN;
it increments the patch segment, and the version list orders by recency rather
than by that string, which would put 1.4.10 below 1.4.9.

### 6. Admin pass grant/revoke and user management

Search, comp or revoke a pass, edit a profile, delete an account.

Comped passes carry no `payment_id` and a zero amount, that column is what ties
a pass to money, and a gift has none, so comps don't inflate revenue reporting.
Deleting refuses on an admin account: locking every operator out of the Office
should not be one click away when the recovery is a database console.

### 7. Slip management

Delete a slip; drop a leg.

Combined odds are recomputed from the remaining legs rather than divided out of
the stored figure, repeated division on a rounded numeric drifts, and a slip
whose odds disagree with its own legs is worse than one you cannot edit.

A leg can only be dropped while the whole slip is unsettled. Once anything has a
result the slip is a record of what you actually followed, and removing the
losing leg would turn your own history into fiction. Deleting it outright stays
allowed: discarding a record is honest in a way that editing one is not.

### 8. Personal stats and Office reports

Profile shows your own record (win rate, ROI, slips, average confidence) and
engine accuracy by league. The Office reports on engine accuracy over a window
with a per-league breakdown, and on what users are following.

ROI states its assumption in the interface, one flat unit per slip, because we
never see what anyone actually staked, and inventing a variable stake would make
the number look precise while meaning less.

### 9. Fixture stats refresh

`runFetchStats()` + a cron at 05:00 UTC, between the fixture pull and the engine
run. The daily-picks prompt now includes form, H2H and season splits, with an
explicit instruction to lower confidence where stats are missing rather than
guess.

The live implementation deliberately **throws** rather than returning empty,
silently handing the engine no stats while claiming it reasoned over data is
worse than a loud failure. See "Still to wire" below.

### 10. Age gate

Blocking 18+ interstitial, per-device, with a decline path. It matters more here
than in the original: the marketing page used to stand between a visitor and the
predictions, and now nothing does.

### 11. League performance

Computed live from settled predictions. `league_performance_log` exists and is
indexed but **nothing has ever written to it**, it was designed as a cache for
the recalibration job, and reading a cache nobody fills would show every league
at zero. This can become a read of that table once the job populates it.

### 12. Theme switching

Light / dark / system, per device. The dark palette had been in `globals.css`
since the MoonOdds reskin and unreachable the whole time, because `layout.tsx`
hard-coded `data-theme="light"`. A blocking inline script applies the choice
before first paint, so there is no white flash on navigation.

### 13. 404 route

Routes onward rather than apologising, nearly everything that 404s here is a
stale prediction link.

---

## Where this deliberately diverges from the original

- **The board is public.** `/` is the market for everyone; the marketing page is
  gone. Guests get two free picks, drawn from the day's top three, and every
  settled call is public permanently. The market is locked along with the
  prediction, knowing we called the handicap rather than the 1x2 already gives
  away where we think the mispricing is.
- **Line-ups are a designed empty slot, not a fetch.** API-Football publishes
  them ~20–40 minutes before kickoff, so a section that explains that beats one
  that silently renders nothing.
- **Crests come from API-Football's CDN**, derived from `external_id`, real
  artwork with no key, no quota and no network call in the pipeline.

---

## Engine prompt v2.1 → v2.2

The supplied v2.1 prompt was adopted with corrections. What changed and why:

**Config resolution moved out of the model.** v2.1's Step 0 asked the engine to
walk a 130-key table, prefer injected values, fall back to documented defaults
and report which fell back, in its head, every run, before any analysis. That
is deterministic work with a wrong answer available, so code does it now.

**The [CORE]/[OPTIONAL] split was redrawn.** v2.1's best idea, applied to the
wrong set. It tagged personnel, standings, odds movement, travel and rest as
[CORE], "always runs; backed by data your feed reliably provides", and this
feed provides none of them. Marking a step mandatory and pointing it at absent
data is exactly the fabrication pressure the prompt exists to prevent. Those are
now [GATED], each naming its required input, with the inference loopholes closed
explicitly ("a referee name is not a history"; "venue name alone tells you
nothing about distance, congestion or surface").

**Absent data no longer manufactures confidence.** The sharpest hidden bug: the
tier-1 anchoring ceiling required "no market-opposed flag", and with no odds in
the payload that flag is false, which read as a *clean* fixture and helped clear
the 9.0 ceiling. Conditions resting on absent data now count as unmet.

**Contradictions resolved.** Step 3 said "skip the fixture entirely" while two
other sections demanded an object for every fixture; no-bet fixtures are now
emitted with a flag, because a missing index is indistinguishable from a
truncated response. Step 9A's consistency check was 1x2-shaped while Step 8 was
deliberately market-neutral, it is now direction-by-market-family, and
non-directional tags are excluded from the count rather than read as agreement.
`anchorDefaultRangeMax` 6.9 overlapped the tier-3 cap of 6.5 and became 6.4. The
buffers and `globalPenaltyCapPct` were prose constants and are now variables.

**Ungradeable picks blocked.** `corners_over_under` was in the output enum and
named as a preferred low-variance pivot, but corner results are never settled
here, the humidity pivot defaulted to corners too. Corners are now
alternative-only, and the humidity pivot expresses the same directional call on
under 2.5.

Weight redistribution replaced zero-scoring for absent components: a missing
signal is not a negative signal, and treating it as one is what made thin-data
fixtures collapse.

## Still to wire

Not gaps against the original, things this port has stubbed deliberately.

- `liveFootball.fetchStats` throws by design. Needs implementing against
  `/fixtures/headtohead` and `/teams/statistics` before a live run.
- The app runs on `MOCK_PROVIDERS`. Fixtures, stats, AI and payments are all
  canned; only the crest URLs are real.
- Terms and Privacy carry a visible "needs a lawyer" banner. The copy describes
  the product accurately but has not been reviewed.
