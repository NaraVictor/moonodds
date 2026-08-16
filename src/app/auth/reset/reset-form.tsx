"use client";

import { useActionState } from "react";
import { Button } from "@heroui/react/button";
import { Alert } from "@heroui/react/alert";
import { updatePassword } from "@/lib/auth-actions";

export function ResetForm() {
  const [state, action, pending] = useActionState(updatePassword, undefined);

  return (
    <form action={action} className="space-y-4">
      {state?.error && (
        <Alert status="danger">
          <Alert.Description>{state.error}</Alert.Description>
        </Alert>
      )}

      <div className="space-y-1.5">
        <label htmlFor="password" className="text-sm font-medium">
          New password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
          className="w-full rounded-xl border border-field-border bg-field px-3.5 py-2.5 text-sm text-field-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="confirm" className="text-sm font-medium">
          Confirm it
        </label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
          className="w-full rounded-xl border border-field-border bg-field px-3.5 py-2.5 text-sm text-field-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus"
        />
      </div>

      <Button type="submit" fullWidth size="lg" isDisabled={pending} variant="primary">
        {pending ? "Saving…" : "Save and sign in"}
      </Button>
    </form>
  );
}
