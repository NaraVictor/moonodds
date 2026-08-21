"use client";

import { useActionState } from "react";
import { Button } from "@heroui/react/button";
import { Alert } from "@heroui/react/alert";
import { signUp } from "@/lib/auth-actions";

export function SignUpForm() {
  const [state, action, pending] = useActionState(signUp, undefined);

  const field =
    "w-full rounded-xl border border-field-border bg-field px-3.5 py-2.5 text-sm text-field-foreground outline-none placeholder:text-field-placeholder focus-visible:ring-2 focus-visible:ring-focus";

  return (
    <form action={action} className="space-y-4">
      {state?.error && (
        <Alert status="danger">
          <Alert.Description>{state.error}</Alert.Description>
        </Alert>
      )}

      <div className="space-y-1.5">
        <label htmlFor="displayName" className="text-sm font-medium">
          Name
        </label>
        <input
          id="displayName"
          name="displayName"
          type="text"
          autoComplete="name"
          placeholder="What should we call you?"
          className={field}
        />
      </div>

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
          className={field}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className="text-sm font-medium">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          placeholder="At least 8 characters"
          className={field}
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="dateOfBirth" className="text-sm font-medium">
          Date of birth
        </label>
        <input
          id="dateOfBirth"
          name="dateOfBirth"
          type="date"
          required
          autoComplete="bday"
          className="w-full rounded-xl border border-field-border bg-field px-3.5 py-2.5 text-sm text-field-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus"
        />
        <p className="text-xs text-muted">
          Kicka is for over-18s. We store this to check that and nothing else.
        </p>
      </div>

      <Button
        type="submit"
        fullWidth
        size="lg"
        isDisabled={pending}
        variant="primary"
      >
        {pending ? "Creating account…" : "Create account"}
      </Button>
    </form>
  );
}
