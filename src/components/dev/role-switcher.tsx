"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@heroui/react/button";
import { Chip } from "@heroui/react/chip";
import { FlaskConical, X } from "@/components/ui/icons";
import { signInAsDemo, signOut } from "@/lib/auth-actions";

/**
 * Dev-only tier switcher.
 *
 * Every access state in this app is a database fact, a pass row, a suspension
 * flag, an account age. That makes them awkward to eyeball during development,
 * so this jumps between the seeded demo accounts. Rendered only when
 * NODE_ENV !== production; the server action refuses to run there regardless.
 */

const TIERS = [
  {
    email: "pass@kicka.test",
    label: "Pass holder",
    detail: "Bought today's pass, sees every pick",
    color: "success" as const,
  },
  {
    email: "new@kicka.test",
    label: "First day",
    detail: "Signed up today, 2 free picks",
    color: "accent" as const,
  },
  {
    email: "locked@kicka.test",
    label: "Locked out",
    detail: "Returning, no pass, sees nothing",
    color: "warning" as const,
  },
  {
    email: "suspended@kicka.test",
    label: "Suspended",
    detail: "Holds a valid pass, still blocked",
    color: "danger" as const,
  },
  {
    email: "admin@kicka.test",
    label: "Super-admin",
    detail: "Full access plus the Office panel",
    color: "default" as const,
  },
];

export function RoleSwitcher() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  function pick(email: string | null) {
    startTransition(async () => {
      if (email) await signInAsDemo(email);
      else await signOut();
      router.refresh();
    });
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open the development role switcher"
        className="fixed bottom-4 left-4 z-50 flex h-11 w-11 cursor-pointer items-center justify-center rounded-full border border-border bg-surface text-muted shadow-lg transition-colors hover:text-foreground"
      >
        <FlaskConical className="h-5 w-5" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-4 left-4 z-50 w-[19rem] rounded-xl border border-border bg-surface p-3 shadow-2xl">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="label">Dev · access tier</p>
          <p className="text-xs text-muted">Not shown in production</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Close the role switcher"
          className="cursor-pointer rounded-md p-1 text-muted hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex flex-col gap-1.5">
        {TIERS.map((t) => (
          <button
            key={t.email}
            type="button"
            disabled={pending}
            onClick={() => pick(t.email)}
            className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-transparent p-2 text-left transition-colors hover:border-border hover:bg-surface-secondary disabled:opacity-50"
          >
            <Chip size="sm" color={t.color} variant="soft">
              {t.label}
            </Chip>
            <span className="flex-1 pt-0.5 text-[11px] leading-snug text-muted">
              {t.detail}
            </span>
          </button>
        ))}
      </div>

      <Button
        size="sm"
        variant="ghost"
        fullWidth
        isDisabled={pending}
        className="mt-2"
        onPress={() => pick(null)}
      >
        Sign out (view as guest)
      </Button>
    </div>
  );
}
