/**
 * Paywall verification.
 *
 * The single highest-consequence risk in this migration is that `predictions`
 * becomes reachable through PostgREST, at which point any signed-in user can
 * read every locked pick from the browser console and the paywall is
 * decoration. This script proves that it isn't, against the running database,
 * as a real client, using the same publishable key the browser gets.
 *
 * Run: pnpm verify:security
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

/**
 * Apply the test fixture before asserting anything.
 *
 * These checks are assertions about ACCESS, and access cannot be tested
 * against an empty database: "a locked-out user gets 0 picks but a true total"
 * needs picks to be locked out of. The data used to arrive via seed.sql, which
 * `supabase start` ran automatically, so the suite silently depended on the
 * application shipping dummy data. Seeding is off now, so the suite loads its
 * own fixture and that dependency is explicit.
 *
 * Deliberately targets the LOCAL stack, with no --linked flag anywhere near
 * it. This creates accounts with a known password and marks one super-admin;
 * pointing it at a deployed database would be the worst thing in this
 * repository, so it is not reachable by passing a different flag.
 */
function applyFixture() {
  if (!/(localhost|127\.0\.0\.1)/.test(URL_ ?? "")) {
    console.error(
      `\nRefusing to run: NEXT_PUBLIC_SUPABASE_URL is "${URL_}", which is not local.\n` +
        `This suite loads a fixture that creates accounts and marks one super-admin.\n`,
    );
    process.exit(1);
  }

  const path = fileURLToPath(new URL("../supabase/tests/security-fixture.sql", import.meta.url));
  try {
    execFileSync("supabase", ["db", "query", "--file", path], { stdio: "pipe" });
  } catch (err) {
    const detail = [err?.stdout?.toString(), err?.stderr?.toString(), err?.message]
      .filter(Boolean)
      .join(" ")
      .slice(0, 400);
    console.error(`\nCould not apply supabase/tests/security-fixture.sql:\n${detail}\n`);
    process.exit(1);
  }
}

const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;

// Kept only so the check below can try it and be refused.
const PASSWORD = "kicka";
const ACCOUNTS = {
  passHolder: "pass@kicka.test",
  firstDay: "new@kicka.test",
  lockedOut: "locked@kicka.test",
  suspended: "suspended@kicka.test",
  admin: "admin@kicka.test",
};

let failures = 0;
const results = [];

function check(name, passed, detail) {
  results.push({ name, passed, detail });
  if (!passed) failures++;
}

function anonClient() {
  return createClient(URL_, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * A session for a fixture account, without a password.
 *
 * This used to call signInWithPassword, which was the last thing in the
 * codebase that needed the password grant to exist. Now that no real account
 * has a password and the grant is off, the suite mints its own session the way
 * an operator would: the admin API issues a one-time link, and the anon client
 * redeems the token from it.
 *
 * Nothing about what is being tested changes. These checks are assertions
 * about what a session may READ, and a session is a session however it was
 * obtained; the sign-in path itself is exercised separately, below.
 */
async function signedIn(email) {
  const admin = createClient(URL_, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
  });
  if (error) throw new Error(`could not mint a link for ${email}: ${error.message}`);

  const tokenHash = data?.properties?.hashed_token;
  if (!tokenHash) throw new Error(`no token in the link for ${email}`);

  const c = anonClient();
  const { error: verifyErr } = await c.auth.verifyOtp({
    token_hash: tokenHash,
    type: "magiclink",
  });
  if (verifyErr) throw new Error(`sign-in failed for ${email}: ${verifyErr.message}`);

  return c;
}

const dayWindow = () => {
  const now = new Date();
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start_ts: start.toISOString(), end_ts: end.toISOString() };
};

