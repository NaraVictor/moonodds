import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Eleven: fetch-fixtures, fetch-stats, daily-picks, auto-grade, poll-live,
 * clv-check, weekly-recalibration, reconcile-payments, drain-jobs,
 * reap-stalled, and sweep-expired. Asserted as an exact count rather than
 * "more than zero", because the failure this catches is a rename or a partial
 * migration leaving a subset behind. Bump it when a job is added.
 */
const EXPECTED_CRON_JOBS = 11;

/**
 * Deployment readiness, as something you can actually look at.
 *
 * The worst class of bug in this project has been the silent one: a scheduled
 * job posting to a hostname that does not exist in production, a pass activated
 * only if the browser came back, a percent stored as a fraction. Every one of
 * them looked fine from the outside.
 *
 * This is the opposite of that. It answers "is this deployment actually wired
 * up" in one request, and it is deliberately blunt about the things that fail
 * quietly. GET /api/health after every deploy.
 *
 * Public, and safe to be: it reports whether values are configured and whether
 * they still look like the local defaults, never the values themselves.
 *
 * Two things that follow from being public and were missing. It is rate limited
 * like every other unauthenticated route — it is the only one here that does
 * four database round trips per call, which makes it the cheapest amplifier in
 * the app. And database errors are reported as a fixed string rather than
 * passed through: a Postgres message names tables, columns and sometimes the
 * value that failed, and "never the values themselves" has to include the ones
 * that arrive inside an error. The detail still reaches the server log.
 */

/** Anything a caller must not be told, said once. */
const DB_ERROR = "query failed, see server logs";

type Check = {
  name: string;
  ok: boolean;
  severity: "blocking" | "warning" | "info";
  detail: string;
};

