"use client";

import { useActionState } from "react";
import { Button } from "@heroui/react/button";
import { Alert } from "@heroui/react/alert";
import { submitDetails } from "@/lib/auth-actions";

const FIELD =
  "w-full rounded-xl border border-field-border bg-field px-3.5 py-2.5 text-sm text-field-foreground outline-none placeholder:text-field-placeholder focus-visible:ring-2 focus-visible:ring-focus";

export function DetailsForm({ defaultName }: { defaultName: string }) {
  const [state, action, pending] = useActionState(submitDetails, undefined);

  return (
    <form action={action} className="space-y-4">
      {state && "error" in state && (
        <Alert status="danger">
          <Alert.Description>{state.error}</Alert.Description>
        </Alert>
      )}

      <div className="space-y-1.5">
        <label htmlFor="displayName" className="text-sm font-medium">
          What should we call you?
        </label>
        <input
          id="displayName"
          name="displayName"
          defaultValue={defaultName}
          autoComplete="nickname"
          className={FIELD}
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
          className={FIELD}
        />
        <p className="text-[12px] text-muted">
          You must be 18 or over. Predictions are analysis, not guarantees.
        </p>
      </div>

      <Button type="submit" isPending={pending} className="w-full">
        Finish
      </Button>
    </form>
  );
}
