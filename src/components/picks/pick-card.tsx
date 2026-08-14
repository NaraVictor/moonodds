"use client";

import { Card } from "@heroui/react/card";
import { Chip } from "@heroui/react/chip";
import { Button } from "@heroui/react/button";
import { CheckCircle2, XCircle, Radio, Plus } from "lucide-react";
import type { Pick } from "@/lib/types";
import {
  confidencePercent,
  formatKickoff,
  formatMarket,
  formatMarketShort,
  stakeLabel,
  teamName,
} from "@/lib/format";

/**
 * Confidence is the single most important number on the card, so it gets the
 * mono face, the largest size, and a colour that encodes the outcome once the
 * pick has settled.
 */
function ConfidenceDial({ pick }: { pick: Pick }) {
  const pct = confidencePercent(pick.confidenceScore);
  const tone =
    pick.status === "won"
      ? "text-success"
      : pick.status === "lost"
        ? "text-danger"
        : "text-foreground";

  return (
    <div className="flex flex-col items-end">
      <span className={`font-mono text-2xl font-semibold leading-none ${tone}`}>
        {pct}
        <span className="text-sm text-muted">%</span>
      </span>
      <span className="mt-1 font-mono text-[10px] uppercase tracking-widest text-muted">
        {stakeLabel(pick.stakingUnit)}
      </span>
    </div>
  );
}

function StatusMark({ status }: { status: Pick["status"] }) {
  if (status === "won")
    return (
      <span className="inline-flex items-center gap-1 text-success">
        <CheckCircle2 className="h-4 w-4" />
        <span className="text-xs font-semibold">Won</span>
      </span>
    );
  if (status === "lost")
    return (
      <span className="inline-flex items-center gap-1 text-danger">
        <XCircle className="h-4 w-4" />
        <span className="text-xs font-semibold">Lost</span>
      </span>
    );
  return null;
}

export function PickCard({
  pick,
  onOpen,
  onAddToSlip,
  inSlip = false,
}: {
  pick: Pick;
  onOpen?: (p: Pick) => void;
  onAddToSlip?: (p: Pick) => void;
  inSlip?: boolean;
}) {
  const isLive = pick.fixture.status === "live";
  const settled = pick.status === "won" || pick.status === "lost";

  return (
    <Card className="group transition-colors hover:border-elevated">
      <Card.Content className="flex flex-col gap-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[11px] text-muted">
                {pick.league.name}
              </span>
              {isLive && (
                <span className="inline-flex items-center gap-1 text-accent">
                  <Radio className="h-3 w-3 animate-pulse" />
                  <span className="text-[10px] font-semibold uppercase tracking-wider">
                    Live
                  </span>
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={() => onOpen?.(pick)}
              className="mt-0.5 block w-full cursor-pointer text-left"
            >
              <span className="block truncate text-[0.95rem] font-semibold leading-snug">
                {teamName(pick.homeTeam)}{" "}
                <span className="text-muted">v</span>{" "}
                {teamName(pick.awayTeam)}
              </span>
            </button>

            <div className="mt-1 flex items-center gap-2 text-[11px] text-muted">
              {settled ? (
                <span className="font-mono">
                  {pick.fixture.homeGoals}–{pick.fixture.awayGoals}
                </span>
              ) : (
                <span className="font-mono">
                  {formatKickoff(pick.fixture.date)}
                </span>
              )}
              <StatusMark status={pick.status} />
            </div>
          </div>

          <ConfidenceDial pick={pick} />
        </div>

        <div className="flex items-center gap-2">
          <Chip
            size="sm"
            variant="soft"
            color={settled ? (pick.status === "won" ? "success" : "danger") : "accent"}
            className="font-mono"
          >
            {formatMarketShort(pick.predictionType, pick.predictedValue)}
          </Chip>
          <span className="truncate text-xs text-muted">
            {formatMarket(pick.predictionType, pick.predictedValue)}
          </span>
        </div>

        <p className="line-clamp-2 text-xs leading-relaxed text-muted">
          {pick.reasoning}
        </p>

        <div className="flex items-center gap-2 pt-0.5">
          <Button size="sm" variant="ghost" onPress={() => onOpen?.(pick)}>
            Why this pick
          </Button>
          {onAddToSlip && !settled && (
            <Button
              size="sm"
              variant={inSlip ? "tertiary" : "secondary"}
              isDisabled={inSlip}
              className="ml-auto"
              onPress={() => onAddToSlip(pick)}
            >
              {inSlip ? (
                "In slip"
              ) : (
                <>
                  <Plus className="h-3.5 w-3.5" />
                  Add
                </>
              )}
            </Button>
          )}
        </div>
      </Card.Content>
    </Card>
  );
}
