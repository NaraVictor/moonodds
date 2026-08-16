"use client";

import { useActionState } from "react";
import { Button } from "@heroui/react/button";
import { Alert } from "@heroui/react/alert";
import { requestPasswordReset } from "@/lib/auth-actions";

export function ForgotForm() {
  const [state, action, pending] = useActionState(requestPasswordReset, undefined);

  // The action returns undefined on success and never reveals whether the
  // address exists, so "sent" is inferred from having submitted without an
  // error rather than from anything the server told us about the account.
  const sent = state === undefined && !pending;

  return (
    <form action={action} className="space-y-4">
      {state?.error && (
        <Alert status="danger">
          <Alert.Description>{state.error}</Alert.Description>
        </Alert>
      )}

      <div className="space-y-1.5">
        <label htmlFor="email" className="text-sm font-medium">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="you@example.com"
          className="w-full rounded-xl border border-field-border bg-field px-3.5 py-2.5 text-sm text-field-foreground outline-none placeholder:text-field-placeholder focus-visible:ring-2 focus-visible:ring-focus"
        />
      </div>

      <Button type="submit" fullWidth size="lg" isDisabled={pending} variant="primary">
        {pending ? "Sending…" : "Send reset link"}
      </Button>

      <p className="text-center text-xs leading-relaxed text-muted">
        {sent
          ? "If that address has an account, the link is on its way. It expires in an hour."
          : "The link expires an hour after it is sent."}
      </p>
    </form>
  );
}
