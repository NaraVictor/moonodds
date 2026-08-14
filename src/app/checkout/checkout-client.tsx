"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "@heroui/react/card";
import { Button } from "@heroui/react/button";
import { Chip } from "@heroui/react/chip";
import { Alert } from "@heroui/react/alert";
import { Skeleton } from "@heroui/react/skeleton";
import { Check, ShieldCheck, Sparkles } from "lucide-react";
import { useAccessState, useLeagueOptions } from "@/lib/queries";
import { LinkButton } from "@/components/ui/link-button";
import { extraPicksPriceUsd } from "@/lib/pricing";

type Kind = "day-pass" | "extra-picks";
type Stage = "idle" | "initialising" | "paying" | "verifying" | "done";

/**
 * Checkout.
 *
 * Two calls: POST initialises and records the reference against the buyer,
 * PATCH verifies and activates. With MOCK_PROVIDERS on there is no Paystack
 * popup — the "pay" step is simulated so the whole flow stays walkable without
 * real money moving.
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

  async function pay() {
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

      if (!initRes.ok) throw new Error(init.error ?? "Could not start checkout.");
      if (init.alreadyActive) {
        setStage("done");
        return;
      }

      // With a live Paystack key this is where the popup opens and resolves.
      setStage("paying");
      await new Promise((r) => setTimeout(r, 700));

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
  }

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
              className="bg-brand-gradient border-0 text-white"
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
        <p className="eyebrow">Checkout</p>
        <h1 className="display text-2xl">
          {kind === "day-pass" ? "Day pass" : "Extra league picks"}
        </h1>
      </header>

      {error && (
        <Alert status="danger">
          <Alert.Description>{error}</Alert.Description>
        </Alert>
      )}

      {kind === "day-pass" && access?.hasFullAccess && (
        <Alert status="success">
          <Alert.Description>
            You already have full access today — no need to buy again.
          </Alert.Description>
        </Alert>
      )}

      {kind === "extra-picks" && !access?.hasFullAccess && (
        <Alert status="warning">
          <Alert.Title>Pass holders only</Alert.Title>
          <Alert.Description>
            Extra league picks are a day-pass perk. Grab a pass first.
          </Alert.Description>
        </Alert>
      )}

      <Card>
        <Card.Content className="space-y-5 p-6">
          {kind === "extra-picks" && (
            <div className="space-y-2">
              <p className="eyebrow">Choose leagues</p>
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
              <p className="eyebrow">Total</p>
              <p className="display text-4xl">${priceUsd}</p>
              {kind === "extra-picks" && (
                <p className="text-xs text-muted">
                  {games} games · $2 per group of 3
                </p>
              )}
            </div>
            {kind === "day-pass" && (
              <Chip size="sm" variant="soft" color="accent">
                Today only
              </Chip>
            )}
          </div>

          <Button
            fullWidth
            size="lg"
            className="bg-brand-gradient border-0 text-white"
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

          <div className="flex items-start gap-2 text-[11px] leading-relaxed text-muted">
            <ShieldCheck className="mt-0.5 h-3.5 w-3.5 flex-none" />
            <p>
              Charged in GHS at the live rate. Payments are simulated while
              <code className="mx-1 font-mono">MOCK_PROVIDERS=true</code>— no
              card is taken and no money moves.
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