export async function GET(request: Request) {
  const limited = await enforceRateLimit(request, {
    scope: "health",
    limit: 30,
    windowSeconds: 60,
    message: "Too many health checks.",
  });
  if (limited) return limited;

  const checks: Check[] = [];
  const isProd = process.env.NODE_ENV === "production";

  const add = (
    name: string,
    ok: boolean,
    severity: Check["severity"],
    detail: string,
  ) => checks.push({ name, ok, severity, detail });

  /* ---------------------------- environment ---------------------------- */

  const need = [
    "NEXT_PUBLIC_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
    "CRON_SECRET",
  ];
  for (const key of need) {
    add(`env:${key}`, Boolean(process.env[key]), "blocking", process.env[key] ? "set" : "missing");
  }

  // There is one set of providers and it is live. The MOCK_PROVIDERS switch
  // that used to gate this was deleted, and the check kept reading it, so it
  // passed unconditionally and reported "live providers" whatever was true.
  {
    for (const key of ["PAYSTACK_SECRET_KEY", "API_FOOTBALL_KEY", "ANTHROPIC_API_KEY"]) {
      add(`env:${key}`, Boolean(process.env[key]), "blocking", process.env[key] ? "set" : "missing");
    }
    // A live secret with a test public key initialises fine and then fails at
    // the popup blaming the customer's card, so the pair is checked together.
    const sec = process.env.PAYSTACK_SECRET_KEY ?? "";
    const pub = process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY ?? "";
    if (sec && pub) {
      const matched = sec.startsWith("sk_live_") === pub.startsWith("pk_live_");
      add(
        "paystack:key-mode",
        matched,
        "blocking",
        matched ? "secret and public keys are the same mode" : "LIVE/TEST MISMATCH",
      );
    }
  }

  /* ------------------------------ database ------------------------------ */

  try {
    const db = createServiceClient();

    // THE one that is silent when missed. app.settings ships with local
    // defaults, so until it is updated every scheduled job posts into nothing:
    // no fixtures, no picks, no grading, and no error anywhere.
    const { data: settings } = await db.rpc("get_deploy_settings");
    const s = (settings ?? {}) as {
      appBaseUrl?: string;
      cronSecretIsLocal?: boolean;
      cronJobsScheduled?: number;
      cronJobsActive?: number;
    };

    const baseLooksLocal =
      !s.appBaseUrl ||
      s.appBaseUrl.includes("host.docker.internal") ||
      s.appBaseUrl.includes("localhost") ||
      s.appBaseUrl.includes("127.0.0.1");

    add(
      "db:app_base_url",
      !isProd || !baseLooksLocal,
      "blocking",
      baseLooksLocal
        ? "still points at a local address, so EVERY cron job is posting into the void"
        : "points at a deployed host",
    );

    /*
     * Does app_base_url point at the host actually serving this request?
     *
     * "Points at a deployed host" was not a high enough bar. app_base_url was
     * https://kicka.app while the site is served from https://www.kicka.app,
     * and the apex issues a 308 to the www host. PG_NET DOES NOT FOLLOW
     * REDIRECTS — it records the 308 and stops — so every scheduled job fired
     * on time, reached a redirect, and did nothing. No error, no log, no failed
     * request anywhere: the check above passed, the URL was plainly a deployed
     * host, and the whole pipeline was inert.
     *
     * The health route is the one place that knows both halves: the configured
     * URL, and the host it is being served from right now. If they disagree,
     * every cron call is landing somewhere other than here.
     *
     * Compared on host only. Scheme is fixed by upgrade-insecure-requests and a
     * path is not part of a base URL, so a mismatch that matters is a mismatch
     * of host — apex versus www, or a stale preview domain.
     */
    const servedHost =
      request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? "";
    let configuredHost = "";
    try {
      configuredHost = s.appBaseUrl ? new URL(s.appBaseUrl).host : "";
    } catch {
      configuredHost = "";
    }

    if (isProd && servedHost && configuredHost) {
      add(
        "db:base_url_matches_host",
        configuredHost === servedHost,
        "blocking",
        configuredHost === servedHost
          ? `cron posts to ${configuredHost}, which is this host`
          : `cron posts to ${configuredHost} but this app is served from ${servedHost}. ` +
            `If that is a redirect, pg_net does not follow it and every scheduled job silently does nothing. ` +
            `Set app_base_url to https://${servedHost} (or check this endpoint on the canonical host).`,
      );
    }

    add(
      "db:cron_secret",
      !isProd || !s.cronSecretIsLocal,
      "blocking",
      s.cronSecretIsLocal
        ? "still the development secret, so every cron job would 401"
        : "not the development default",
    );

    /*
     * The scheduled jobs. get_deploy_settings() has always returned this count
     * and nothing ever read it, which meant a database with no cron jobs at all
     * reported healthy. That is not hypothetical: renaming the jobs to kicka_*
     * on an already-deployed database came within one migration of unscheduling
     * every one of them and creating none.
     */
    const scheduled = Number(s.cronJobsScheduled ?? 0);
    const active = Number(s.cronJobsActive ?? 0);
    add(
      "db:cron_jobs",
      scheduled === EXPECTED_CRON_JOBS && active === EXPECTED_CRON_JOBS,
      "blocking",
      scheduled === 0
        ? "NO scheduled jobs — nothing runs: no fixtures, no picks, no grading"
        : `${active} active of ${scheduled} scheduled, expected ${EXPECTED_CRON_JOBS}`,
    );

    /*
     * The engine configuration. Without an active row runDailyPicks returns
     * {skipped: "no active engine config"} and reports success, so the day
     * produces nothing and every surface says it went fine. Production ran in
     * exactly this state until the config moved from the seed into a migration,
     * because db push applies migrations and never runs seeds.
     */
    const { data: cfg, error: cfgErr } = await db
      .from("ai_engine_config")
      .select("version, system_prompt")
      .eq("status", "active")
      .maybeSingle();

    if (cfgErr) console.error("[health] db:engine_config:", cfgErr);

    const promptChars = (cfg?.system_prompt as string | undefined)?.length ?? 0;
    add(
      "db:engine_config",
      Boolean(cfg) && promptChars > 1000,
      "blocking",
      cfgErr
        ? DB_ERROR
        : !cfg
          ? "no ACTIVE engine config — every daily-picks run will skip and report success"
          : promptChars <= 1000
            ? `active config v${cfg.version} but its prompt is only ${promptChars} chars`
            : `v${cfg.version}, prompt ${promptChars} chars`,
    );

    /*
     * Jobs that exhausted their retries. They are parked rather than dropped,
     * which is right, but they were visible only to an admin who opened the
     * Office. A dead payment_receipt is a paying customer with no proof of
     * purchase, in a product whose Terms promise refunds.
     */
    const { count: deadCount } = await db
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "dead");

    add(
      "db:dead_jobs",
      (deadCount ?? 0) === 0,
      "warning",
      deadCount ? `${deadCount} job(s) exhausted their retries and were parked` : "none",
    );

    /*
     * Work that was queued and never picked up.
     *
     * Dead jobs are checked above, and dead was the wrong thing to watch on its
     * own: a job only reaches dead by being ATTEMPTED and failing. A drain-jobs
     * that never runs at all produces no dead jobs, no failures, and no signal
     * anywhere — the queue simply fills with rows whose attempts stay at zero.
     * That is the state this deployment is in, and every check above passed
     * while ten notifications sat unsent.
     *
     * Age, not depth. A queue with items in it is a queue doing its job; a
     * queue holding something from an hour ago is a queue nobody is draining.
     * An hour is generous against a drain that runs on a minutes-scale
     * schedule, and it is well inside the window where an unsent payment
     * receipt still looks like a delay rather than a broken promise.
     */
    const staleBefore = new Date(Date.now() - 60 * 60_000).toISOString();
    const { count: staleQueued } = await db
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("status", "queued")
      .lt("created_at", staleBefore);

    add(
      "db:job_queue",
      (staleQueued ?? 0) === 0,
      "blocking",
      staleQueued
        ? `${staleQueued} job(s) queued over an hour and never attempted — nothing is draining the queue, so no receipts or notifications are being sent`
        : "no stale work",
    );

    const { error: reachErr } = await db.from("leagues").select("id").limit(1);
    if (reachErr) console.error("[health] db:reachable:", reachErr);
    add("db:reachable", !reachErr, "blocking", reachErr ? DB_ERROR : "ok");
  } catch (err) {
    console.error("[health] db unreachable:", err);
    add("db:reachable", false, "blocking", "could not reach the database");
  }

  const blocking = checks.filter((c) => !c.ok && c.severity === "blocking");
  const warnings = checks.filter((c) => !c.ok && c.severity === "warning");

  return NextResponse.json(
    {
      ok: blocking.length === 0,
      environment: isProd ? "production" : "development",
      blocking: blocking.length,
      warnings: warnings.length,
      checks,
    },
    {
      // 503 so an uptime monitor treats a half-wired deploy as down rather
      // than as healthy-but-useless.
      status: blocking.length ? 503 : 200,
      headers: { "Cache-Control": "no-store" },
    },
  );
}
