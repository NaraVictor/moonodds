# Deploying Kicka

Supabase project ref: `sktaghkuppcqzsltuffu`
Project URL: `https://sktaghkuppcqzsltuffu.supabase.co`

The project ref is not a secret. It appears in every request the browser makes.
Everything in "Secrets" below is, and none of it belongs in this repository or
in a chat window.

---

## Secrets, and where each one goes

| Secret | Where it goes | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Vercel + `.env.local` | Public. `https://sktaghkuppcqzsltuffu.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Vercel + `.env.local` | Public by design, RLS is what protects the data |
| `SUPABASE_SERVICE_ROLE_KEY` | Vercel **only** | Bypasses RLS entirely. Never `NEXT_PUBLIC_`, never client-side |
| `PAYSTACK_SECRET_KEY` | Vercel **only** | Also verifies the webhook signature |
| `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` | Vercel + `.env.local` | Public |
| `ANTHROPIC_API_KEY` | Vercel **only** | |
| `API_FOOTBALL_KEY` | Vercel **only** | |
| `RESEND_API_KEY` | Vercel **only** | |
| `CRON_SECRET` | Vercel **and** `app.settings` | Must match in both places or every cron job 401s |
| `SENTRY_DSN` | Vercel + `.env.local` | Server-side only. Never `NEXT_PUBLIC_`: nothing in the browser reports errors here, so exposing it only invites someone else's events into your project |

Get the anon and service-role keys from
`Project Settings → API` in the Supabase dashboard.

### Which Supabase keys to use

Use the **new** keys, `sb_publishable_...` and `sb_secret_...`, not the legacy
`anon` / `service_role` JWTs. Both work today and both are correctly refused by
RLS on `predictions`, verified against the running database. The legacy pair is
on Supabase's deprecation path, so there is no reason to adopt it now.

One confusion worth knowing about: the environment variable **names** are still
the legacy ones (`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`)
while the **values** are the new publishable and secret keys. That is fine, the
client only cares about the value, and renaming them would be churn across every
deployment target for no behavioural gain. It is called out here because the
mismatch reads like a mistake.

The publishable key is safe in the browser. The secret key bypasses RLS
entirely and must never be `NEXT_PUBLIC_` or reach client code.

**Local keys rotate.** `supabase start` can regenerate the local pair, which
makes a previously working `.env.local` fail with "Invalid API key" and
`pnpm verify:security` fall over at sign-in. Resync with:

```bash
supabase status -o env
```

---

## 1. Link and push the schema

The CLI needs your credentials, not mine. Run this yourself:

```bash
supabase login
```

That opens a browser and stores a token locally. Then:

```bash
supabase link --project-ref sktaghkuppcqzsltuffu
```

Before pushing anything, see what would be applied:

```bash
supabase db diff --linked
```

Then push:

```bash
supabase db push
```

**`db push` does not run seeds, and there is no longer a seed to run.** The
sample data was deleted and seeding is off in `config.toml`, so a fresh
database comes up empty. The engine configuration that used to arrive via the
seed is now `20260821092000_engine_config.sql`, a migration, which is what
`db push` applies. That distinction was a live bug: the deployed database had
the full schema and no engine config, so every daily-picks run would have
skipped even with a working API plan. Historical note, seeds were local-only:
the demo accounts and fixture data must never reach production.

### If the project is not empty

`db push` applies migrations the remote has not recorded. If the remote already
carries an older version of this schema applied outside the CLI, its migration
history will not match and the push will either fail or apply migrations on top
of objects that already exist. Check first:

```bash
supabase migration list --linked
```

Two migrations touch existing rows rather than only creating objects, and are
the ones to read before running them against real data:

- `20260816140000_slip_settlement.sql` backfills `slip_legs` and `slips` so
  legs that settled before the trigger existed are brought into step.
- `20260816160000_player_protection.sql` adds columns to `profiles` and
  replaces `app.access_state`.

---

## 2. Point the database at the deployed app

**This is the step that is easy to miss and silent when missed.** `app.settings`
ships with local defaults, so until it is updated every scheduled job POSTs to
`http://host.docker.internal:3100` with the development secret. Nothing errors
visibly: fixtures are never fetched, picks are never generated, and results are
never graded.

