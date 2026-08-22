# Feature parity vs. the original Convex app

Kicka is the product; the Convex + Hercules build it replaces is referred to
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
indexed but **nothing had ever written to it**, it was designed as a cache for
the recalibration job, and reading a cache nobody fills would show every league
at zero.

The recalibration job now writes it, via `log_league_performance`. The profile
figures stay live, deliberately: what the table adds is the *time series*, the
thing you cannot reconstruct once picks age out of the window. Its
`efficiency_flag` is derived from CLV rather than win rate, because beating the
closing line measures edge and winning measures luck plus edge. On the seed that
distinction is visible immediately: the Premier League runs a 90% strike rate at
+0.0009 CLV and reads `standard`, not `high_edge`.

### 12. Theme switching

Light / dark / system, per device. The dark palette had been in `globals.css`
since the Kicka reskin and unreachable the whole time, because `layout.tsx`
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

**Closed since this list was written:**

- `liveFootball.fetchStats` is implemented against `/fixtures/headtohead` and
  `/teams/statistics`, and every field it reads is asserted by
  `pnpm verify:live`.
- `MOCK_PROVIDERS` is gone, along with the mock provider layer. Fixtures,
  stats, AI and payments have one implementation each and it is the real one.
  See the plan blocker in `STATUS.md` before expecting output.
- Terms section 10 names the operator: **Keypad Systems**.

**Still open:**

- Terms section 10 still has four blanks: registration number, registered
  address, governing law, and courts. These are facts, not decisions anyone
  can infer, and a governing-law clause guessed at is worse than one absent.
- **No cookie-consent banner, and Google Analytics sets cookies.** The policy
  now discloses the analytics, says what each one collects, and points to the
  browser-level opt-out, which is honest but is not consent. Under the UK/EU
  GDPR and Ghana's Data Protection Act, non-essential cookies are supposed to
  be opt-in *before* they are set, and the tag currently fires on first paint.
  Vercel Web Analytics is the easier half: it sets no cookies and builds no
  profile, so it is defensible without a banner. Google Analytics is the part
  that needs either a consent gate or Google Consent Mode. Flagged rather than
  built, because a banner is a product decision about the first thing every
  visitor sees.
- The privacy policy never names a data controller. It did not before the
  rename either, but now that the operating entity is known, it is a blank that
  can be filled rather than one that could not.
- **Feeds with no provider at any plan tier.** Weather (wind, altitude, heat,
  cold, humidity, precipitation), referee card and foul history, travel
  distance and pitch surface. API-Football does not serve these, so the
  overlays in Steps 5 and 5B stay gated regardless of what the plan costs.
  They are not bugs and they need no prompt change; they need a second
  provider, or they stay off.
- **Feeds a paid plan would unlock.** Standings (Step 1C quality-adjusted form,
  and motivation in Step 8), injuries and lineups (Step 6 personnel), and odds
  with a prior quote (Step 1A market movement). All three exist as endpoints
  and are refused on the current plan for the current season. The affordable
  shape for each is a per-league call rather than a per-fixture one, one call
  per league per day against a per-fixture cost of thirty.

## Turned on: the gated steps that were already paid for

Three gated steps were dark for want of data the pipeline was **already
fetching and throwing away**. None of them cost an extra API call, which is
what made them worth doing first on a hundred-call day.

- **Step 1E, weighted and venue head-to-head.** `/fixtures/headtohead` returns
  every meeting individually. We reduced the list to five aggregates before
  anything saw it, and the prompt says plainly that "aggregate totals are not a
  meeting list". The meetings are now kept, and the brief prints each one
  normalised to the coming fixture's home side: score home-side-first whoever
  actually hosted, with a flag for which ground it was played on. Printing them
  as the API reports them would hand the engine the same attribution problem
  `tallyH2H` exists to solve, on half the rows, with no error if it gets it
  wrong.
- **Step 1D, split and venue form.** `/teams/statistics` reports every counter
  home, away and total. We read `.total` and dropped the halves.
- **Step 5, rest.** Congestion comes from our own `fixtures` table, not the
  API: the Free plan refuses the `last` parameter, and this is a question about
  dates the daily fetch already records. It sees only leagues we track, so a
  midweek cup tie is invisible and a congested side can read as rested. The
  brief says "league matches only" for that reason. Understating congestion
  skips the penalty rather than inventing one, which is the safe direction to
  be wrong in.

Two consequences worth recording, because both are silent:

- The three rest thresholds lost their `optionalOverlay` tag. That flag drives
  the Office's "inert for want of a feed" note, and a tag left on after the
  data arrives tells an operator a working control is dead, which is the same
  lie as the tag being missing, pointed the other way.
- The mock provider carried the new inputs too, with meeting lists whose
  results added up to the aggregates printed beside them. That provider has
  since been deleted along with the rest of the sample data, so the skip path
  is now exercised only where it is real: a fixture whose feed genuinely
  returned nothing.

## Settled: licensing

**Selling paid match analysis needs no gambling registration here.** The owner's
position, recorded 17 August 2026: this is consulting and education, not
bookmaking. The product takes no stakes, holds no customer funds, pays no
winnings and settles no wagers, which the Terms already state in section 1.

Written down because it kept resurfacing as an open audit finding. It is a
decision, not an oversight; reopen it only if the product starts doing one of
the four things above.
