"use client";

import { useCallback, useState, useTransition } from "react";
import { requestCode, verifyCodeInline } from "./auth-actions";

/**
 * Passwordless sign-in, without a screen attached.
 *
 * This logic lived inside the sign-in form, which meant the only way to sign
 * somebody in was to send them to that page. For a visitor holding a card that
 * is a detour with a journey back at the end of it, and the journey back is
 * where people give up.
 *
 * So the state machine moved out and the two surfaces became callers: the
 * sign-in page, which looks exactly as it did, and an inline step on the
 * payment page that never navigates. Neither owns the flow.
 *
 * `onVerified` is what separates them. The hook finishes at "the session
 * exists" and hands over; the sign-in page goes to the board from there, the
 * payment page opens Paystack. Nothing here knows which.
 */

/**
 * How many boxes the code input draws.
 *
 * Six, and pinned deliberately rather than inferred. The slotted input has to
 * commit to a length, which the plain text field it replaces did not — and
 * these two settings have drifted before: the deployed project was issuing
 * EIGHT while the form demanded six, so a correct code was truncated by the
 * input and then rejected for being the wrong shape.
 *
 * Production is 6 today, confirmed against the Management API and recorded in
 * supabase/config.toml. The SERVER still accepts 6 to 10, deliberately, so a
 * drift breaks one input rather than every session. If the project's
 * mailer_otp_length ever changes, this constant is the single thing to follow.
 */
export const OTP_CODE_LENGTH = 6;

export type OtpStep = "identifier" | "code";

export type OtpAuth = {
  step: OtpStep;
  email: string;
  setEmail: (v: string) => void;
  code: string;
  setCode: (v: string) => void;
  error: string | null;
  pending: boolean;
  /** Send a code to the address currently entered. */
  send: () => void;
  /** Verify the code currently entered. Calls onVerified on success. */
  verify: () => void;
  /** Back to the address step, clearing the code but keeping the address. */
  restart: () => void;
};

export function useOtpAuth(opts: {
  onVerified: () => void | Promise<void>;
}): OtpAuth {
  const [step, setStep] = useState<OtpStep>("identifier");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const send = useCallback(() => {
    setError(null);
    const address = email.trim();

    // Checked here as well as on the server, because the server's version of
    // this costs an email and a rate-limit slot to say the same thing.
    if (!address || !address.includes("@")) {
      setError("Enter your email address.");
      return;
    }

    startTransition(async () => {
      const form = new FormData();
      form.set("channel", "email");
      form.set("identifier", address);

      const result = await requestCode(undefined, form);
      if (result && "error" in result) {
        setError(result.error);
        return;
      }
      setCode("");
      setStep("code");
    });
  }, [email]);

  const verify = useCallback(() => {
    setError(null);
    const token = code.replace(/\D/g, "");
    if (token.length < OTP_CODE_LENGTH) {
      setError("Enter the code we sent you.");
      return;
    }

    startTransition(async () => {
      const form = new FormData();
      form.set("channel", "email");
      form.set("identifier", email.trim());
      form.set("code", token);

      const result = await verifyCodeInline(undefined, form);
      if (result && "error" in result) {
        setError(result.error);
        return;
      }
      // The session exists from here. What happens next is the caller's.
      await opts.onVerified();
    });
  }, [code, email, opts]);

  const restart = useCallback(() => {
    setError(null);
    setCode("");
    setStep("identifier");
  }, []);

  return { step, email, setEmail, code, setCode, error, pending, send, verify, restart };
}
