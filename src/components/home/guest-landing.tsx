"use client";

import Link from "next/link";
import { LinkButton } from "@/components/ui/link-button";
import { Card } from "@heroui/react/card";
import { Chip } from "@heroui/react/chip";
import { Skeleton } from "@heroui/react/skeleton";
import { Check, CheckCircle2, XCircle, Lock } from "lucide-react";
import { useEngineStats, useRecentResults } from "@/lib/queries";
import {
  confidencePercent,
  formatMarketShort,
  formatPercent,
  teamShort,
} from "@/lib/format";

const GUEST_ROW_LIMIT = 10;

const VALUE_POINTS = [
  "Fresh predictions every matchday",
  "A confidence score on every pick",
  "Plain-English reasoning you can check",
  "No subscription — pay only on the days you play",
];

export function GuestLanding() {
  const { data: results, isPending } = useRecentResults(50);
  const { data: stats } = useEngineStats();

  const won = results?.filter((r) => r.status === "won").length ?? 0;

  return (
    <div className="flex flex-col">
      {/* ---------------- hero ---------------- */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="pointer-events-none absolute inset-0 bg-grid opacity-70" />
        <div
          className="pointer-events-none absolute -top-40 left-1/2 h-[32rem] w-[64rem] -translate-x-1/2 rounded-full opacity-25 blur-3xl"
          style={{ background: "var(--brand-gradient)" }}
        />

        <div className="relative mx-auto grid w-full max-w-6xl gap-12 px-5 py-16 lg:grid-cols-[1.15fr_1fr] lg:items-center lg:py-24">
          <div className="space-y-6">
            <Chip size="sm" variant="soft" color="accent" className="font-mono">
              AI football predictions
            </Chip>

            <h1 className="display text-4xl leading-[1.05] sm:text-5xl lg:text-6xl">
              Your next winning streak{" "}
              <span className="text-brand-gradient">starts here.</span>
            </h1>

            <p className="max-w-lg text-base leading-relaxed text-muted">
              We rank every fixture, score our confidence, and explain the
              reasoning in language you can argue with. You decide what to back.
            </p>

            {stats && stats.totalPicks > 0 && (
              <div className="flex flex-wrap items-center gap-x-8 gap-y-3 pt-1">
                <Stat label="Win rate" value={formatPercent(stats.winRate)} tone="success" />
                <Stat label="Settled picks" value={String(stats.totalPicks)} />
                <Stat
                  label="ROI"
                  value={formatPercent(stats.roi)}
                  tone={stats.roi >= 0 ? "success" : "danger"}
                />
              </div>
            )}
          </div>

          {/* ---------------- pricing ---------------- */}
          <Card className="w-full max-w-md lg:ml-auto">
            <Card.Content className="space-y-5 p-6">
              <div className="space-y-1">
                <p className="eyebrow">Day pass</p>
                <p className="display text-5xl">$3</p>
                <p className="text-sm text-muted">
                  Unlocks every pick for the day. That&rsquo;s the whole pricing
                  model.
                </p>
              </div>

              <ul className="space-y-2.5">
                {VALUE_POINTS.map((point) => (
                  <li key={point} className="flex items-start gap-2.5">
                    <Check
                      className="mt-0.5 h-4 w-4 flex-none text-success"
                      strokeWidth={2.5}
                    />
                    <span className="text-sm">{point}</span>
                  </li>
                ))}
              </ul>

              <div className="space-y-2.5">
                <LinkButton href="/auth/sign-up" fullWidth size="lg" variant="gradient">
                  Start free
                </LinkButton>
                <p className="text-center text-xs text-muted">
                  2 free picks on your first day. No card needed.
                </p>
              </div>
            </Card.Content>
          </Card>
        </div>
      </section>

      {/* ---------------- track record ---------------- */}
      <section className="mx-auto w-full max-w-4xl px-5 py-14">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div>
            <p className="eyebrow">Verifiable</p>
            <h2 className="display text-2xl">Recent results</h2>
          </div>
          {results && results.length > 0 && (
            <Chip size="sm" color="success" variant="soft" className="font-mono">
              {won}/{results.length} won
            </Chip>
          )}
        </div>

        {isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-xl" />
            ))}
          </div>
        ) : !results?.length ? (
          <Card>
            <Card.Content className="p-10 text-center text-sm text-muted">
              First results land as soon as today&rsquo;s fixtures settle.
            </Card.Content>
          </Card>
        ) : (
          <div className="relative">
            <div className="overflow-hidden rounded-xl border border-border">
              <div className="grid grid-cols-[1fr_auto_auto] gap-3 border-b border-border bg-surface-secondary px-4 py-2.5 sm:grid-cols-[1fr_1fr_auto_auto]">
                <span className="eyebrow">Match</span>
                <span className="eyebrow hidden sm:block">Pick</span>
                <span className="eyebrow text-right">Conf.</span>
                <span className="eyebrow text-right">Result</span>
              </div>

              {results.slice(0, GUEST_ROW_LIMIT + 4).map((pick, i) => (
                <div
                  key={pick.id}
                  aria-hidden={i >= GUEST_ROW_LIMIT}
                  className="grid grid-cols-[1fr_auto_auto] items-center gap-3 border-b border-border/60 bg-surface px-4 py-3 last:border-0 sm:grid-cols-[1fr_1fr_auto_auto]"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {teamShort(pick.homeTeam)}{" "}
                      <span className="text-muted">v</span>{" "}
                      {teamShort(pick.awayTeam)}
                    </p>
                    <p className="truncate text-[11px] text-muted sm:hidden">
                      {formatMarketShort(pick.predictionType, pick.predictedValue)}
                    </p>
                  </div>
                  <span className="hidden font-mono text-[11px] text-muted sm:block">
                    {formatMarketShort(pick.predictionType, pick.predictedValue)}
                  </span>
                  <span className="text-right font-mono text-xs font-semibold">
                    {confidencePercent(pick.confidenceScore)}%
                  </span>
                  <span className="flex justify-end">
                    {pick.status === "won" ? (
                      <CheckCircle2 className="h-4 w-4 text-success" />
                    ) : (
                      <XCircle className="h-4 w-4 text-danger" />
                    )}
                  </span>
                </div>
              ))}
            </div>

            {results.length > GUEST_ROW_LIMIT && (
              <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-3 rounded-b-xl bg-gradient-to-t from-background via-background/95 to-transparent pb-7 pt-24 backdrop-blur-[2px]">
                <Lock className="h-4 w-4 text-muted" />
                <p className="text-sm">
                  Showing {GUEST_ROW_LIMIT} of {results.length} settled picks
                </p>
                <LinkButton href="/auth/sign-in" variant="secondary" size="sm">
                  Sign in to see the full history
                </LinkButton>
              </div>
            )}
          </div>
        )}
      </section>

      <footer className="border-t border-border px-5 py-8">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-2">
          <p className="text-xs text-muted">
            18+. Predictions are analysis, not guarantees. Never stake more than
            you can afford to lose.
          </p>
          <p className="text-xs text-muted">
            <Link href="/auth/sign-in" className="underline">
              Sign in
            </Link>{" "}
            · MoonOdds
          </p>
        </div>
      </footer>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "success" | "danger";
}) {
  const color =
    tone === "success"
      ? "text-success"
      : tone === "danger"
        ? "text-danger"
        : "text-foreground";
  return (
    <div>
      <p className={`font-mono text-2xl font-semibold leading-none ${color}`}>
        {value}
      </p>
      <p className="mt-1 text-[11px] uppercase tracking-widest text-muted">
        {label}
      </p>
    </div>
  );
}
