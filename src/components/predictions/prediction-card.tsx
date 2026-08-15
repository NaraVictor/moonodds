"use client";

import { Check, X, Clock, MapPin, ArrowRight, Plus } from "lucide-react";
import { useBetSlip } from "@/lib/bet-slip";
import { ConfidenceRing } from "./confidence-ring";
import { TeamCrest } from "./team-crest";
import type { Pick } from "@/lib/types";
import { formatMarket, teamName } from "@/lib/format";

/**
 * The prediction card — the hero component of MoonOdds.
 *
 * Scannable in 2–3 seconds, answering in this order:
 *   what match → what do we predict → how confident → when/what happened
 *
 * Layout is mobile-first and genuinely re-laid-out at width rather than
 * shrunk: crests sit either side of the scoreline on every size, and the
 * prediction band spans full width so it can never be missed.
 *
 * Outcome state is carried by a tinted wash plus a 1px edge — never by
 * saturating the whole card, which would fight the team names and score.
 */

type Status = "won" | "lost" | "pending";

function resolveStatus(pick: Pick): Status {
  if (pick.status === "won") return "won";
  if (pick.status === "lost") return "lost";
  return "pending";
}

const STATE = {
  won: {
    cls: "state-won",
    ink: "var(--won-ink)",
    Icon: Check,
    label: "Won",
    tone: "won" as const,
  },
  lost: {
    cls: "state-lost",
    ink: "var(--lost-ink)",
    Icon: X,
    label: "Lost",
    tone: "lost" as const,
  },
  pending: {
    cls: "state-pending",
    ink: "var(--pending-ink)",
    Icon: Clock,
    label: "Pending",
    tone: "accent" as const,
  },
};

function StatusPill({ status }: { status: Status }) {
  const s = STATE[status];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]"
      style={{
        color: s.ink,
        background: "color-mix(in oklab, currentColor 10%, transparent)",
      }}
    >
      <s.Icon className="h-3 w-3" strokeWidth={3} />
      {s.label}
    </span>
  );
}

/** Kickoff, or the window the match actually ran. */
function timing(pick: Pick): string {
  const d = new Date(pick.fixture.date);
  const start = d.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  if (pick.fixture.status === "finished") {
    const end = new Date(d.getTime() + 105 * 60_000).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    return `${start} — ${end}`;
  }
  if (pick.fixture.status === "live") return `Kicked off ${start}`;
  return `Starts ${start}`;
}

export function PredictionCard({
  pick,
  onReasoning,
  feature = false,
}: {
  pick: Pick;
  onReasoning?: (p: Pick) => void;
  /** The dark treatment used for the single hero card. */
  feature?: boolean;
}) {
  const status = resolveStatus(pick);
  const s = STATE[status];
  const settled = status !== "pending";
  const live = pick.fixture.status === "live";
  const slip = useBetSlip();
  const inSlip = slip.has(pick.id);
  // Only an unsettled, not-yet-kicked-off call can be added.
  const addable = !settled && pick.fixture.status === "scheduled";

  const shell = feature
    ? "bg-feature text-feature-foreground border-transparent"
    : `${s.cls} border`;

  const subtleInk = feature ? "var(--feature-muted)" : "var(--muted)";

  return (
    <article
      className={`lift group relative flex flex-col overflow-hidden rounded-[1.75rem] ${shell}`}
      style={{ boxShadow: feature ? "var(--shadow-lift)" : "var(--shadow-card)" }}
    >
      {/* ---------- header: league · location ---------- */}
      <div className="flex items-start justify-between gap-3 px-5 pt-5">
        <div className="min-w-0">
          <p
            className="truncate text-[13px] font-semibold"
            style={{ color: feature ? "#fff" : "var(--foreground)" }}
          >
            {pick.league.name}
          </p>
          <p
            className="mt-0.5 flex items-center gap-1 truncate text-[11px]"
            style={{ color: subtleInk }}
          >
            <MapPin className="h-3 w-3 flex-none" />
            {pick.league.country}
            {pick.fixture.venue ? ` · ${pick.fixture.venue}` : ""}
          </p>
        </div>

        <div className="flex flex-none items-center gap-2">
          {live && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]"
              style={{ color: "var(--danger)", background: "color-mix(in oklab, currentColor 12%, transparent)" }}
            >
              <span className="ping-soft relative inline-block h-1.5 w-1.5 rounded-full bg-current" />
              Live
            </span>
          )}
          {!live && <StatusPill status={status} />}
        </div>
      </div>

      {/* ---------- match: crests dominate ---------- */}
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-5 py-6">
        <div className="flex flex-col items-center gap-2.5 text-center">
          <TeamCrest
            name={teamName(pick.homeTeam)}
            logo={pick.homeTeam?.logo}
            size={64}
            onFeature={feature}
          />
          <span
            className="line-clamp-2 text-[13px] font-semibold leading-tight"
            style={{ color: feature ? "#fff" : "var(--foreground)" }}
          >
            {teamName(pick.homeTeam)}
          </span>
        </div>

        <div className="flex min-w-[5rem] flex-col items-center gap-1.5">
          {settled || live ? (
            <span
              className="numeral text-[2.75rem]"
              style={{ color: feature ? "#fff" : "var(--foreground)" }}
            >
              {pick.fixture.homeGoals ?? 0}
              <span style={{ color: subtleInk }} className="mx-1.5 font-normal">
                :
              </span>
              {pick.fixture.awayGoals ?? 0}
            </span>
          ) : (
            <span
              className="numeral text-[1.6rem]"
              style={{ color: feature ? "#fff" : "var(--foreground)" }}
            >
              VS
            </span>
          )}

          <span
            className="whitespace-nowrap text-[10px] font-medium"
            style={{ color: subtleInk }}
          >
            {timing(pick)}
          </span>
        </div>

        <div className="flex flex-col items-center gap-2.5 text-center">
          <TeamCrest
            name={teamName(pick.awayTeam)}
            logo={pick.awayTeam?.logo}
            size={64}
            onFeature={feature}
          />
          <span
            className="line-clamp-2 text-[13px] font-semibold leading-tight"
            style={{ color: feature ? "#fff" : "var(--foreground)" }}
          >
            {teamName(pick.awayTeam)}
          </span>
        </div>
      </div>

      {/* ---------- the call + confidence ---------- */}
      <div
        className="mx-3 flex items-center justify-between gap-4 rounded-2xl px-4 py-3.5"
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
            AI prediction
          </p>
          <p
            className="display mt-1 truncate text-[1.35rem]"
            style={{ color: feature ? "#fff" : "var(--foreground)" }}
          >
            {formatMarket(pick.predictionType, pick.predictedValue)}
          </p>
        </div>

        <ConfidenceRing
          value={pick.confidenceScore}
          tone={feature ? "feature" : s.tone}
          size={56}
        />
      </div>

      {/* ---------- actions ---------- */}
      <div
        className="mt-3 flex items-stretch border-t"
        style={{ borderColor: feature ? "var(--feature-border)" : "var(--separator)" }}
      >
        <button
          type="button"
          onClick={() => onReasoning?.(pick)}
          className="press flex flex-1 items-center justify-between gap-2 px-5 py-4 text-left"
        >
          <span
            className="text-[13px] font-semibold"
            style={{ color: feature ? "#fff" : "var(--foreground)" }}
          >
            Why this prediction?
          </span>
          <span
            className="flex h-7 w-7 items-center justify-center rounded-full transition-transform duration-200 group-hover:translate-x-0.5"
            style={{
              background: feature ? "rgba(255,255,255,0.1)" : "var(--accent-wash)",
              color: feature ? "#fff" : "var(--accent)",
            }}
          >
            <ArrowRight className="h-3.5 w-3.5" strokeWidth={2.5} />
          </span>
        </button>

        {addable && (
          <button
            type="button"
            onClick={() => (inSlip ? slip.remove(pick.id) : slip.add(pick))}
            aria-pressed={inSlip}
            className="press flex flex-none items-center gap-1.5 border-l px-5 text-[13px] font-semibold"
            style={{
              borderColor: feature ? "var(--feature-border)" : "var(--separator)",
              color: inSlip
                ? feature ? "#fff" : "var(--accent)"
                : feature ? "var(--feature-muted)" : "var(--muted)",
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
                Add
              </>
            )}
          </button>
        )}
      </div>
    </article>
  );
}

