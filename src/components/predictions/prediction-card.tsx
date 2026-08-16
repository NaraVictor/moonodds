"use client";

import Link from "next/link";
import { Check, X, Clock, ArrowUpRight, Plus, Lock } from "@/components/ui/icons";
import { useBetSlip } from "@/lib/bet-slip";
import { ConfidenceRing } from "./confidence-ring";
import { TeamCrest } from "./team-crest";
import { isUnlocked, type Pick, type UnlockedPick } from "@/lib/types";
import { formatMarket, teamName } from "@/lib/format";

/**
 * The prediction card.
 *
 * Kalshi's restraint, not its semantics. Their market cards work because almost
 * everything is quiet, one number carries the weight and the rest recedes, so
 * the borrowing here is the calm, the generous whitespace and the way actions
 * sit present but unshouted. What is NOT borrowed is the language of a traded
 * market: no price ticks, no payout multiples, no order book. A confidence
 * score is a model's opinion, and dressing it as a tradeable probability would
 * imply a market we don't run.
 *
 * The whole card is a link to the detail page, via a stretched overlay rather
 * than by wrapping everything in an anchor, that keeps the two CTAs as real
 * buttons instead of nesting interactive elements inside a link, which breaks
 * both keyboard nav and the accessibility tree.
 */

type Status = "won" | "lost" | "pending";

function resolveStatus(pick: Pick): Status {
  if (pick.status === "won") return "won";
  if (pick.status === "lost") return "lost";
  return "pending";
}

const STATE = {
  won: { cls: "state-won", ink: "var(--won-ink)", Icon: Check, label: "Won", tone: "won" as const },
  lost: { cls: "state-lost", ink: "var(--lost-ink)", Icon: X, label: "Lost", tone: "lost" as const },
  pending: { cls: "state-pending", ink: "var(--pending-ink)", Icon: Clock, label: "Pending", tone: "accent" as const },
};

function StatusPill({ status }: { status: Status }) {
  const s = STATE[status];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]"
      style={{ color: s.ink, background: "color-mix(in oklab, currentColor 10%, transparent)" }}
    >
      <s.Icon className="h-3 w-3" strokeWidth={3} />
      {s.label}
    </span>
  );
}

function timing(pick: Pick): string {
  const d = new Date(pick.fixture.date);
  const start = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });
  if (pick.fixture.status === "finished") return "Full time";
  if (pick.fixture.status === "live") return `Kicked off ${start}`;
  return `Starts ${start}`;
}

