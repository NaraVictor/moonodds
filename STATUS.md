# MoonOdds: build status

MoonOdds, migrated from the original Convex + Hercules build to Next.js 16 +
Supabase + HeroUI v3, with dummy data and mocked providers.

Run `pnpm dev` (port 3100) with local Supabase up (`npx supabase start`).

---

## Done and verified

### Platform
- Next.js 16.3.1 App Router, React 19.2.8, TypeScript strict, `tsc --noEmit` clean.
- HeroUI **v3.2.4**. Worth knowing: v3 is a ground-up rewrite, no provider,
  compound components (`Card.Header`), React Aria underneath, and it requires
  Tailwind v4, which your stack already had. API extracted from the installed
  package into `docs/heroui-v3-reference.md` rather than guessed at.
- Palette sampled from adipredictstreet.com by reading computed styles across
  all 3,226 elements: ground `#010820`, surface `#0D142B`, teal `#00D4BF`
  (win), red `#F2404C` (loss), blue `#658BFF`, orange `#FF710A`, CTA gradient
  `#013CFF → #FF710A`. Applied through HeroUI's semantic variables, so
  components are themed rather than overridden.
- Type: Archivo (display), Manrope (body), JetBrains Mono (figures).

### Database: all 18 Convex tables ported
`supabase/migrations/`:
- `..._schema.sql`, tables, enums, FKs, deliberate indexes. Convex forced an
  index per query; Postgres doesn't, so these were chosen against real access
  patterns.
- `..._rls.sql`, RLS, policies, gated RPCs.
- `..._triggers_and_jobs.sql`, auth→profile trigger, jobs outbox with
  `FOR UPDATE SKIP LOCKED`, exponential-backoff retries, dead-lettering.
- `..._cron.sql`, pg_cron + pg_net replacing convex/crons.ts.

Two schema additions beyond a straight port:
- **`payments`**: binds a Paystack reference to its buyer at initialise time.
  The Convex `verifyPass` never checked that a reference belonged to the caller.
- **`jobs`**: durable replacement for `ctx.scheduler.runAfter`, which had no
  retries or audit trail.

### Security: 20/20 checks pass (`pnpm verify:security`)
`predictions` is granted to **no client role**. Picks come only from
SECURITY DEFINER RPCs that reproduce `getAccessState`. Verified against the
running database as a real client:

```
anon cannot SELECT predictions directly                   blocked: 42501
signed-in non-payer cannot SELECT predictions directly    blocked: 42501
signed-in non-payer cannot read pick reasoning column     blocked: 42501
locked-out user gets 0 picks but a true total             picks=0 total=12
first-day user gets exactly 2 free picks                  picks=2
pass holder gets every pick                               picks=12 total=12
suspended user is blocked despite holding an active pass  picks=0
guest gets 0 picks                                        picks=0
guest can read settled results, and only settled ones     rows=50
user cannot promote themselves to super-admin             blocked
suspended user cannot lift their own suspension           is_suspended=true
non-admin cannot read the engine system prompt            rows=0
admin CAN read the engine system prompt                   rows=1
user cannot see another user's passes                     rows=0
user sees only their own payments                         ownOnly=true
unauthenticated cannot trigger Office actions             HTTP 401
cron endpoints reject a bad bearer secret                 HTTP 401
non-admin cannot read the job queue                       rows=0
non-admin cannot claim jobs from the queue                blocked: 42501
user cannot self-activate a pass via RPC                  blocked: 42501
```

`is_super_admin` lives in `profiles`, never `user_metadata` (which is
user-writable and would hand anyone the Office panel). A trigger freezes the
privilege columns against self-promotion.

### Seed
60 settled picks over 30 days (~63% strike), 3 live fixtures, 14 for today
across all twelve markets, 10 awaiting the pipeline, full engine config with
real weights, a pending tuning report, passes/orders/slips, and five demo
accounts, one per access tier, password `moonodds`.

### App surfaces
- Guest landing, hero, live stats, pricing, track record gated after 10 rows.
  **Server-rendered, so it's crawlable** (the Vite version wasn't).
- Authenticated picks home, stat tiles, status/league/market filters, pick
  grid, paywall, extra-picks section.
- Pick detail modal with reasoning, tags, triggered filters, alt market.
- Sign in / sign up with server actions.
- Dev-only role switcher for jumping between access tiers.

### Verified end to end
- `pnpm build`, production build clean, 14 routes.
- `pnpm verify:security`, 20/20.
- Cron chain: pg_cron → pg_net → route handler, with bearer-secret rejection.
- Jobs outbox: enqueue → claim → run → complete.

### Environment
`.env.example` maps every Hercules-era variable to its replacement with notes.
`.env.local` is populated for local Supabase.

---

### Backend: done
Provider abstraction (`src/lib/providers/`) with mock and live implementations
behind one `MOCK_PROVIDERS` switch. Six cron routes, all exercised end to end:

```
fetch-fixtures   {"ok":true,"leagues":6,"fixtures":8,"upserted":8}
clv-check        {"ok":true,"reviewed":40,"flagged":19}
drain-jobs       {"ok":true,"claimed":1,"done":1,"failed":0}
```

