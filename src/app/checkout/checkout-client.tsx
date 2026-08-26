"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "@heroui/react/card";
import { Button } from "@heroui/react/button";
import { Chip } from "@heroui/react/chip";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@heroui/react/skeleton";
import { Check, ShieldCheck, Sparkles } from "@/components/ui/icons";
import { useAccessState, useLeagueOptions } from "@/lib/queries";
import { LinkButton } from "@/components/ui/link-button";
import { extraPicksPriceUsd ,
} from "@/lib/pricing";
import { openPaystack } from "@/lib/paystack-popup";
import { OtpCodeInput } from "@/components/auth/otp-code-input";
import { useOtpAuth } from "@/lib/otp-auth";

type Kind = "day-pass" | "extra-picks";
/**
 * "auth" is a step in the payment, not a departure from it.
 *
 * An unauthenticated visitor used to be sent to /auth/sign-in and left to find
 * their own way back. The journey back is where people give up: they arrived
 * holding a card and left holding a sign-in page.
 */
type Stage = "idle" | "auth" | "initialising" | "paying" | "verifying" | "done";

/**
 * Checkout.
 *
 * Two calls: POST initialises and records the reference against the buyer,
 * PATCH verifies and activates. Between them the customer completes Paystack's
 * own popup, so no card detail ever reaches this code or our servers.
 *
 * PATCH is the fast path rather than the authoritative one. The Paystack
 * webhook and the reconciliation sweep call the same settlePayment, so a
 * customer who pays and then closes the tab still gets what they bought.
 */
