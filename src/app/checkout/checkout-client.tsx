"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "@heroui/react/card";
import { Button } from "@heroui/react/button";
import { Chip } from "@heroui/react/chip";
import { Alert } from "@/components/ui/alert";
import { Skeleton } from "@heroui/react/skeleton";
import { Check, Sparkles } from "@/components/ui/icons";
import { useAccessState, useExtraPicksOffer } from "@/lib/queries";
import { LinkButton } from "@/components/ui/link-button";
import { PASS_PLANS, perDayUsd, freeDays, type PassPlan, extraPicksPriceUsd ,
} from "@/lib/pricing";
import posthog from "posthog-js";
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
  // Set by the init call when every one of today's games has kicked off, so
  // the pass the server will issue is tomorrow's. See the day-pass route.
  const [forTomorrow, setForTomorrow] = useState(false);
  /*
   * Opens on the week, not the day.
   *
   * The badge argues for it; the default is what most people accept. Standard
   * for a better-value tier, and defensible here because the cheaper option is
   * directly above it, priced, one tap away — nobody is hidden from the $3.
   */
  const [plan, setPlan] = useState<PassPlan>("week");

  const offer = useExtraPicksOffer(kind === "extra-picks");

  // The buyer no longer chooses. What is on offer is however many the operator
  // set an unlock to deal, capped by what is actually left in today's basket —
  // so the page never quotes a number it cannot hand over.
  const games = Math.min(
    offer.data?.available ?? 0,
    offer.data?.unlockSize ?? 0,
  );
  const priceUsd = kind === "day-pass" ? PASS_PLANS[plan].usd : extraPicksPriceUsd(games);

  const endpoint =
    kind === "day-pass" ? "/api/checkout/day-pass" : "/api/checkout/extra-picks";

  const pay = useCallback(async () => {
    setError(null);
    setStage("initialising");
    posthog.capture("checkout_started", { kind, price_usd: priceUsd });

    try {
      const initRes = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Extras: no body, the games are drawn server-side. Day pass: the
        // chosen plan, which the route re-reads from PASS_PLANS rather than
        // trusting any price the browser might send.
        body: kind === "day-pass" ? JSON.stringify({ plan }) : undefined,
      });
      const init = await initRes.json();
      setForTomorrow(init.forTomorrow === true);

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
          posthog.capture("checkout_cancelled", { kind, price_usd: priceUsd });
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
      posthog.capture("checkout_completed", { kind, price_usd: priceUsd });
      setStage("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setStage("idle");
    }
  }, [endpoint, kind, qc, priceUsd, plan]);

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
          {/*
            Neither "Day pass" nor "Week pass": both are on sale here and the
            default is the week, so a page headed "Day pass" over a $10 total
            was contradicting itself before anybody read the options.
          */}
          {kind === "day-pass" ? "Board access" : "Extra picks"}
        </h1>
      </header>

      {error && (
        <Alert status="danger">
          {error}
        </Alert>
      )}

      {/*
        Offers the extension rather than closing the door.
        
        This used to read "no need to buy again", which was true when a day was
        the only thing on sale and became a contradiction the moment a week
        appeared underneath it: a week bought today extends PAST the day
        already held — activate_daily_pass skips days you own — so there is
        something worth buying, and the banner was talking a customer out of it.
      */}
      {kind === "day-pass" && access?.hasFullAccess && (
        <Alert status="success">
          You have today covered. A week pass adds {PASS_PLANS.week.days} more
          days on top of it.
        </Alert>
      )}

      {kind === "extra-picks" && !access?.hasFullAccess && (
        <Alert status="warning" title="Pass holders only">
          Extra picks are a day-pass perk. Grab a pass first.
        </Alert>
      )}

      <Card>
        <Card.Content className="space-y-5 p-6">
          {kind === "extra-picks" && (
            <div className="space-y-2">
              <p className="label">What you get</p>
              {offer.isPending ? (
                <Skeleton className="h-20 rounded-lg" />
              ) : games === 0 ? (
                <p className="py-4 text-center text-sm text-muted">
                  {offer.data?.owned
                    ? "You've already unlocked every extra game available today."
                    : "No extra games today — everything the engine published is already on the board."}
                </p>
              ) : (
                <div className="rounded-lg border border-border p-4">
                  <p className="text-sm">
                    <span className="font-semibold">{games} more call{games === 1 ? "" : "s"}</span>{" "}
                    from today&rsquo;s board, on top of the {offer.data?.owned ? "ones you already hold" : "free picks"}.
                  </p>
                  {/*
                    Said plainly, because it is the part a buyer would
                    otherwise discover afterwards and feel misled by. They are
                    dealt, not chosen — and the reason is worth one sentence:
                    everyone picking from the same list would mean the same few
                    games sell every day.
                  */}
                  <p className="mt-1.5 text-[11px] leading-relaxed text-muted">
                    Dealt from the games that just missed the board, strongest first.
                    You don&rsquo;t choose them, and no two unlocks are the same.
                  </p>
                </div>
              )}
            </div>
          )}

          {/*
            Three lengths, and the longer two lead on what they save.

            One pass a day is not an expensive product, it is an expensive
            habit: somebody who wants this every morning was being asked for
            roughly $90 a month, one transaction at a time, each with its own
            moment to reconsider. The price per day was never the obstacle. The
            decision per day was.
          */}
          {kind === "day-pass" && (
            <div className="space-y-2">
              <p className="label">How long</p>
              {(Object.keys(PASS_PLANS) as PassPlan[]).map((key) => {
                const p = PASS_PLANS[key];
                const on = plan === key;
                const free = freeDays(key);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setPlan(key)}
                    aria-pressed={on}
                    className={`flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl border px-3.5 py-3 text-left transition-colors ${
                      on ? "border-accent bg-accent/10" : "border-border hover:bg-surface-secondary"
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[13px] font-semibold">{p.label}</span>
                        {/*
                          The saving as DAYS, not a percentage. "57% less" is a
                          number to work out; "3 days free" is the same fact in
                          the unit the product is sold in.
                        */}
                        {free > 0 && (
                          <span
                            /*
                              Ink on the badge, not green.
                              
                              The selected row is tinted with accent/10, so a
                              green wash sat on a green field and the one
                              element whose job is to be noticed was the
                              hardest thing on the card to read. Foreground on
                              surface is the highest-contrast pair the palette
                              has, and it inverts with the theme — light badge
                              on dark in dark mode — where a fixed black would
                              disappear.
                              
                              Not yellow, though it was the other option: the
                              MoMo mark at the foot of this same card is
                              already yellow, and a second one here would read
                              as related to it.
                            */
                            className="rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em]"
                            style={{ background: "var(--foreground)", color: "var(--surface)" }}
                          >
                            {free} days free
                          </span>
                        )}
                      </span>
                      <span className="block text-[11px] text-muted">
                        {p.blurb}
                        {free > 0 && ` $${perDayUsd(key).toFixed(2)} a day.`}
                      </span>
                    </span>
                    <span className="numeral flex-none text-[15px] font-semibold">${p.usd}</span>
                  </button>
                );
              })}
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
                {plan === "day"
                  ? forTomorrow
                    ? "Tomorrow"
                    : "Today only"
                  : `${PASS_PLANS[plan].days} days`}
              </Chip>
            )}
          </div>

          {/*
            Said before the money moves, not after.

            The pass rolls to tomorrow when nothing is left to kick off today —
            which is the right outcome, but finding out afterwards feels like a
            mistake rather than a courtesy. Only rendered once the server has
            told us, so it never guesses.
          */}
          {forTomorrow && (
            <p
              className="rounded-lg p-3 text-[12px] leading-relaxed"
              style={{ background: "var(--accent-wash)", color: "var(--foreground)" }}
            >
              Every game on today&rsquo;s board has already kicked off, so this
              pass starts <strong>tomorrow</strong>
              {plan === "day"
                ? " — a full day rather than the rest of tonight."
                : ` — ${PASS_PLANS[plan].days} full days rather than the rest of tonight.`}{" "}
              Today&rsquo;s results are on the record either way.
            </p>
          )}

          {stage === "auth" ? (
            <InlineAuth auth={auth} />
          ) : (
          <Button
            fullWidth
            size="lg"
            variant="primary"
            /*
             * Holding today blocks the DAY, not the page.
             *
             * This disabled the button for the whole day-pass checkout
             * whenever the caller already had access — correct when a day was
             * the only thing on sale, and wrong the moment a week appeared
             * under it. The banner above says a week adds seven more days on
             * top, the week is the default selection, and the button beneath
             * both was greyed out: the screen invited a purchase it would not
             * let anybody make.
             *
             * A week bought today genuinely extends past the day already held
             * — activate_daily_pass skips days you own — so only the day plan
             * has nothing to sell.
             */
            isDisabled={
              busy ||
              priceUsd === 0 ||
              (kind === "day-pass" && plan === "day" && access?.hasFullAccess === true) ||
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

          {/*
            What we take, shown rather than described.

            This line used to explain that card details go to Paystack and not
            to us. True, and reassuring to about one reader in fifty — the rest
            were being told how the plumbing works at the moment they wanted to
            know whether they could pay with MoMo. In Ghana that is the first
            question, not the last.

            Marks under the sentence rather than beside it. Inline, they read
            as bullets on the line and competed with the words for the same
            glance; underneath, the sentence makes the claim and the logos
            settle it — which is the order somebody actually reads them in.

            Plain <img>, not next/image: these are two fixed-size SVGs on a
            page that already has a payment provider to load, and putting them
            through the optimiser would buy nothing at all.
          */}
          <div className="space-y-2 text-center">
            <p className="text-[11px] leading-relaxed text-muted">
              We accept card or MoMo payments
            </p>
            <div className="flex items-center justify-center gap-2.5">
              {/*
                Sized to the MARKS, not to the files.

                Visa's card sits on a square canvas and fills 63% of its
                height; MoMo's yellow field fills all of its own. Given the
                same height attribute the Visa card would render two thirds the
                size of the MoMo one and read as the lesser option, which is
                not a thing to imply about how somebody can pay. So the heights
                are set so both marks stand 20px tall, and Visa's transparent
                padding takes up the difference invisibly.
              */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/pay/visa.png" alt="Visa" width={32} height={32} />
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/pay/momo.png" alt="MoMo" width={43} height={20} />
            </div>
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
        <p className="text-center text-[13px] leading-relaxed">
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