export function PredictionCard({
  pick,
  onSummary,
  feature = false,
}: {
  pick: Pick;
  /** Opens the summary modal. Only ever called with an unlocked pick. */
  onSummary?: (p: UnlockedPick) => void;
  /** The dark treatment used by the hero slider. */
  feature?: boolean;
}) {
  const status = resolveStatus(pick);
  const s = STATE[status];
  const settled = status !== "pending";
  const live = pick.fixture.status === "live";
  const unlocked = isUnlocked(pick);

  const slip = useBetSlip();
  const inSlip = slip.has(pick.id);
  // Only an unlocked, unsettled, not-yet-started call can go on a slip: you
  // can't take a pre-match price on a match already running.
  const addable = unlocked && !settled && pick.fixture.status === "scheduled";

  const shell = feature
    ? "bg-feature text-feature-foreground border-transparent"
    : `${s.cls} border`;
  const subtleInk = feature ? "var(--feature-muted)" : "var(--muted)";
  const strongInk = feature ? "#fff" : "var(--foreground)";

  return (
    <article
      className={`lift group relative flex flex-col overflow-hidden rounded-[1.5rem] transition-colors ${shell}`}
    >
      {/* Stretched link: the card body navigates, the CTAs below opt out. */}
      <Link
        href={`/predictions/${pick.id}`}
        className="absolute inset-0 z-0"
        aria-label={`${teamName(pick.homeTeam)} versus ${teamName(pick.awayTeam)}, full analysis`}
      />

      {/* ---------- header ---------- */}
      <div className="flex items-center justify-between gap-3 px-5 pt-5">
        <div className="flex min-w-0 items-center gap-2">
          {pick.league.logo && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={pick.league.logo} alt="" width={16} height={16} className="h-4 w-4 flex-none object-contain" />
          )}
          <span className="truncate text-[12px] font-semibold" style={{ color: subtleInk }}>
            {pick.league.name}
          </span>
        </div>

        {live ? (
          <span
            className="inline-flex flex-none items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]"
            style={{ color: "var(--danger)", background: "color-mix(in oklab, currentColor 12%, transparent)" }}
          >
            <span className="ping-soft relative inline-block h-1.5 w-1.5 rounded-full bg-current" />
            Live
          </span>
        ) : (
          <StatusPill status={status} />
        )}
      </div>

      {/* ---------- match ---------- */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2 px-5 py-6">
        {[pick.homeTeam, pick.awayTeam].map((team, i) => (
          <div
            key={i}
            className={`flex flex-col items-center gap-2.5 text-center ${i === 1 ? "order-3" : ""}`}
          >
            <TeamCrest name={teamName(team)} logo={team?.logo} size={52} onFeature={feature} />
            <span
              className="line-clamp-2 text-[13px] font-semibold leading-tight"
              style={{ color: strongInk }}
            >
              {teamName(team)}
            </span>
          </div>
        ))}

        <div className="order-2 flex min-w-[4.5rem] flex-col items-center gap-1 pt-3">
          {settled || live ? (
            <span className="numeral text-[2rem] leading-none" style={{ color: strongInk }}>
              {pick.fixture.homeGoals ?? 0}
              <span style={{ color: subtleInk }} className="mx-1 font-normal">
                :
              </span>
              {pick.fixture.awayGoals ?? 0}
            </span>
          ) : (
            <span className="text-[11px] font-bold uppercase tracking-[0.12em]" style={{ color: subtleInk }}>
              vs
            </span>
          )}
          <span className="whitespace-nowrap text-[10px] font-medium" style={{ color: subtleInk }}>
            {timing(pick)}
          </span>
        </div>
      </div>

      {/* ---------- the call ----------
          py matches the crest block's py-6, so the panel sits on the same
          vertical rhythm as the match above it rather than looking pinched. */}
      <div
        className="mx-auto flex w-[90%] items-center justify-between gap-4 rounded-2xl px-4 py-[1.425rem]"
        style={{
          background: feature
            ? "rgba(255,255,255,0.06)"
            : "color-mix(in oklab, var(--foreground) 3.5%, transparent)",
        }}
      >
        <div className="min-w-0">
          <p
            className="text-[10px] font-bold uppercase tracking-[0.12em]"
            style={{ color: feature ? "var(--feature-muted)" : "var(--accent)" }}
          >
            {unlocked ? "AI prediction" : "Locked"}
          </p>
          <p className="display mt-1.5 truncate text-[1.25rem]" style={{ color: strongInk }}>
            {formatMarket(pick.predictionType, pick.predictedValue)}
          </p>
          {!unlocked && (
            <p className="mt-1 text-[11px]" style={{ color: subtleInk }}>
              Unlock to see the call
            </p>
          )}
        </div>

        {unlocked ? (
          <ConfidenceRing
            value={pick.confidenceScore}
            tone={feature ? "feature" : s.tone}
            size={54}
          />
        ) : (
          <span
            className="flex h-[54px] w-[54px] flex-none items-center justify-center rounded-full"
            style={{
              background: feature ? "rgba(255,255,255,0.08)" : "var(--accent-wash)",
              color: feature ? "#fff" : "var(--accent)",
            }}
          >
            <Lock className="h-4 w-4" strokeWidth={2.5} />
          </span>
        )}
      </div>

      {/* ---------- actions ----------
          Present but quiet at rest; they gain contrast on hover and always on
          keyboard focus, so they never become a hover-only affordance. */}
      <div
        className="relative z-10 mt-3 flex items-stretch border-t"
        style={{ borderColor: feature ? "var(--feature-border)" : "var(--separator)" }}
      >
        {unlocked ? (
          <button
            type="button"
            onClick={() => onSummary?.(pick)}
            className="press flex flex-1 items-center justify-center gap-1.5 px-4 py-3.5 text-[12px] font-semibold transition-colors"
            style={{ color: subtleInk }}
          >
            Summary
            <ArrowUpRight className="h-3.5 w-3.5 opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
          </button>
        ) : (
          <Link
            href="/checkout/day-pass"
            className="press flex flex-1 items-center justify-center gap-1.5 px-4 py-3.5 text-[12px] font-semibold"
            style={{ color: feature ? "#fff" : "var(--accent)" }}
          >
            <Lock className="h-3.5 w-3.5" />
            Unlock
          </Link>
        )}

        {addable && (
          <button
            type="button"
            onClick={() => (inSlip ? slip.remove(pick.id) : slip.add(pick))}
            aria-pressed={inSlip}
            className="press flex flex-1 items-center justify-center gap-1.5 border-l px-4 py-3.5 text-[12px] font-semibold transition-colors"
            style={{
              borderColor: feature ? "var(--feature-border)" : "var(--separator)",
              color: inSlip ? (feature ? "#fff" : "var(--accent)") : subtleInk,
              background: inSlip
                ? feature
                  ? "rgba(255,255,255,0.06)"
                  : "var(--accent-wash)"
                : "transparent",
            }}
          >
            {inSlip ? (
              <>
                <Check className="h-3.5 w-3.5" strokeWidth={3} />
                In slip
              </>
            ) : (
              <>
                <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                Add to slip
              </>
            )}
          </button>
        )}
      </div>
    </article>
  );
}