Run this in the SQL editor against the linked project, with the real values:

```sql
update app.settings set value = 'https://kicka.app' where key = 'app_base_url';
update app.settings set value = 'YOUR-CRON-SECRET'    where key = 'cron_secret';

-- Confirm. Neither of these may still say host.docker.internal or local-dev.
select key, value from app.settings;
```

`cron_secret` must equal the `CRON_SECRET` set in Vercel. The routes check it
with `assertCronRequest`.

---

## 2a. The rename, and what it touches in a live database

The product was MoonOdds; it is Kicka, at `kicka.app`. Most of that is display
text, but three things are not:

- **The scheduled jobs were renamed** `moonodds_*` to `kicka_*`, including the
  unschedule loop that makes the cron migration re-runnable. On a database that
  had already applied the old migration, that loop no longer matches the old
  jobs, so they survive and the new ones schedule beside them: every endpoint
  fires twice a day. `20260821091000_rename_cron_jobs.sql` removes the old
  prefix. Confirm after migrating, seven jobs and no duplicates:

  ```sql
  select jobname, active from cron.job order by jobname;
  ```

- **`get_deploy_settings()` counts jobs by prefix**, so the health check reports
  zero scheduled jobs until that migration has run.

- **Storage keys and demo logins moved.** Saved theme, board view and bet slips
  live under `kicka.*` in localStorage, so a returning browser starts fresh.
  Seed accounts are now `@kicka.test` with password `kicka`.

The Supabase project itself is still **named** "moonodds" in the dashboard.
That is cosmetic: the project ref `sktaghkuppcqzsltuffu` is what every
connection string uses, and renaming the project does not change it.

---

## 2b. Before you expect any picks: check the API-Football plan

**A correct deploy on the current plan still produces nothing.** The key in use
is on the **Free** plan, which serves seasons **2022–2024 only**. The pipeline
asks for the current season, and API-Football answers HTTP 200 with an empty
response and a `plan` error, so `fetch-fixtures` finds no fixtures, the engine
has nothing to analyse, and the day ends with "no upcoming fixtures today".

Nothing about that reads as a misconfiguration. Check it before blaming the
deploy:

```bash
pnpm verify:live football
```

`football: current season served` is the decisive line. If it FAILs, the plan is
the problem and no amount of deploy fixing will produce a pick. A paid tier is
what lifts it; the daily call budget in `ai_engine_config.api_budget` should be
raised at the same time, since it is currently sized for 100 calls a day.

---

## 3. Paystack

Both keys go in Vercel and nowhere else. `pnpm verify:secrets` runs in CI and
fails the build if either reaches a tracked file; it scans new files as well as
committed ones, so a key cannot slip in ahead of its first commit.

If a secret key is ever pasted into a chat, an issue, a screenshot or a log,
treat it as compromised and rotate it. A Paystack secret key can charge cards
and issue refunds on the account, so exposure is not theoretical.

Set the webhook URL in the Paystack dashboard
(`Settings → API Keys & Webhooks`):

```
https://kicka.app/api/webhooks/paystack
```

The handler verifies `x-paystack-signature` as HMAC SHA-512 of the raw body
keyed on `PAYSTACK_SECRET_KEY`, so it refuses everything until that key is set
in Vercel. It is the authoritative path for granting access: the browser's
return trip is only the fast path, and `/api/cron/reconcile-payments` sweeps
anything both of them miss every fifteen minutes.

Test it from the Paystack dashboard's webhook tester, then confirm:

```sql
select reference, status, settled_at from payments order by created_at desc limit 5;
```

---

## 4. Verify the deploy

**Start here.** One request answers whether the deploy is actually wired up,
including the two things that fail silently:

```bash
curl -s https://kicka.app/api/health | jq
```

`200` means ready. `503` lists exactly what is not, by name. It reports whether
values are configured and whether they still look like the local defaults,
never the values themselves, so it is safe to leave public and safe to point an
uptime monitor at.