async function main() {
  console.log(`\nVerifying against ${URL_}\n`);

  applyFixture();

  // --- 1. Direct table access must be impossible for everyone ---------------
  {
    const anon = anonClient();
    const { data, error } = await anon.from("predictions").select("*").limit(5);
    check(
      "anon cannot SELECT predictions directly",
      !!error || !data?.length,
      error ? `blocked: ${error.code ?? error.message}` : `LEAKED ${data.length} rows`,
    );
  }

  {
    const c = await signedIn(ACCOUNTS.lockedOut);
    const { data, error } = await c.from("predictions").select("*").limit(5);
    check(
      "signed-in non-payer cannot SELECT predictions directly",
      !!error || !data?.length,
      error ? `blocked: ${error.code ?? error.message}` : `LEAKED ${data.length} rows`,
    );

    // The reasoning is the product; make sure it can't be reached column-wise.
    const { data: cols, error: colErr } = await c
      .from("predictions")
      .select("frontier_explanation")
      .limit(1);
    check(
      "signed-in non-payer cannot read pick reasoning column",
      !!colErr || !cols?.length,
      colErr ? `blocked: ${colErr.code ?? colErr.message}` : "LEAKED reasoning",
    );
  }

  // --- 2. The gated RPC returns the right slice per tier --------------------
  const w = dayWindow();

  /**
   * The board is public now, so "how many rows came back" stopped being the
   * security question, every viewer gets a row per fixture. What matters is
   * how many of them carry the thing we sell.
   *
   * An unlocked pick is one that exposes ANY AI output. Checking for the
   * absence of each field individually (rather than trusting the `locked`
   * flag) means a future edit that starts emitting, say, confidence on a
   * locked payload fails this suite instead of shipping.
   */
  const AI_FIELDS = [
    "predictionType",
    "predictedValue",
    "confidenceScore",
    "reasoning",
    "stakingUnit",
    "odds",
    "altPredictedValue",
    "filtersApplied",
  ];
  const exposesAi = (p) => AI_FIELDS.some((f) => p?.[f] !== undefined);
  /** Unsettled picks only: a settled call is a public track record by design. */
  const unlockedUnsettled = (data) =>
    (data?.picks ?? []).filter(
      (p) => !["won", "lost"].includes(p?.status) && exposesAi(p),
    ).length;

  {
    const c = await signedIn(ACCOUNTS.lockedOut);
    const { data } = await c.rpc("get_todays_picks", w);
    check(
      "no-pass user gets exactly the 2 free picks, and a true total",
      unlockedUnsettled(data) === 2 && data?.totalCount > 2,
      `unlocked=${unlockedUnsettled(data)} rows=${data?.picks?.length} total=${data?.totalCount} fullAccess=${data?.hasFullAccess}`,
    );
  }

  {
    const c = await signedIn(ACCOUNTS.firstDay);
    const { data } = await c.rpc("get_todays_picks", w);
    check(
      "first-day user gets exactly 2 free picks unlocked",
      unlockedUnsettled(data) === 2 && data?.isFirstDay === true,
      `unlocked=${unlockedUnsettled(data)} rows=${data?.picks?.length} isFirstDay=${data?.isFirstDay} total=${data?.totalCount}`,
    );
  }

  {
    const c = await signedIn(ACCOUNTS.passHolder);
    const { data } = await c.rpc("get_todays_picks", w);
    const locked = (data?.picks ?? []).filter((p) => p?.locked).length;
    check(
      "pass holder gets every pick unlocked",
      data?.hasFullAccess === true &&
        locked === 0 &&
        data?.picks?.length === data?.totalCount,
      `rows=${data?.picks?.length} locked=${locked} total=${data?.totalCount}`,
    );
  }

  {
    // This account holds a valid, paid, active pass, and must still see nothing.
    const c = await signedIn(ACCOUNTS.suspended);
    const { data } = await c.rpc("get_todays_picks", w);
    check(
      "suspended user is blocked despite holding an active pass",
      unlockedUnsettled(data) === 0 && data?.hasFullAccess === false,
      `unlocked=${unlockedUnsettled(data)} rows=${data?.picks?.length} fullAccess=${data?.hasFullAccess}`,
    );
  }

  {
    const anon = anonClient();
    const { data } = await anon.rpc("get_todays_picks", w);
    check(
      "guest gets exactly 2 free picks, drawn from the top of the board",
      unlockedUnsettled(data) === 2 && data?.picks?.length > 2,
      `unlocked=${unlockedUnsettled(data)} rows=${data?.picks?.length} total=${data?.totalCount}`,
    );
  }

  {
    // The locked projection must carry the public football facts, otherwise
    // the board is a wall of blank cards and the whole change was pointless.
    const anon = anonClient();
    const { data } = await anon.rpc("get_picks_by_status", { filter: "upcoming" });
    const p = (data?.picks ?? []).find((x) => x?.locked);
    check(
      "locked picks still carry teams, league and kickoff",
      !!p?.homeTeam?.name && !!p?.awayTeam?.name && !!p?.league?.name && !!p?.fixture?.date,
      p
        ? `${p.homeTeam?.name} v ${p.awayTeam?.name} · ${p.league?.name}`
        : "no locked pick found",
    );

    // The market is half the call: knowing we picked the handicap rather than
    // the 1x2 already tells you where we think the mispricing is.
    const marketLeaks = (data?.picks ?? []).filter(
      (x) => x?.locked && x?.predictionType !== undefined,
    ).length;
    check(
      "locked picks do NOT reveal which market we called",
      marketLeaks === 0,
      `leaks=${marketLeaks} of ${(data?.picks ?? []).filter((x) => x?.locked).length} locked`,
    );
  }

  // --- 3. Settled results are public (the landing page needs them) ----------
  {
    const anon = anonClient();
    const { data } = await anon.rpc("get_recent_results", { max_rows: 50 });
    const allSettled = Array.isArray(data) && data.every((p) => p.status === "won" || p.status === "lost");
    check(
      "guest can read settled results, and only settled ones",
      Array.isArray(data) && data.length > 0 && allSettled,
      `rows=${data?.length} allSettled=${allSettled}`,
    );
  }

  // --- 4. Privilege escalation ---------------------------------------------
  {
    const c = await signedIn(ACCOUNTS.lockedOut);
    const { data: me } = await c.auth.getUser();
    const { error } = await c
      .from("profiles")
      .update({ is_super_admin: true })
      .eq("id", me.user.id);

    const { data: after } = await c
      .from("profiles")
      .select("is_super_admin")
      .eq("id", me.user.id)
      .single();

    check(
      "user cannot promote themselves to super-admin",
      after?.is_super_admin !== true,
      error ? `blocked: ${error.message}` : `is_super_admin=${after?.is_super_admin}`,
    );
  }

  {
    const c = await signedIn(ACCOUNTS.suspended);
    const { data: me } = await c.auth.getUser();
    await c.from("profiles").update({ is_suspended: false }).eq("id", me.user.id);
    const { data: after } = await c
      .from("profiles")
      .select("is_suspended")
      .eq("id", me.user.id)
      .single();
    check(
      "suspended user cannot lift their own suspension",
      after?.is_suspended === true,
      `is_suspended=${after?.is_suspended}`,
    );
  }

  // --- 5. Admin-only tables ------------------------------------------------
  {
    const c = await signedIn(ACCOUNTS.lockedOut);
    const { data } = await c.from("ai_engine_config").select("system_prompt").limit(1);
    check(
      "non-admin cannot read the engine system prompt",
      !data?.length,
      `rows=${data?.length ?? 0}`,
    );
  }

  {
    const c = await signedIn(ACCOUNTS.admin);
    const { data } = await c.from("ai_engine_config").select("system_prompt").limit(1);
    check(
      "admin CAN read the engine system prompt",
      !!data?.length,
      `rows=${data?.length ?? 0}`,
    );
  }

  // --- 6. Cross-user data --------------------------------------------------
  {
    const c = await signedIn(ACCOUNTS.lockedOut);
    const { data } = await c.from("daily_passes").select("*");
    check(
      "user cannot see another user's passes",
      (data?.length ?? 0) === 0,
      `rows=${data?.length ?? 0}`,
    );
  }

  {
    const c = await signedIn(ACCOUNTS.passHolder);
    const { data } = await c.from("payments").select("*");
    const ownOnly = data?.every((p) => p.user_id === "11111111-1111-4111-8111-111111111111");
    check(
      "user sees only their own payments",
      (data?.length ?? 0) > 0 && ownOnly,
      `rows=${data?.length ?? 0} ownOnly=${ownOnly}`,
    );
  }

  // --- report ---------------------------------------------------------------

  // --- 6b. The password grant must be dead -------------------------------
  {
    /*
     * The product removed every password field, which is not the same thing as
     * the grant being unusable: Supabase will still accept signInWithPassword
     * for any account that has a hash. Real accounts never set one and the
     * fixture accounts have had theirs nulled, so this proves the difference
     * between "we stopped offering passwords" and "passwords do not work".
     */
    const c = anonClient();
    const { data, error } = await c.auth.signInWithPassword({
      email: ACCOUNTS.admin,
      password: PASSWORD,
    });
    check(
      "the admin account cannot be reached with its old password",
      Boolean(error) && !data?.session,
      error ? `refused: ${error.message}` : "SIGNED IN — the password grant is live",
    );
  }

  // --- 7. Office admin surface -------------------------------------------
  const APP = "http://localhost:3100";

  /*
   * These two probe HTTP guards that used to be switchable off by
   * DEV_BYPASS_AUTH, so they were skipped whenever it was set. The bypass is
   * gone, the guards are unconditional, and there is no longer any state in
   * which these are expected to fail. They always run.
   */
  {
    {
      const res = await fetch(`${APP}/api/office`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "generatePicks" }),
        signal: AbortSignal.timeout(8000),
      }).catch(() => null);
      check(
        "unauthenticated cannot trigger Office actions",
        res ? res.status === 401 || res.status === 403 : false,
        res ? `HTTP ${res.status}` : "app unreachable",
      );
    }

    {
      const res = await fetch(`${APP}/api/cron/daily-picks`, {
        method: "POST",
        headers: { Authorization: "Bearer wrong-secret" },
        signal: AbortSignal.timeout(8000),
      }).catch(() => null);
      check(
        "cron endpoints reject a bad bearer secret",
        res ? res.status === 401 : false,
        res ? `HTTP ${res.status}` : "app unreachable",
      );
    }
  }

  {
    const c = await signedIn(ACCOUNTS.lockedOut);
    const { data } = await c.from("jobs").select("*").limit(1);
    check("non-admin cannot read the job queue", (data?.length ?? 0) === 0, `rows=${data?.length ?? 0}`);
  }

  {
    const c = await signedIn(ACCOUNTS.lockedOut);
    const { error } = await c.rpc("claim_jobs", { batch_size: 5 });
    check(
      "non-admin cannot claim jobs from the queue",
      !!error,
      error ? `blocked: ${error.code ?? error.message}` : "LEAKED",
    );
  }

  {
    const c = await signedIn(ACCOUNTS.lockedOut);
    const { error } = await c.rpc("activate_daily_pass", {
      p_user_id: "33333333-3333-4333-8333-333333333333",
      p_reference: "pass-seed-0001",
    });
    check(
      "user cannot self-activate a pass via RPC",
      !!error,
      error ? `blocked: ${error.code ?? error.message}` : "LEAKED, free pass",
    );
  }


  // --- 8. The landing preview is gone -----------------------------------
  {
    /*
     * It was granted to anon and called by nothing in the application — a
     * public endpoint handing out a full pick and a count of the day's board,
     * kept alive by this test and nothing else. It also had no tier filter, so
     * its counts would have included the paid basket.
     *
     * Asserting it is ABSENT rather than deleting the check: a dropped
     * function is easy to recreate by restoring an old migration, and this is
     * what would catch that.
     */
    const anon = anonClient();
    const { error } = await anon.rpc("get_landing_preview");
    check(
      "get_landing_preview no longer exists",
      !!error,
      error ? `gone: ${error.code ?? error.message}` : "STILL CALLABLE by anon",
    );
  }

  {
    // The preview must not become a back door to the full board.
    const anon = anonClient();
    const w = dayWindow();
    const { data } = await anon.rpc("get_todays_picks", w);
    const leaked = (data?.picks ?? []).filter(
      (p) =>
        !["won", "lost"].includes(p?.status) &&
        (p?.predictedValue !== undefined ||
          p?.confidenceScore !== undefined ||
          p?.reasoning !== undefined),
    ).length;
    check(
      "guest gets no MORE than the 2 free picks from get_todays_picks",
      leaked === 2,
      `unlocked=${leaked} rows=${data?.picks?.length}`,
    );
  }

  const pad = Math.max(...results.map((r) => r.name.length));
  for (const r of results) {
    const tag = r.skipped ? "  SKIP" : r.passed ? "  PASS" : "  FAIL";
    console.log(`${tag}  ${r.name.padEnd(pad)}  ${r.detail}`);
  }

  const skipped = results.filter((r) => r.skipped).length;
  const ran = results.length - skipped;
  console.log(
    `\n${ran - failures}/${ran} checks passed` +
      (skipped ? ` (${skipped} skipped)` : "") +
      "\n",
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
