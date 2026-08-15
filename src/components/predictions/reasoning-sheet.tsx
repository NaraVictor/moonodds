"use client";

import { useEffect, useState } from "react";
import { X, ChevronRight, ChevronLeft, Sparkles } from "lucide-react";
import { ConfidenceRing } from "./confidence-ring";
import { TeamCrest } from "./team-crest";
import type { Pick } from "@/lib/types";
import { formatMarket, teamName } from "@/lib/format";

/**
 * "Why this prediction?" — a stepped experience, not a text dump.
 *
 * The spec is explicit that this is the differentiator, so it's a guided walk:
 * the call → the confidence → the factors → the numbers → the conclusion. One
 * idea per step, each answerable at a glance.
 *
 * A bottom sheet on mobile, a centred dialog on desktop.
 */

const FACTOR_COPY: Record<string, { title: string; body: string }> = {
  "xg-edge": {
    title: "Expected-goals edge",
    body: "One side is creating meaningfully better chances than the scoreline suggests. Over a season that gap tends to close in their favour.",
  },
  "form-divergence": {
    title: "Form divergence",
    body: "Recent results point one way and the underlying numbers point the other. We weight the numbers.",
  },
  "h2h-strong": {
    title: "Head-to-head record",
    body: "This fixture has produced a consistent pattern across recent meetings, at this venue in particular.",
  },
  "rest-advantage": {
    title: "Rest advantage",
    body: "One side has had materially more recovery time. Legs matter most in the final twenty minutes.",
  },
  "market-drift": {
    title: "Market drift",
    body: "The price moved without the underlying picture changing. We're taking the earlier number.",
  },
  "set-piece-threat": {
    title: "Set-piece threat",
    body: "A significant share of goals here arrive from dead balls, and the matchup favours one side.",
  },
  "press-mismatch": {
    title: "Press mismatch",
    body: "One side's build-up is vulnerable to how the other presses, which tends to produce turnovers in dangerous areas.",
  },
  "keyman-out": {
    title: "Key player missing",
    body: "An absence we score as material. The listed replacement doesn't carry the same output.",
  },
  "home-fortress": {
    title: "Home record",
    body: "Home advantage is unusually pronounced for this side relative to the league average.",
  },
};

const FILTER_COPY: Record<string, string> = {
  chaosFilter: "Chaos filter — a side on a long winless run, which makes results less predictable.",
  restRule: "Rest rule — a short turnaround between fixtures.",
  keyMan: "Key man — a material absence in the expected lineup.",
  travel: "Travel — a long journey ahead of kickoff.",
  clvDrift: "Line movement — the market moved against this position after we took it.",
};