Then the individual checks:

```bash
# Headers are set by next.config.ts, not by Vercel config.
curl -sI https://kicka.app | grep -iE "content-security|strict-transport|x-frame"

# Should be 401, not 200. If it is 200, CRON_SECRET is not set.
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://kicka.app/api/cron/daily-picks

# Should be 401. If it is 500, PAYSTACK_SECRET_KEY is missing.
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://kicka.app/api/webhooks/paystack -d '{}'
```

Then in the SQL editor:

```sql
-- Every job should have run recently and none should be stuck failing.
select jobname, schedule, active from cron.job;
select kind, status, attempts, last_error from jobs order by created_at desc limit 20;
```

---

## 4b. Check the live providers

```bash
pnpm verify:live            # everything configured
pnpm verify:live football   # one provider
```

Read-only throughout: it authenticates, reads shapes and reports quota. Nothing
is charged and no mail is sent.

It asserts the **shape** of each response, not just a 200, because the failure
that hides is a successful call whose fields have moved. It has already caught
two:

- **API-Football's Free plan rejects the `last` parameter**, answering HTTP 200
  with an errors object. Head-to-head silently returned nothing. Now uses
  `status=FT` and takes the ten most recent client-side.
- **The Free plan allows 100 calls a day.** A 30-fixture day needs roughly
  45-60 for stats alone, before the fixture pull and grading. That is the limit
  that will bite first, and `verify:live` reports the headroom.

---

## 5. Still required before taking real money

- `MOCK_PROVIDERS` no longer exists. There is one set of providers and they are
  all live, so every key below is required rather than optional.
  `liveFootball.fetchStats` is implemented and
  verified against the live API with `pnpm verify:live football`.
- `DEV_BYPASS_AUTH` no longer exists. The auth bypass, the role switcher and
  the bypass banner were removed outright, so the guards are unconditional in
  every environment rather than merely hard-off in production.
- Terms section 10 still has blank company details: legal entity, registration
  number, registered address, governing law and courts. Fill these before
  taking money from the public; they are what make the contract enforceable.

---

## Backup, restore and rollback

### What has to survive

Three things are the business, in this order:

1. **`predictions` and `fixtures`.** The settled record is the entire argument
   for the product. It cannot be regenerated, because the engine's output for a
   past day depends on data the feed no longer serves.
2. **`ai_engine_config`.** The live prompt and its weights.
3. **`payments`, `daily_passes`, `extra_pick_orders`.** Financial records, with
   retention obligations of their own.

Everything else, leagues, teams, stats, jobs, is refetchable or transient.

### Establish the retention window before the first customer

Supabase's automatic backups and their retention depend on the plan. Check it
and write the answer here:

```
Plan:              ____________
Backup frequency:  ____________
Retention:         ____________   ← this is the real recovery boundary
PITR available:    yes / no
```

Blank means nobody knows, and the first time that matters is the worst possible
time to find out.

### A weekly copy you control

Platform backups are the first line, not the only one. This costs nothing and
takes seconds:

```bash
supabase db dump --linked -f "kicka-$(date +%F).sql"          # schema
supabase db dump --linked --data-only -f "kicka-$(date +%F)-data.sql"
```

Keep them somewhere that is not the same account as the database. A backup that
dies with the provider is not a backup.

### Restoring

Rehearse this once, on a throwaway project, before needing it:

```bash
supabase db reset --linked      # DESTRUCTIVE. re-applies migrations only
psql "$DB_URL" -f kicka-YYYY-MM-DD-data.sql
```

### Rolling back a bad migration

There are no down-migrations in this repo, which is a deliberate trade: a
reverse script that has never been run is a false sense of safety. Recovery is
restore-from-backup, and that is why the retention window above matters.

The safer path is forward. Write a new migration that corrects the last one and
push it, which keeps the history honest about what actually happened.

### Rolling back the app

A Vercel redeploy of the previous commit. Independent of the database and safe
as long as no migration ran in between, which is the reason to deploy schema
changes and app changes as separate steps rather than together.
