"use client";

import { useActionState, useState } from "react";
import { Button } from "@heroui/react/button";
import { Alert } from "@heroui/react/alert";
import { requestCode, verifyCode, signInWithGoogle } from "@/lib/auth-actions";

const FIELD =
  "w-full rounded-xl border border-field-border bg-field px-3.5 py-2.5 text-sm text-field-foreground outline-none placeholder:text-field-placeholder focus-visible:ring-2 focus-visible:ring-focus";

/**
 * Sign in, without a password.
 *
 * One form, two steps. There is no separate sign-up: a code proves you control
 * the address, and whether an account already existed behind it is our problem
 * rather than something to make someone choose from a menu before they can
 * start.
 */
export function SignInForm() {
  const [channel, setChannel] = useState<"email" | "sms">("email");
  const [identifier, setIdentifier] = useState("");

  const [sendState, send, sending] = useActionState(requestCode, undefined);
  const [verifyState, verify, verifying] = useActionState(verifyCode, undefined);

  const codeSent = sendState && "sent" in sendState;

  if (codeSent) {
    return (
      <form action={verify} className="space-y-4">
        <input type="hidden" name="channel" value={channel} />
        <input type="hidden" name="identifier" value={identifier} />

        <div className="rounded-xl border border-border bg-surface-secondary px-3.5 py-3 text-[13px]">
          We sent a 6-digit code to{" "}
          <strong className="font-semibold">{identifier}</strong>. It expires
          shortly, so use it now.
        </div>

        {verifyState && "error" in verifyState && (
          <Alert status="danger">
            <Alert.Description>{verifyState.error}</Alert.Description>
          </Alert>
        )}

        <div className="space-y-1.5">
          <label htmlFor="code" className="text-sm font-medium">
            Your code
          </label>
          <input
            id="code"
            name="code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            maxLength={6}
            placeholder="000000"
            className={`${FIELD} numeral text-center text-lg tracking-[0.4em]`}
          />
        </div>

        <Button type="submit" isPending={verifying} className="w-full">
          Continue
        </Button>

        <p className="text-center text-[12px] text-muted">
          Didn&rsquo;t arrive?{" "}
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="font-medium underline underline-offset-2"
          >
            Start again
          </button>
        </p>
      </form>
    );
  }

  return (
    <div className="space-y-5">
      <form action={signInWithGoogle}>
        <Button type="submit" variant="secondary" className="w-full">
          <GoogleMark />
          Continue with Google
        </Button>
      </form>

      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        <span className="text-[11px] uppercase tracking-wider text-muted">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <form action={send} className="space-y-4">
        <input type="hidden" name="channel" value={channel} />

        {sendState && "error" in sendState && (
          <Alert status="danger">
            <Alert.Description>{sendState.error}</Alert.Description>
          </Alert>
        )}

        <div
          className="flex gap-1 rounded-xl border border-border p-1"
          role="tablist"
          aria-label="How to receive your code"
        >
          {(["email", "sms"] as const).map((c) => (
            <button
              key={c}
              type="button"
              role="tab"
              aria-selected={channel === c}
              onClick={() => setChannel(c)}
              className={`flex-1 rounded-lg px-3 py-1.5 text-[13px] font-medium transition-colors ${
                channel === c
                  ? "bg-accent text-accent-foreground"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {c === "email" ? "Email" : "Phone"}
            </button>
          ))}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="identifier" className="text-sm font-medium">
            {channel === "email" ? "Email" : "Phone number"}
          </label>
          <input
            id="identifier"
            name="identifier"
            key={channel}
            type={channel === "email" ? "email" : "tel"}
            inputMode={channel === "email" ? "email" : "tel"}
            autoComplete={channel === "email" ? "email" : "tel"}
            required
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            placeholder={channel === "email" ? "you@example.com" : "024 123 4567"}
            className={FIELD}
          />
          {channel === "sms" && (
            <p className="text-[12px] text-muted">
              Ghanaian numbers can start with 0. Anywhere else, include the
              country code.
            </p>
          )}
        </div>

        <Button type="submit" isPending={sending} className="w-full">
          Send me a code
        </Button>
      </form>

      <p className="text-center text-[12px] leading-relaxed text-muted">
        No password needed. We send a code each time, so there is nothing to
        remember and nothing to leak.
      </p>
    </div>
  );
}

/** Google's mark, inline so it survives the CSP with no external request. */
function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden="true">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}