/**
 * The locked variant.
 *
 * Renders the real card SHAPE so a visitor can see the substance they're
 * missing — but from placeholder geometry, not real data. Nothing about the
 * hidden predictions is sent to the browser, so this can't be lifted by
 * opening devtools the way a CSS blur over real content could.
 */
export function LockedPredictionCard({ seed = 0 }: { seed?: number }) {
  const bars = [
    [58, 40],
    [46, 52],
  ][seed % 2];

  return (
    <article
      aria-hidden
      className="relative flex select-none flex-col overflow-hidden rounded-[1.75rem] border state-pending"
      style={{ boxShadow: "var(--shadow-card)" }}
    >
      <div className="pointer-events-none blur-[7px] saturate-50" aria-hidden>
        <div className="flex items-start justify-between gap-3 px-5 pt-5">
          <div className="space-y-1.5">
            <div className="h-3 rounded-full bg-surface-tertiary" style={{ width: `${bars[0]}px` }} />
            <div className="h-2.5 w-20 rounded-full bg-surface-secondary" />
          </div>
          <div className="h-5 w-16 rounded-full bg-surface-tertiary" />
        </div>

        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-5 py-6">
          {[0, 1].map((i) => (
            <div key={i} className="flex flex-col items-center gap-2.5">
              <div className="h-16 w-16 rounded-full bg-surface-tertiary" />
              <div className="h-3 rounded-full bg-surface-secondary" style={{ width: `${bars[i]}px` }} />
            </div>
          ))}
          <div
            className="order-2 flex flex-col items-center gap-1.5"
            style={{ gridColumn: 2, gridRow: 1 }}
          >
            <div className="h-8 w-20 rounded-lg bg-surface-tertiary" />
            <div className="h-2 w-14 rounded-full bg-surface-secondary" />
          </div>
        </div>

        <div className="mx-3 flex items-center justify-between gap-4 rounded-2xl bg-surface-secondary px-4 py-3.5">
          <div className="space-y-2">
            <div className="h-2.5 w-16 rounded-full bg-surface-tertiary" />
            <div className="h-5 w-40 rounded-lg bg-surface-tertiary" />
          </div>
          <div className="h-14 w-14 rounded-full bg-surface-tertiary" />
        </div>

        <div className="mt-3 border-t border-separator px-5 py-4">
          <div className="h-3 w-36 rounded-full bg-surface-secondary" />
        </div>
      </div>

      {/* A veil, not an opaque block — the shape stays legible underneath. */}
      <div
        className="absolute inset-0"
        style={{ background: "var(--lock-veil)" }}
      />
    </article>
  );
}
