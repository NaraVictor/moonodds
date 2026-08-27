import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/lib/rate-limit";
import { captureServerEvent } from "@/lib/posthog-server";

export const dynamic = "force-dynamic";

/**
 * The caller's own data, and the door out.
 *
 * GET    exports everything we hold about them.
 * DELETE removes the account.
 *
 * Both were admin-only or absent, and both are data-subject rights rather than
 * features. Deletion needs the service role because removing the auth user is
 * privileged, so the session is checked first and the id comes from the session
 * rather than from the request body: there is no parameter here to point at
 * somebody else.
 */

export async function GET(request: Request) {
  const limited = await enforceRateLimit(request, {
    scope: "data-export",
    limit: 5,
    windowSeconds: 60 * 60,
    message: "You've requested several exports. Try again in an hour.",
  });
  if (limited) return limited;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const { data, error } = await supabase.rpc("export_my_data");
  if (error) {
    console.error("[account] export:", error);
    return NextResponse.json({ error: "Could not build your export." }, { status: 500 });
  }

  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="kicka-data-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function DELETE(request: Request) {
  const limited = await enforceRateLimit(request, {
    scope: "account-delete",
    limit: 3,
    windowSeconds: 60 * 60,
    message: "Too many attempts. Try again in an hour.",
  });
  if (limited) return limited;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  const db = createServiceClient();

  // An admin deleting themselves locks everyone out of the Office, and the
  // recovery is a database console. The Office already refuses this for other
  // accounts; it has to refuse it here too.
  const { data: profile } = await db
    .from("profiles")
    .select("is_super_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (profile?.is_super_admin) {
    return NextResponse.json(
      {
        error:
          "Admin accounts can't be deleted from here. Ask another admin to remove your access first.",
      },
      { status: 409 },
    );
  }

  /*
   * Payments are kept, and now actually are.
   *
   * This comment used to describe unlinking. Nothing unlinked: the update below
   * touched metadata, and then payments.user_id CASCADED from profiles, which
   * cascades from auth.users, so deleteUser took every payment row with it. The
   * comment stated the intent and the schema quietly did the opposite, which is
   * the worst arrangement of the two — an auditor reads the sentence and stops.
   *
   * The foreign key is ON DELETE SET NULL now, so the row survives with its
   * reference, amount, currency and timestamps and loses only the person. That
   * is both what retention needs and what erasure means. owner_erased_at
   * records when, so a null owner is distinguishable from a payment that never
   * had one.
   *
   * The write below no longer REPLACES metadata either. It merged nothing
   * before, so a refunded payment lost its providerRefundRef, its rate and its
   * dateKey — the refund audit trail, deleted by the erasure routine.
   */
  const { error: retainErr } = await db
    .from("payments")
    .update({ owner_erased_at: new Date().toISOString() })
    .eq("user_id", user.id);

  if (retainErr) {
    // Refusing is the right direction: deleting the account anyway would take
    // the payment records with it, and that is not recoverable.
    console.error("[account] could not mark payments before deletion:", retainErr);
    return NextResponse.json(
      { error: "Could not delete the account right now. Try again shortly." },
      { status: 500 },
    );
  }

  const { error } = await db.auth.admin.deleteUser(user.id);
  if (error) {
    console.error("[account] delete:", error);
    return NextResponse.json(
      { error: "Could not delete the account. Contact support." },
      { status: 500 },
    );
  }

  /*
   * Counted, not identified.
   *
   * The wizard attached this to the user's own id, which would have sent the
   * identifier of somebody who had just asked to be erased to a third-party
   * analytics service — and created or updated a person profile for them there,
   * seconds after this route deleted their account and unlinked their payments.
   * The deletion would have been undone, in a system nobody would think to
   * check, by the line recording that it happened.
   *
   * The metric worth having is how many accounts are deleted, and that survives
   * without naming anyone. A per-day bucket keeps it aggregate: it cannot be
   * traced back to a person, and PostHog is not handed a profile to hold.
   */
  await captureServerEvent({
    distinctId: `deleted-account-${new Date().toISOString().slice(0, 10)}`,
    event: "account_deleted",
  });

  return NextResponse.json({ deleted: true });
}
