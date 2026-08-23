/**
 * Supabase credentials, checked before anything tries to use them.
 *
 * The failure this exists to prevent looked like this: the app pointed at the
 * deployed project while carrying the LOCAL CLI publishable key, which is the
 * same string on every machine on earth. Supabase answered every request with
 * `{"message":"Invalid API key"}`, and that surfaced to a person trying to
 * sign in as the words "Invalid API key" under an email field — a message
 * about our configuration, shown to a customer, that named nothing they or we
 * could act on. The Google path was worse: with no key at all it returned
 * "No API key found in request", which reads like a Google problem and is not.
 *
 * A wrong key is not a runtime condition to handle gracefully, it is a
 * deployment that cannot work. So it throws, at the moment a client is built,
 * naming the variable and the mismatch.
 */

/**
 * The local CLI's publishable key.
 *
 * Published in Supabase's own documentation and identical on every local
 * install, which is exactly why it must never reach a deployed project: it is
 * not a secret, it is a fixture, and seeing it against a real URL means the
 * environment was half-copied.
 */
const LOCAL_KEY_PREFIXES = ["sb_publishable_ACJWlzQHl", "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1v"];

function isLocalUrl(url: string): boolean {
  return /localhost|127\.0\.0\.1|host\.docker\.internal/.test(url);
}

function isLocalKey(key: string): boolean {
  return LOCAL_KEY_PREFIXES.some((p) => key.startsWith(p));
}

export function supabaseCredentials(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL is not set. Nothing can authenticate or read data without it.",
    );
  }
  if (!key) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY is not set. Supabase answers every request with " +
        '"No API key found in request", which reads like a provider outage and is not.',
    );
  }

  // The half-copied environment. Either direction is a configuration error and
  // neither produces a message anyone could diagnose from the symptom.
  if (!isLocalUrl(url) && isLocalKey(key)) {
    throw new Error(
      `Supabase key/URL mismatch: NEXT_PUBLIC_SUPABASE_URL points at ${url} ` +
        "but NEXT_PUBLIC_SUPABASE_ANON_KEY is the LOCAL CLI key, which is the same " +
        "on every machine and belongs to no deployed project. Supabase will answer " +
        '"Invalid API key" for every request, including sign-in. Copy the publishable ' +
        "key from Project Settings → API Keys.",
    );
  }
  if (isLocalUrl(url) && !isLocalKey(key)) {
    throw new Error(
      `Supabase key/URL mismatch: NEXT_PUBLIC_SUPABASE_URL points at local Supabase ` +
        "but NEXT_PUBLIC_SUPABASE_ANON_KEY is a REMOTE project key. Run " +
        "`supabase status -o env` and use the local pair, or point the URL at the project.",
    );
  }

  return { url, key };
}
