"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Button } from "@heroui/react/button";
import { Alert } from "@heroui/react/alert";
import { signIn } from "@/lib/auth-actions";

export function SignInForm() {
  const [state, action, pending] = useActionState(signIn, undefined);

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

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <label htmlFor="password" className="text-sm font-medium">
            Password
          </label>
          <Link
            href="/auth/forgot"
            className="text-[12px] font-medium underline underline-offset-2"
            style={{ color: "var(--link)" }}
          >
            Forgot it?
          </Link>
        </div>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          className="w-full rounded-xl border border-field-border bg-field px-3.5 py-2.5 text-sm text-field-foreground outline-none focus-visible:ring-2 focus-visible:ring-focus"
        />
      </div>

      <Button
        type="submit"
        fullWidth
        size="lg"
        isDisabled={pending}
        variant="primary"
      >
        {pending ? "Signing in…" : "Sign in"}
      </Button>

      <p className="rounded-lg border border-border bg-surface-secondary p-3 text-xs leading-relaxed text-muted">
        <span className="font-semibold text-foreground">Demo accounts</span>,
        password <code className="font-mono text-[0.9em]">moonodds</code>
        <br />
        <code className="font-mono text-[0.9em]">pass@moonodds.test</code> · full access
        <br />
        <code className="font-mono text-[0.9em]">new@moonodds.test</code> · 2 free picks
        <br />
        <code className="font-mono text-[0.9em]">locked@moonodds.test</code> · paywalled
        <br />
        <code className="font-mono text-[0.9em]">admin@moonodds.test</code> · Office panel
      </p>
    </form>
  );
}