Anthropic port drops the gateway prefix, removes `temperature` (rejected on
current models), and replaces the JSON-coaxing retry loop with structured
outputs. Grading was fixed rather than ported verbatim, see below.

### Office admin panel: done
All 7 tabs: pipeline (run any stage, live job queue), predictions (paginated
through the same gated RPC), grade (with a "needs review" queue), catalog,
AI engine (weights with sum validation, system prompt editor), reports
(approve/reject with server-side application), users (suspend/reinstate).
Guarded server-side before any admin UI reaches the browser.

### Remaining surfaces: done
- `/slips`, saved slips with per-leg outcomes and a running record.
- `/profile`, access tier, channel toggles, alert toggles, phone.
- `/checkout/day-pass` and `/checkout/extra-picks`, full init → pay → verify
  flow. Extra-picks prices on games actually available, not leagues requested.
- OTP gating on system-prompt edits, restored from the original. Verified:
  wrong code rejected, correct code applies, **replay of a used code rejected**
  (burned before the write, so it can't be reused).

---

## Auth bypass for testing

`DEV_BYPASS_AUTH=true` + `NEXT_PUBLIC_DEV_BYPASS_AUTH=true` are set in
`.env.local`. Every route is walkable without signing in.

**To restore the guards:** set both to `false` and restart. Nothing else changes
the guards were never deleted, only short-circuited at one call site each
(`src/lib/dev-bypass.ts`).

Three things keep this safe:

1. **Hard-off in production.** Verified against a real `pnpm start` with the
   flag still set: `/office` → 307 to sign-in, every API route → 401, banner
   absent. Not configurable.
2. **It never touches the database.** RLS, the gated picks RPC and the
   privilege-guard trigger all still apply. Running `pnpm verify:security` with
   the bypass on gives **18/20**, and the only two failures are exactly the two
   HTTP route-guard checks the bypass disables. All 18 data-layer checks still
   pass. Turn it off and it's 20/20 again.
3. **A red banner sits on every page** while it's active.

### Engine prompt: v2.2, templated

The system prompt is a **template**. Every threshold appears as `{{key}}` and is
substituted from `ai_engine_config` before the prompt is sent, using the table in
`src/lib/engine/variables.ts`, 105 variables, each with a unit and a default.

This replaced an arrangement where the prompt carried its own prose defaults
while the config supplied *differently named keys on a different scale*
(`tier1Penalty: 20` percent vs `keymanTier1Penalty: 0.12` fraction). Nothing
reconciled them, so the engine ran on prose defaults and the Office weight
editor changed nothing. The seeded config now resolves **103 of 103**
placeholders with zero fallbacks.

Three guardrails, because the failure mode here is silence:

- An unresolved placeholder **throws** at render time. Shipping a literal
  `{{tier1Penalty}}` to the model is the worst available outcome, the run
  succeeds and one threshold quietly meant nothing.
- `validateEngineVariables` flags a percent written as a fraction. A
  `redCardCarryoverPenalty` of `0.05` is arithmetically valid and functionally
  absent; verified that the Office surfaces it.
- Selections are normalised against what `gradePrediction` parses. A model
  emitting `"Home"` instead of `"1"` produced a pick that graded
  `review_needed` forever, never won, never lost.

Prompt lives in `src/lib/engine/prompt.ts` and is injected into `seed.sql` by
`pnpm engine:sync`; `pnpm engine:check` fails if the two drift.

Corrections to the prompt itself are recorded in `GAPS.md`.

### Deploying

Supabase project `sktaghkuppcqzsltuffu`. The runbook is `docs/DEPLOY.md`, and
the step that matters most is the one that is silent when missed: `app.settings`
ships with `host.docker.internal:3100` and the dev cron secret, so until it is
updated on the remote every scheduled job posts into the void and no picks are
ever generated.

## Not done

Nothing outstanding from the original scope.

## Known issues

- **ROI reads ~118%**, which is not believable. The formula is ported verbatim
  from the Convex `getEngineStats` (`(wins × 1.8 − losses) / staked`), which
  assumes flat 1.8 odds on every winner. Inherited, not introduced, worth
  replacing with real odds from `odds_snapshots`.
- **Most of the prompt's machinery has no inputs.** Personnel, standings,
  odds movement, travel, rest, venue H2H and per-meeting H2H are all written and
  gated, but `RawFixtureStats` carries only form, aggregate H2H and season
  averages, so they correctly skip on every fixture. Wiring the feeds is what
  turns them on; nothing in the prompt needs to change.
- **Grading was corrected, not ported verbatim.** The Convex original returned
  `false` for markets it couldn't evaluate, so corners and half-goals picks were
  written as LOSSES despite the code comments saying they should be flagged for
  review; draw-no-bet draws were also graded as losses instead of voiding. Here
  half-time markets grade properly (we store the HT score), draw-no-bet and
  handicap push both void, and genuinely ungradeable markets return
  `review_needed` and surface in the Office. This is a deliberate deviation from
  a straight port, flagging it because it changes settled outcomes.