export function CheckoutClient({ kind }: { kind: Kind }) {
  const router = useRouter();
  const qc = useQueryClient();
  const { data: access } = useAccessState();

  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);

  const leagues = useLeagueOptions(kind === "extra-picks");

  const games = selected.reduce((sum, id) => {
    const l = leagues.data?.find((x) => x.leagueId === id);
    return sum + (l?.availableGames ?? 0);
  }, 0);
  const priceUsd = kind === "day-pass" ? 3 : extraPicksPriceUsd(games);

  const endpoint =
    kind === "day-pass" ? "/api/checkout/day-pass" : "/api/checkout/extra-picks";

  const pay = useCallback(async () => {
    setError(null);
    setStage("initialising");

    try {
      const initRes = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body:
          kind === "extra-picks"
            ? JSON.stringify({ leagueIds: selected })
            : undefined,
      });
      const init = await initRes.json();

      /*
       * Not signed in. That is a step, not a failure.
       *
       * The route is the authority on this rather than a client-side guess at
       * whether a session exists: it already refuses, and refusing is the only
       * reliable signal that the cookie is missing or expired.
       */
      if (initRes.status === 401) {
        setStage("auth");
        return;
      }

      if (!initRes.ok) throw new Error(init.error ?? "Could not start checkout.");
      if (init.alreadyActive) {
        setStage("done");
        return;
      }

      setStage("paying");

      // Paystack's own window. Nothing is charged until the customer completes
      // it, and the guard stays because a provider that returns no access code
      // should skip to verification rather than throw at the customer.
      if (init.accessCode) {
        const outcome = await openPaystack(init.accessCode);
        if (outcome.status === "cancelled") {
          // Not an error. The payment row stays pending and the reconcile sweep
          // will leave it alone, because nothing was ever charged.
          setStage("idle");
          return;
        }
      }

      setStage("verifying");
      const verifyRes = await fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference: init.reference }),
      });
      const verify = await verifyRes.json();

      if (!verifyRes.ok) throw new Error(verify.error ?? "Verification failed.");

      await qc.invalidateQueries();
      setStage("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setStage("idle");
    }
  }, [endpoint, kind, selected, qc]);

  /*
   * Verified, then straight into Paystack. No second button.
   *
   * The brief for this was "under ninety seconds and never leaves the page",
   * and the part that makes it one motion rather than two is right here: the
   * code resolving IS the press of Pay. Anything else puts a button between
   * somebody and the thing they already decided to do.
   */
  const auth = useOtpAuth({ onVerified: pay });

  if (stage === "done") {
    return (
      <main className="mx-auto w-full max-w-md px-5 py-20">
        <Card>
          <Card.Content className="flex flex-col items-center gap-4 p-10 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-success/15">
              <Check className="h-6 w-6 text-success" strokeWidth={2.5} />
            </div>
            <div className="space-y-1">
              <h1 className="display text-xl">
                {kind === "day-pass" ? "Pass activated" : "Extra picks unlocked"}
              </h1>
              <p className="text-sm text-muted">
                {kind === "day-pass"
                  ? "Every pick for today is now visible."
                  : `${games} extra games added to your board.`}
              </p>
            </div>
            <Button
              variant="primary"
              onPress={() => {
                router.push("/");
                router.refresh();
              }}
            >
              See your picks
            </Button>
          </Card.Content>
        </Card>
      </main>
    );
  }

  const busy = stage !== "idle";

  return (
    <main className="mx-auto w-full max-w-md space-y-5 px-5 py-12">
      <header className="space-y-1 text-center">
        <p className="label">Checkout</p>
        <h1 className="display text-2xl">
          {kind === "day-pass" ? "Day pass" : "Extra league picks"}
        </h1>
      </header>

      {error && (
        <Alert status="danger">
          {error}
        </Alert>
      )}

      {kind === "day-pass" && access?.hasFullAccess && (
        <Alert status="success">
          You already have full access today, no need to buy again.
        </Alert>
      )}

      {kind === "extra-picks" && !access?.hasFullAccess && (
        <Alert status="warning" title="Pass holders only">
          Extra league picks are a day-pass perk. Grab a pass first.
        </Alert>
      )}

      <Card>
        <Card.Content className="space-y-5 p-6">
          {kind === "extra-picks" && (
            <div className="space-y-2">
              <p className="label">Choose leagues</p>
              {leagues.isPending ? (
                <Skeleton className="h-32 rounded-lg" />
              ) : !leagues.data?.length ? (
                <p className="py-4 text-center text-sm text-muted">
                  No leagues have upcoming games left today.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {leagues.data.map((l) => {
                    const on = selected.includes(l.leagueId);
                    return (
                      <button
                        key={l.leagueId}
                        type="button"
                        onClick={() =>
                          setSelected((s) =>
                            on
                              ? s.filter((x) => x !== l.leagueId)
                              : [...s, l.leagueId],
                          )
                        }
                        aria-pressed={on}
                        className={`flex w-full cursor-pointer items-center justify-between rounded-lg border px-3 py-2.5 text-left transition-colors ${
                          on
                            ? "border-accent bg-accent/10"
                            : "border-border hover:bg-surface-secondary"
                        }`}
                      >
                        <div>
                          <p className="text-sm font-medium">{l.name}</p>
                          <p className="text-[11px] text-muted">{l.country}</p>
                        </div>
                        <Chip size="sm" variant="soft" color={on ? "accent" : "default"}>
                          {l.availableGames} games
                        </Chip>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <div className="flex items-end justify-between border-t border-border pt-4">
            <div>
              <p className="label">Total</p>
              <p className="display text-4xl">${priceUsd}</p>
              {kind === "extra-picks" && (
                <p className="text-xs text-muted">
                  {games} game{games === 1 ? "" : "s"} unlocked · one flat price
                </p>
              )}
            </div>
            {kind === "day-pass" && (
              <Chip size="sm" variant="soft" color="accent">
                Today only
              </Chip>
            )}
          </div>

          {stage === "auth" ? (
            <InlineAuth auth={auth} />
          ) : (
          <Button
            fullWidth
            size="lg"
            variant="primary"
            isDisabled={
              busy ||
              priceUsd === 0 ||
              (kind === "day-pass" && access?.hasFullAccess === true) ||
              (kind === "extra-picks" && !access?.hasFullAccess)
            }
            onPress={pay}
          >
            {stage === "initialising"
              ? "Starting…"
              : stage === "paying"
                ? "Processing payment…"
                : stage === "verifying"
                  ? "Confirming…"
                  : `Pay $${priceUsd}`}
          </Button>
          )}

          <div className="flex items-start gap-2 text-[11px] leading-relaxed text-muted">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 flex-none" />
            <p>
              Card details go straight to Paystack and never touch our servers.
            </p>
          </div>
        </Card.Content>
      </Card>

      <div className="flex justify-center">
        <LinkButton href="/" variant="ghost" size="sm">
          <Sparkles className="h-3.5 w-3.5" />
          Back to picks
        </LinkButton>
      </div>
    </main>
  );
}

/**
 * Sign in without leaving the payment.
 *
 * Two fields, one at a time, no headings and no card of its own — it takes the
 * place the Pay button occupied and hands it straight back. The chrome is
 * deliberately thin: this is a step inside a purchase, and dressing it up as a
 * sign-in screen would make it feel like the detour it replaced.
 *
 * There is no sign-up/sign-in choice because there is no difference.
 * requestCode sets shouldCreateUser, so an address we have never seen and one
 * we have both end at the same place: a code, then a card.
 */
function InlineAuth({ auth }: { auth: ReturnType<typeof useOtpAuth> }) {
  if (auth.step === "code") {
    return (
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          auth.verify();
        }}
      >
        <p className="text-[13px] leading-relaxed">
          Code sent to <strong className="font-semibold">{auth.email}</strong>.
        </p>

        {auth.error && <Alert status="danger">{auth.error}</Alert>}

        <div className="flex justify-center">
          <OtpCodeInput
            value={auth.code}
            onChange={auth.setCode}
            // The last digit IS the press of Pay. A button here would put a
            // step between somebody and the thing they already decided to do.
            onComplete={auth.verify}
            disabled={auth.pending}
            invalid={Boolean(auth.error)}
            autoFocus
          />
        </div>

        <Button
          fullWidth
          size="lg"
          variant="primary"
          type="submit"
          isDisabled={auth.pending}
        >
          {auth.pending ? "Checking…" : "Confirm and pay"}
        </Button>

        <button
          type="button"
          onClick={auth.restart}
          className="w-full text-center text-[12px] text-muted underline underline-offset-2"
        >
          Use a different email
        </button>
      </form>
    );
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        auth.send();
      }}
    >
      <p className="text-[13px] leading-relaxed">
        Enter your email to continue. We&rsquo;ll send a code — no password, and
        you stay on this page.
      </p>

      {auth.error && <Alert status="danger">{auth.error}</Alert>}

      <input
        type="email"
        inputMode="email"
        autoComplete="email"
        required
        autoFocus
        value={auth.email}
        onChange={(e) => auth.setEmail(e.target.value)}
        placeholder="you@example.com"
        aria-label="Email address"
        className="w-full rounded-xl border border-field-border bg-field px-3.5 py-3 text-center text-sm text-field-foreground outline-none placeholder:text-field-placeholder focus-visible:ring-2 focus-visible:ring-focus"
      />

      <Button
        fullWidth
        size="lg"
        variant="primary"
        type="submit"
        isDisabled={auth.pending}
      >
        {auth.pending ? "Sending…" : "Send code"}
      </Button>
    </form>
  );
}
