#!/usr/bin/env node
/**
 * Push supabase/templates/*.html to the deployed project.
 *
 * config.toml configures templates for LOCAL Supabase only. The deployed
 * project keeps its own copies, so without this the repo and production drift
 * silently and production keeps sending whatever it was last given — which was
 * Supabase's default magic LINK, the thing these templates exist to replace.
 *
 * NOT `supabase config push`. That sends the entire config file, including a
 * locally generated SMS hook secret and every rate limit, and would overwrite
 * dashboard settings with local ones. This patches four fields.
 *
 * Auth comes from the Supabase CLI's own token, so there is no new credential
 * to store and nothing to leak: if `supabase login` works, this works.
 *
 *   pnpm templates:push
 *   pnpm templates:push --check    compare only, exit 1 on drift
 */

import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const REF = "sktaghkuppcqzsltuffu";
const API = `https://api.supabase.com/v1/projects/${REF}/config/auth`;
const check = process.argv.includes("--check");

/** The CLI stores its token in the login keychain rather than on disk. */
function token() {
  const fromEnv = process.env.SUPABASE_ACCESS_TOKEN;
  if (fromEnv) return fromEnv;
  try {
    return execSync('security find-generic-password -s "Supabase CLI" -w', {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    throw new Error(
      "No Supabase token. Run `supabase login`, or set SUPABASE_ACCESS_TOKEN.",
    );
  }
}

const read = (name) =>
  readFileSync(new URL(`../supabase/templates/${name}.html`, import.meta.url), "utf8").trim();

const SUBJECT = "Your Kicka sign-in code";
const templates = {
  mailer_subjects_confirmation: SUBJECT,
  mailer_templates_confirmation_content: read("confirm-signup"),
  mailer_subjects_magic_link: SUBJECT,
  mailer_templates_magic_link_content: read("magic-link"),
};

// The whole point. A template that renders a link cannot work with a typed
// code, so shipping one is refused here rather than discovered by a person
// trying to sign in.
for (const [field, body] of Object.entries(templates)) {
  if (!field.endsWith("_content")) continue;
  if (body.includes("ConfirmationURL")) {
    console.error(`\n${field} contains {{ .ConfirmationURL }}. These emails must carry a code, not a link.\n`);
    process.exit(1);
  }
  if (!body.includes("{{ .Token }}")) {
    console.error(`\n${field} has no {{ .Token }}, so the email would arrive with no code in it.\n`);
    process.exit(1);
  }
}

const auth = { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" };

const current = await fetch(API, { headers: auth }).then((r) => r.json());

const drift = Object.entries(templates).filter(
  ([field, want]) => (current[field] ?? "").trim() !== want.trim(),
);

if (!drift.length) {
  console.log("Production email templates match supabase/templates/.");
  process.exit(0);
}

if (check) {
  console.error(`\nProduction differs from supabase/templates/ in ${drift.length} field(s):`);
  for (const [field] of drift) console.error(`  ${field}`);
  console.error("\nRun: pnpm templates:push\n");
  process.exit(1);
}

/**
 * One field per request, with backoff.
 *
 * The Management API sits behind a WAF that answers a burst of PATCHes with
 * `403 error code: 1010` — a Cloudflare block, not a Supabase validation
 * error, and indistinguishable from a rejected payload unless you know to look
 * for the code. Sending them one at a time with a pause avoids tripping it.
 */
for (const [field, value] of drift) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(API, {
      method: "PATCH",
      headers: auth,
      body: JSON.stringify({ [field]: value }),
    });

    if (res.ok) {
      console.log(`  updated ${field}`);
      break;
    }

    const body = await res.text();
    const throttled = res.status === 403 && body.includes("1010");

    if (!throttled || attempt >= 5) {
      console.error(`\n${field} failed: HTTP ${res.status} ${body.slice(0, 120)}`);
      if (throttled) console.error("The WAF is still throttling. Wait a minute and re-run.\n");
      process.exit(1);
    }

    const wait = attempt * 20;
    console.log(`  ${field}: throttled, retrying in ${wait}s`);
    await new Promise((r) => setTimeout(r, wait * 1000));
  }

  await new Promise((r) => setTimeout(r, 3000));
}

console.log("\nDone. Sign in with an address that has never been used to see the signup template.\n");
