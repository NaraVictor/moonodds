import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

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
 */

type Check = {
  name: string;
  ok: boolean;
  severity: "blocking" | "warning" | "info";
  detail: string;
};

export async function GET() {
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

  const mocked = process.env.MOCK_PROVIDERS === "true";
  add(
    "providers",
    !isProd || !mocked,
    isProd ? "blocking" : "info",
    mocked ? "MOCK_PROVIDERS=true, nothing touches a real provider" : "live providers",
  );

  if (!mocked) {
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

  add(
    "dev-bypass",
    !(isProd && process.env.DEV_BYPASS_AUTH === "true"),
    "blocking",
    process.env.DEV_BYPASS_AUTH === "true"
      ? "set, and ignored in production builds"
      : "off",
  );

  /* ------------------------------ database ------------------------------ */

  try {
    const db = createServiceClient();

    // THE one that is silent when missed. app.settings ships with local
    // defaults, so until it is updated every scheduled job posts into nothing:
    // no fixtures, no picks, no grading, and no error anywhere.
    const { data: settings } = await db.rpc("get_deploy_settings");
    const s = (settings ?? {}) as { appBaseUrl?: string; cronSecretIsLocal?: boolean };

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

    add(
      "db:cron_secret",
      !isProd || !s.cronSecretIsLocal,
      "blocking",
      s.cronSecretIsLocal
        ? "still the development secret, so every cron job would 401"
        : "not the development default",
    );

    const { error: reachErr } = await db.from("leagues").select("id").limit(1);
    add("db:reachable", !reachErr, "blocking", reachErr ? reachErr.message : "ok");
  } catch (err) {
    add(
      "db:reachable",
      false,
      "blocking",
      err instanceof Error ? err.message : "could not reach the database",
    );
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
