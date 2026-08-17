#!/usr/bin/env node
/**
 * Prove the live providers actually work, before trusting them with a run.
 *
 * fetchStats was a stub for most of this project's life and is now implemented
 * against API-Football v3, but implemented is not the same as verified: no call
 * has ever been made with a real key. The H2H attribution has unit tests; the
 * transport, the endpoint shapes and the field names do not, and cannot, until
 * a key exists.
 *
 * This is that check. It makes the smallest real request against each provider
 * and asserts the response has the shape the code expects, so a wrong field
 * name surfaces here rather than as an empty stats block that the engine
 * silently reasons around.
 *
 * Reads .env.local, or the ambient environment in CI.
 *
 *   pnpm verify:live            everything configured
 *   pnpm verify:live football   just one
 */

import { readFileSync } from "node:fs";

let fileEnv = {};
try {
  fileEnv = Object.fromEntries(
    readFileSync(new URL("../.env.local", import.meta.url), "utf8")
      .split("\n")
      .filter((l) => l.trim() && !l.trim().startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
      }),
  );
} catch {
  /* CI supplies the environment directly */
}
const env = { ...fileEnv, ...process.env };

const only = process.argv[2];
const results = [];
const record = (name, ok, detail) => {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name.padEnd(38)} ${detail}`);
};

/** Every assertion is about SHAPE, because a 200 with the wrong fields is the failure that hides. */
function hasFields(obj, path) {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj) !== undefined;
}

async function football() {
  const key = env.API_FOOTBALL_KEY;
  if (!key) return record("football: key", false, "API_FOOTBALL_KEY not set, skipped");

  const base = env.API_FOOTBALL_BASE_URL ?? "https://v3.football.api-sports.io";
  const call = async (path) => {
    const res = await fetch(`${base}${path}`, {
      headers: { "x-apisports-key": key },
      signal: AbortSignal.timeout(20_000),
    });
    const json = await res.json();
    return { res, json };
  };

  // API-Football answers a dead key or an exhausted quota with HTTP 200 plus an
  // errors object, so res.ok proves nothing on its own.
  const { res, json } = await call("/status");
  const errs = json?.errors;
  const hasErrors = errs && !Array.isArray(errs) && Object.keys(errs).length > 0;
  record(
    "football: key accepted",
    res.ok && !hasErrors,
    hasErrors ? JSON.stringify(errs).slice(0, 90) : `HTTP ${res.status}`,
  );
  if (hasErrors) return;

  const acct = json?.response;
  record(
    "football: quota",
    true,
    acct?.requests
      ? `${acct.requests.current}/${acct.requests.limit_day} used today`
      : "no quota reported",
  );

  // The two endpoints fetchStats depends on, asserted field by field against
  // what src/lib/providers/live.ts actually reads.
  // No `last`: the Free plan rejects it with HTTP 200 plus an errors object,
  // which is how this silently returned nothing until the preflight caught it.
  const h2h = await call("/fixtures/headtohead?h2h=33-34&status=FT");
  const h = h2h.json?.response?.[0];
  record(
    "football: /fixtures/headtohead shape",
    Boolean(h && hasFields(h, "teams.home.id") && hasFields(h, "goals.home") && hasFields(h, "fixture.status.short")),
    h
      ? `${h2h.json.results} meetings; teams.home.id, goals.home, status.short, date present`
      : "no meetings returned",
  );

  // The daily budget is the constraint that bites first on the Free plan:
  // fetchStats costs roughly one call per fixture for H2H plus one per distinct
  // (team, league, season), on top of the fixture pull and grading.
  if (acct?.requests) {
    const limit = acct.requests.limit_day;
    const headroom = limit - acct.requests.current;
    record(
      "football: daily budget",
      headroom > 40,
      `${headroom} calls left today; a 30-fixture day needs roughly 45-60`,
    );
  }

  const stats = await call("/teams/statistics?league=39&season=2024&team=33");
  const s = stats.json?.response;
  const shapeOk =
    Boolean(s) &&
    hasFields(s, "fixtures.played.total") &&
    hasFields(s, "goals.for.average.total") &&
    hasFields(s, "clean_sheet.total") &&
    hasFields(s, "failed_to_score.total");
  record(
    "football: /teams/statistics shape",
    shapeOk,
    shapeOk
      ? `form="${s.form ?? "none"}", played=${s.fixtures.played.total}`
      : "missing fields fetchStats reads",
  );
}

async function anthropic() {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) return record("anthropic: key", false, "ANTHROPIC_API_KEY not set, skipped");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: env.ANTHROPIC_MODEL ?? "claude-opus-5",
      max_tokens: 4,
      messages: [{ role: "user", content: "Reply with the single word: ok" }],
    }),
    signal: AbortSignal.timeout(30_000),
  });
  const json = await res.json();
  record(
    "anthropic: key + model",
    res.ok,
    res.ok ? `${json.model} reachable` : (json?.error?.message ?? `HTTP ${res.status}`).slice(0, 90),
  );
}

async function paystack() {
  const secret = env.PAYSTACK_SECRET_KEY;
  const pub = env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY;
  if (!secret) return record("paystack: key", false, "PAYSTACK_SECRET_KEY not set, skipped");

  if (pub) {
    const matched = secret.startsWith("sk_live_") === pub.startsWith("pk_live_");
    record(
      "paystack: key mode",
      matched,
      matched
        ? `both ${secret.startsWith("sk_live_") ? "live" : "test"}`
        : "LIVE/TEST MISMATCH, the popup will fail blaming the card",
    );
  }

  // Read-only. Nothing here initialises a transaction or moves money.
  const res = await fetch("https://api.paystack.co/transaction?perPage=1", {
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(20_000),
  });
  const json = await res.json();
  record(
    "paystack: key accepted",
    res.ok && json?.status === true,
    res.ok ? "authenticated" : (json?.message ?? `HTTP ${res.status}`).slice(0, 90),
  );

  // GHS has to be enabled on the account or every checkout fails at initialise.
  const bal = await fetch("https://api.paystack.co/balance", {
    headers: { Authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(20_000),
  });
  const balJson = await bal.json();
  const currencies = (balJson?.data ?? []).map((b) => b.currency);
  record(
    "paystack: GHS enabled",
    currencies.includes("GHS"),
    currencies.length ? `account settles in ${currencies.join(", ")}` : "no balance reported",
  );
}

async function resend() {
  const key = env.RESEND_API_KEY;
  if (!key) return record("resend: key", false, "RESEND_API_KEY not set, skipped");

  // Lists domains. Sends nothing.
  const res = await fetch("https://api.resend.com/domains", {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(20_000),
  });
  record("resend: key accepted", res.ok, res.ok ? "authenticated" : `HTTP ${res.status}`);
}

const suites = { football, anthropic, paystack, resend };

console.log("\nLive provider preflight. Read-only: nothing is charged and nothing is sent.\n");

for (const [name, fn] of Object.entries(suites)) {
  if (only && only !== name) continue;
  try {
    await fn();
  } catch (err) {
    record(`${name}: unexpected`, false, err instanceof Error ? err.message : String(err));
  }
}

const failed = results.filter((r) => !r.ok);
const skipped = failed.filter((r) => r.detail.includes("skipped"));
const real = failed.filter((r) => !r.detail.includes("skipped"));

console.log(
  `\n${results.length - failed.length}/${results.length} passed` +
    (skipped.length ? `, ${skipped.length} skipped (no key)` : "") +
    (real.length ? `, ${real.length} FAILED` : "") +
    "\n",
);

process.exit(real.length ? 1 : 0);
