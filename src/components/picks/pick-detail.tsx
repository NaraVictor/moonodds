"use client";

import { Modal } from "@heroui/react/modal";
import { useOverlayState } from "@heroui/react";
import { Chip } from "@heroui/react/chip";
import { Separator } from "@heroui/react/separator";
import type { Pick } from "@/lib/types";
import {
  confidencePercent,
  formatKickoff,
  formatMarket,
  stakeLabel,
  teamName,
} from "@/lib/format";

/** Human labels for the engine's filter flags. */
const FILTER_LABELS: Record<string, string> = {
  chaosFilter: "Chaos filter",
  restRule: "Rest rule",
  keyMan: "Key man absent",
  travel: "Travel penalty",
  clvDrift: "Line moved against us",
};

export function PickDetail({
  pick,
  isOpen,
  onClose,
}: {
  pick: Pick | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  const state = useOverlayState({
    isOpen,
    onOpenChange: (open: boolean) => {
      if (!open) onClose();
    },
  });

  if (!pick) return null;

  const settled = pick.status === "won" || pick.status === "lost";
  const triggered = Object.entries(pick.filtersApplied ?? {}).filter(
    ([, on]) => on,
  );

  return (
    <Modal state={state}>
      <Modal.Backdrop>
        <Modal.Container size="lg">
          <Modal.Dialog>
        <Modal.Header>
          <Modal.Heading className="display text-xl">
            {teamName(pick.homeTeam)} <span className="text-muted">v</span>{" "}
            {teamName(pick.awayTeam)}
          </Modal.Heading>
          <p className="text-sm text-muted">
            {pick.league.name} · {pick.league.country} ·{" "}
            {settled
              ? `Final ${pick.fixture.homeGoals}–${pick.fixture.awayGoals}`
              : formatKickoff(pick.fixture.date)}
          </p>
        </Modal.Header>

        <Modal.Body className="space-y-5">
          {/* The call */}
          <div className="flex items-start justify-between gap-4 rounded-xl border border-border bg-surface-secondary p-4">
            <div className="space-y-1">
              <p className="eyebrow">The call</p>
              <p className="text-lg font-semibold">
                {formatMarket(pick.predictionType, pick.predictedValue)}
              </p>
              <p className="font-mono text-xs text-muted">
                Stake {stakeLabel(pick.stakingUnit)} of 5
              </p>
            </div>
            <div className="text-right">
              <p
                className={`font-mono text-3xl font-semibold leading-none ${
                  settled
                    ? pick.status === "won"
                      ? "text-success"
                      : "text-danger"
                    : "text-foreground"
                }`}
              >
                {confidencePercent(pick.confidenceScore)}%
              </p>
              <p className="mt-1 text-[10px] uppercase tracking-widest text-muted">
                Confidence
              </p>
            </div>
          </div>

          {/* Reasoning */}
          <div className="space-y-2">
            <p className="eyebrow">Why</p>
            <p className="text-sm leading-relaxed">{pick.reasoning}</p>
          </div>

          {pick.reasoningTags?.length ? (
            <div className="flex flex-wrap gap-1.5">
              {pick.reasoningTags.map((tag) => (
                <Chip key={tag} size="sm" variant="tertiary" className="font-mono">
                  {tag}
                </Chip>
              ))}
            </div>
          ) : null}

          {triggered.length > 0 && (
            <>
              <Separator />
              <div className="space-y-2">
                <p className="eyebrow">Filters triggered</p>
                <div className="flex flex-wrap gap-1.5">
                  {triggered.map(([key]) => (
                    <Chip key={key} size="sm" color="warning" variant="soft">
                      {FILTER_LABELS[key] ?? key}
                    </Chip>
                  ))}
                </div>
                <p className="text-xs text-muted">
                  Each triggered filter lowered the confidence score before this
                  pick cleared the floor.
                </p>
              </div>
            </>
          )}

          {pick.altMarket && (
            <>
              <Separator />
              <div className="space-y-1">
                <p className="eyebrow">Safer alternative</p>
                <p className="text-sm">
                  {formatMarket(pick.altMarket, pick.altPredictedValue ?? "")}
                  {pick.altConfidence != null && (
                    <span className="ml-2 font-mono text-xs text-muted">
                      {confidencePercent(pick.altConfidence)}%
                    </span>
                  )}
                </p>
              </div>
            </>
          )}
        </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
