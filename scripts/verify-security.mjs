/**
 * Paywall verification.
 *
 * The single highest-consequence risk in this migration is that `predictions`
 * becomes reachable through PostgREST, at which point any signed-in user can
 * read every locked pick from the browser console and the paywall is
 * decoration. This script proves that it isn't — against the running database,
 * as a real client, using the same publishable key the browser gets.
 *
 * Run: pnpm verify:security
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.trim() && !l.trim().startsWith("#"))
    .map((l) => {
      const i = l.indexOf("=");
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);

const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const PASSWORD = "moonodds";
const ACCOUNTS = {
  passHolder: "pass@moonodds.test",
  firstDay: "new@moonodds.test",
  lockedOut: "locked@moonodds.test",
  suspended: "suspended@moonodds.test",
  admin: "admin@moonodds.test",
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

async function signedIn(email) {
  const c = anonClient();
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
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

  {
    const c = await signedIn(ACCOUNTS.lockedOut);
    const { data } = await c.rpc("get_todays_picks", w);
    check(
      "locked-out user gets 0 picks but a true total",
      data?.picks?.length === 0 && data?.totalCount > 0,
      `picks=${data?.picks?.length} total=${data?.totalCount} fullAccess=${data?.hasFullAccess}`,
    );
  }

  {
    const c = await signedIn(ACCOUNTS.firstDay);
    const { data } = await c.rpc("get_todays_picks", w);
    check(
      "first-day user gets exactly 2 free picks",
      data?.picks?.length === 2 && data?.isFirstDay === true,
      `picks=${data?.picks?.length} isFirstDay=${data?.isFirstDay} total=${data?.totalCount}`,
    );
  }

  {
    const c = await signedIn(ACCOUNTS.passHolder);
    const { data } = await c.rpc("get_todays_picks", w);
    check(
      "pass holder gets every pick",
      data?.hasFullAccess === true && data?.picks?.length === data?.totalCount,
      `picks=${data?.picks?.length} total=${data?.totalCount}`,
    );
  }

  {
    // This account holds a valid, paid, active pass — and must still see nothing.
    const c = await signedIn(ACCOUNTS.suspended);
    const { data } = await c.rpc("get_todays_picks", w);
    check(
      "suspended user is blocked despite holding an active pass",
      data?.picks?.length === 0 && data?.hasFullAccess === false,
      `picks=${data?.picks?.length} fullAccess=${data?.hasFullAccess}`,
    );
  }

  {
    const anon = anonClient();
    const { data } = await anon.rpc("get_todays_picks", w);
    check(
      "guest gets 0 picks",
      data?.picks?.length === 0,
      `picks=${data?.picks?.length} total=${data?.totalCount}`,
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

  // --- 7. Office admin surface -------------------------------------------
  const APP = "http://localhost:3100";

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
      error ? `blocked: ${error.code ?? error.message}` : "LEAKED — free pass",
    );
  }

  const pad = Math.max(...results.map((r) => r.name.length));
  for (const r of results) {
    console.log(
      `${r.passed ? "  PASS" : "  FAIL"}  ${r.name.padEnd(pad)}  ${r.detail}`,
    );
  }

  console.log(
    `\n${results.length - failures}/${results.length} checks passed\n`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
