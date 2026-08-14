"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "./supabase/server";

export type AuthResult = { error: string } | undefined;

export async function signIn(
  _prev: AuthResult,
  formData: FormData,
): Promise<AuthResult> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    // Don't leak whether the address exists.
    return { error: "That email and password don't match an account." };
  }

  revalidatePath("/", "layout");
  redirect("/");
}

export async function signUp(
  _prev: AuthResult,
  formData: FormData,
): Promise<AuthResult> {
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const displayName = String(formData.get("displayName") ?? "").trim();

  if (password.length < 8) {
    return { error: "Use at least 8 characters for your password." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName || email.split("@")[0] } },
  });

  if (error) return { error: error.message };

  // The on_auth_user_created trigger has already created the profile and
  // notification defaults — no client-side bootstrap call needed.
  revalidatePath("/", "layout");
  redirect("/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/");
}

/**
 * Development only: sign in as one of the seeded demo accounts so every access
 * tier is reachable without buying anything. Refuses to run outside dev.
 */
export async function signInAsDemo(email: string): Promise<AuthResult> {
  if (process.env.NODE_ENV === "production") {
    return { error: "Demo sign-in is disabled in production." };
  }
  if (!email.endsWith("@moonodds.test")) {
    return { error: "Not a demo account." };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password: "moonodds",
  });

  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  return undefined;
}
