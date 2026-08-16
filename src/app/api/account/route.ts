import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { enforceRateLimit } from "@/lib/rate-limit";

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
  const limited = enforceRateLimit(request, {
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
      "Content-Disposition": `attachment; filename="moonodds-data-${new Date().toISOString().slice(0, 10)}.json"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function DELETE(request: Request) {
  const limited = enforceRateLimit(request, {
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

  // Payments are kept: they are financial records with their own retention
  // obligations, and they are unlinked from the person rather than destroyed.
  // Everything else cascades from the auth user.
  await db
    .from("payments")
    .update({ metadata: { erased: true, erasedAt: new Date().toISOString() } })
    .eq("user_id", user.id);

  const { error } = await db.auth.admin.deleteUser(user.id);
  if (error) {
    console.error("[account] delete:", error);
    return NextResponse.json(
      { error: "Could not delete the account. Contact support." },
      { status: 500 },
    );
  }

  return NextResponse.json({ deleted: true });
}