export function ReasoningSheet({
  pick,
  isOpen,
  onClose,
}: {
  pick: Pick | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (isOpen) setStep(0);
  }, [isOpen, pick?.id]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [isOpen, onClose]);

  if (!isOpen || !pick) return null;

  const factors = (pick.reasoningTags ?? [])
    .map((t) => FACTOR_COPY[t] ?? { title: t.replace(/-/g, " "), body: "" })
    .filter((f) => f.body);

  const filters = Object.entries(pick.filtersApplied ?? {})
    .filter(([, on]) => on)
    .map(([k]) => FILTER_COPY[k] ?? k);

  const steps = [
    { key: "call", label: "The call" },
    { key: "factors", label: "Key factors" },
    { key: "numbers", label: "The numbers" },
    { key: "verdict", label: "Verdict" },
  ];

  const last = step === steps.length - 1;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0"
        style={{ background: "var(--backdrop)" }}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="AI reasoning"
        className="rise relative flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-[2rem] bg-surface sm:max-w-lg sm:rounded-[2rem]"
        style={{ boxShadow: "var(--shadow-lift)" }}
      >
        {/* header */}
        <div className="flex items-start justify-between gap-3 border-b border-separator px-6 pt-6 pb-4">
          <div className="min-w-0">
            <span className="label flex items-center gap-1.5 text-accent">
              <Sparkles className="h-3 w-3" />
              AI reasoning
            </span>
            <p className="mt-1.5 truncate text-[15px] font-semibold">
              {teamName(pick.homeTeam)} v {teamName(pick.awayTeam)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close reasoning"
            className="press flex h-8 w-8 flex-none items-center justify-center rounded-full bg-surface-secondary text-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* progress */}
        <div className="flex gap-1.5 px-6 pt-4">
          {steps.map((s, i) => (
            <div key={s.key} className="flex-1">
              <div
                className="h-1 rounded-full transition-colors duration-300"
                style={{
                  background: i <= step ? "var(--accent)" : "var(--surface-tertiary)",
                }}
              />
            </div>
          ))}
        </div>
        <p className="px-6 pt-2 text-[11px] font-medium text-muted">
          Step {step + 1} of {steps.length} · {steps[step].label}
        </p>

        {/* body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {step === 0 && (
            <div className="rise space-y-5">
              <div className="flex items-center justify-center gap-6">
                <TeamCrest name={teamName(pick.homeTeam)} logo={pick.homeTeam?.logo} size={52} />
                <span className="numeral text-2xl text-muted">vs</span>
                <TeamCrest name={teamName(pick.awayTeam)} logo={pick.awayTeam?.logo} size={52} />
              </div>

              <div className="rounded-2xl bg-accent-wash p-5 text-center">
                <p className="label text-accent">We predict</p>
                <p className="display mt-1.5 text-2xl">
                  {formatMarket(pick.predictionType, pick.predictedValue)}
                </p>
              </div>

              <div className="flex items-center justify-center gap-5">
                <ConfidenceRing value={pick.confidenceScore} size={72} showLabel={false} />
                <div className="max-w-[13rem]">
                  <p className="text-sm font-semibold">
                    {Math.round(pick.confidenceScore * 10)}% AI confidence
                  </p>
                  <p className="mt-1 text-xs leading-relaxed text-muted">
                    Staked at {pick.stakingUnit} of 5 units. Confidence reflects
                    the strength of the evidence, not a promise of the outcome.
                  </p>
                </div>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="rise space-y-3">
              {factors.length ? (
                factors.map((f) => (
                  <div key={f.title} className="rounded-2xl border border-border p-4">
                    <p className="text-sm font-semibold capitalize">{f.title}</p>
                    <p className="mt-1 text-[13px] leading-relaxed text-muted">{f.body}</p>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted">
                  No individual factor dominated here — the call rests on the
                  combined weighting rather than one standout signal.
                </p>
              )}
            </div>
          )}

          {step === 2 && (
            <div className="rise space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Metric label="Confidence" value={`${Math.round(pick.confidenceScore * 10)}%`} />
                <Metric label="Stake" value={`${pick.stakingUnit}u / 5`} />
                {pick.altMarket && (
                  <Metric
                    label="Safer alternative"
                    value={formatMarket(pick.altMarket, pick.altPredictedValue ?? "")}
                    wide
                  />
                )}
              </div>

              {filters.length > 0 && (
                <div>
                  <p className="label mb-2">Filters triggered</p>
                  <ul className="space-y-2">
                    {filters.map((f) => (
                      <li
                        key={f}
                        className="flex gap-2 rounded-xl bg-surface-secondary p-3 text-[13px] leading-relaxed text-muted"
                      >
                        <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-warning" />
                        {f}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-2 text-[11px] text-muted">
                    Each of these adjusted the confidence score before the pick
                    cleared our floor.
                  </p>
                </div>
              )}
            </div>
          )}

          {step === 3 && (
            <div className="rise space-y-4">
              <p className="text-[14px] leading-relaxed">{pick.reasoning}</p>
              <div className="rounded-2xl border border-border p-4">
                <p className="label">Bottom line</p>
                <p className="mt-1.5 text-sm leading-relaxed">
                  We rate{" "}
                  <span className="font-semibold">
                    {formatMarket(pick.predictionType, pick.predictedValue)}
                  </span>{" "}
                  at {Math.round(pick.confidenceScore * 10)}% — enough edge to
                  back at {pick.stakingUnit} of 5 units.
                </p>
              </div>
              <p className="text-[11px] leading-relaxed text-muted">
                Analysis, not advice. Outcomes remain uncertain regardless of
                confidence.
              </p>
            </div>
          )}
        </div>

        {/* footer */}
        <div className="flex items-center justify-between gap-3 border-t border-separator px-6 py-4">
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={step === 0}
            className="press flex items-center gap-1 text-sm font-medium text-muted disabled:opacity-0"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </button>

          <button
            type="button"
            onClick={() => (last ? onClose() : setStep((s) => s + 1))}
            className="press flex items-center gap-1.5 rounded-full bg-accent px-5 py-2.5 text-sm font-semibold text-accent-foreground"
          >
            {last ? "Done" : "Next"}
            {!last && <ChevronRight className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={`rounded-2xl bg-surface-secondary p-4 ${wide ? "col-span-2" : ""}`}>
      <p className="label">{label}</p>
      <p className="numeral mt-1.5 text-lg">{value}</p>
    </div>
  );
}
