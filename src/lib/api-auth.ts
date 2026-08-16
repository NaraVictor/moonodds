import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "./supabase/server";
import { devBypassEnabled } from "./dev-bypass";

/**
 * Guard for the /api/cron/* routes.
 *
 * pg_cron reaches these over HTTP, so they're publicly addressable and need a
 * shared secret. Compared in constant time so the check can't be probed by
 * timing. The secret lives in both CRON_SECRET and app.settings.cron_secret.
 */
export function assertCronRequest(request: Request): NextResponse | null {
  // Dev bypass: lets you POST the cron routes from a browser or curl without
  // the bearer token. Off in production, always.
  if (devBypassEnabled()) return null;

  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured." },
      { status: 500 },
    );
  }

  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";

  if (!timingSafeEqual(token, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Resolve the signed-in user, or null. */
export async function currentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/**
 * Super-admin guard for admin-only routes.
 *
 * Reads the flag from profiles via the service client rather than trusting a
 * JWT claim, app_metadata goes stale until token refresh, and user_metadata is
 * user-writable outright.
 */
export async function requireSuperAdmin() {
  if (devBypassEnabled()) {
    // Office actions still need SOME actor for audit fields, so fall back to
    // the seeded admin when there's no session at all.
    const bypassUser = await currentUser();
    return {
      user:
        bypassUser ??
        ({ id: "55555555-5555-4555-8555-555555555555", email: "bypass@dev.local" } as {
          id: string;
          email: string;
        }),
    };
  }

  const user = await currentUser();
  if (!user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const admin = createServiceClient();
  const { data } = await admin
    .from("profiles")
    .select("is_super_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (!data?.is_super_admin) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }

  return { user };
}
