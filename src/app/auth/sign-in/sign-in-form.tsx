"use client";

import { useRouter } from "next/navigation";
import { Button } from "@heroui/react/button";
import { Alert } from "@/components/ui/alert";
import { PendingButton } from "@/components/ui/pending-button";
import { OtpCodeInput } from "@/components/auth/otp-code-input";
import { signInWithGoogle } from "@/lib/auth-actions";
import { useOtpAuth } from "@/lib/otp-auth";

/**
 * Both fields centre their content, including the placeholder.
 *
 * The code field was already centred and the email was not, which read as an
 * inconsistency between two steps of one flow rather than a deliberate
 * difference. There is a single input on each step, so there is no column edge
 * for a left-aligned value to line up with.
 */
const FIELD =
  "w-full rounded-xl border border-field-border bg-field px-3.5 py-3 text-sm text-center text-field-foreground outline-none placeholder:text-field-placeholder focus-visible:ring-2 focus-visible:ring-focus";

/**
 * Sign in, without a password.
 *
 * One form, two steps, one field. There is no separate sign-up: a code proves
 * you control the address, and whether an account already existed behind it is
 * our bookkeeping rather than something to make someone choose from a menu
 * before they can start.
 *
 * Email only for now. SMS works end to end and is switched off here rather
 * than removed, so turning it back on is a form change.
 *
 * Nothing else is collected. No name, no date of birth, no confirmation step:
 * a name is generated on the way in and can be changed later on the profile
 * page, which is the only screen where it appears.
 */
export function SignInForm() {
  const router = useRouter();

  /*
   * The flow lives in useOtpAuth now; this file is the screen for it.
   *
   * Only the plumbing changed. The two steps, the single field, the copy and
   * the spacing are as they were — what moved is that the state machine is no
   * longer trapped in this component, so the payment page can run the same one
   * without sending anyone here first.
   *
   * verifyCodeInline does not redirect, so this does. router.replace rather
   * than push, because a signed-in visitor pressing Back should not land on the
   * sign-in page they just cleared; refresh, because the layout above renders
   * signed-in state on the server.
   */
  const auth = useOtpAuth({
    onVerified: () => {
      router.replace("/");
      router.refresh();
    },
  });

  if (auth.step === "code") {
    return (
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          auth.verify();
        }}
      >
        <div className="rounded-xl border border-border bg-surface-secondary px-3.5 py-3 text-[13px]">
          We sent a code to{" "}
          <strong className="font-semibold">{auth.email}</strong>. It expires
          shortly, so use it now.
        </div>

        {auth.error && <Alert status="danger">{auth.error}</Alert>}

        <div className="space-y-1.5">
          <span className="text-sm font-medium">Your code</span>
          <div className="flex justify-center pt-1">
            <OtpCodeInput
              value={auth.code}
              onChange={auth.setCode}
              onComplete={auth.verify}
              disabled={auth.pending}
              invalid={Boolean(auth.error)}
              autoFocus
            />
          </div>
        </div>

        <PendingButton
          isPending={auth.pending}
          pendingLabel="Checking…"
          className="h-[3.3rem] w-full text-[15px]"
        >
          Continue
        </PendingButton>

        <p className="text-center text-[12px] text-muted">
          Didn&rsquo;t arrive?{" "}
          <button
            type="button"
            onClick={auth.restart}
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
        <Button type="submit" variant="secondary" className="h-[3.3rem] w-full text-[15px]">
          <GoogleMark />
          Continue with Google
        </Button>
      </form>

      <div className="flex items-center gap-3" aria-hidden="true">
        <span className="h-px flex-1 bg-border" />
        <span className="text-[11px] uppercase tracking-wider text-muted">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          auth.send();
        }}
      >
        {auth.error && <Alert status="danger">{auth.error}</Alert>}

        <div className="space-y-1.5">
          <label htmlFor="identifier" className="text-sm font-medium">
            Email
          </label>
          <input
            id="identifier"
            name="identifier"
            type="email"
            inputMode="email"
            autoComplete="email"
            required
            autoFocus
            value={auth.email}
            onChange={(e) => auth.setEmail(e.target.value)}
            placeholder="you@example.com"
            className={FIELD}
          />
        </div>

        <PendingButton
          isPending={auth.pending}
          pendingLabel="Sending…"
          className="h-[3.3rem] w-full text-[15px]"
        >
          Send me a code
        </PendingButton>
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
