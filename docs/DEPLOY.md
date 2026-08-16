# Deploying MoonOdds

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

Get the anon and service-role keys from
`Project Settings → API` in the Supabase dashboard.

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

**`db push` does not run `seed.sql`.** Seeds are local-only, which is correct:
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
update app.settings set value = 'https://YOUR-DOMAIN' where key = 'app_base_url';
update app.settings set value = 'YOUR-CRON-SECRET'    where key = 'cron_secret';

-- Confirm. Neither of these may still say host.docker.internal or local-dev.
select key, value from app.settings;
```

`cron_secret` must equal the `CRON_SECRET` set in Vercel. The routes check it
with `assertCronRequest`.

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
https://YOUR-DOMAIN/api/webhooks/paystack
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

```bash
# Headers are set by next.config.ts, not by Vercel config.
curl -sI https://YOUR-DOMAIN | grep -iE "content-security|strict-transport|x-frame"

# Should be 401, not 200. If it is 200, CRON_SECRET is not set.
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://YOUR-DOMAIN/api/cron/daily-picks

# Should be 401. If it is 500, PAYSTACK_SECRET_KEY is missing.
curl -s -o /dev/null -w "%{http_code}\n" -X POST https://YOUR-DOMAIN/api/webhooks/paystack -d '{}'
```

Then in the SQL editor:

```sql
-- Every job should have run recently and none should be stuck failing.
select jobname, schedule, active from cron.job;
select kind, status, attempts, last_error from jobs order by created_at desc limit 20;
```

---

## 5. Still required before taking real money

- `MOCK_PROVIDERS` must be `false`, and `liveFootball.fetchStats` must be
  implemented. It currently throws by design, so a live run fails loudly rather
  than feeding the engine nothing.
- `DEV_BYPASS_AUTH` must be absent or `false`. It is ignored in production
  builds regardless, but leaving it set is a confusing signal.
- Terms and Privacy still carry a "not reviewed by a lawyer" banner. See the
  audit: they name no legal entity, governing law or dispute resolution.

---

## Rollback

Supabase keeps automatic backups on paid plans; confirm the retention window
for this project before the first real customer, because that window is the
real recovery boundary and nobody knows what it is yet.

There is no down-migration in this repo. A bad migration is rolled back by
restoring a backup, which means the answer to "how far back can we go" needs to
be known in advance rather than discovered during an incident.

Application rollback is a Vercel redeploy of the previous commit, which is
independent of the database and safe as long as no migration ran in between.
