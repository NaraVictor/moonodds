"use client";

import Link from "next/link";
import { Check, X, Clock, ArrowUpRight, Plus, Lock } from "@/components/ui/icons";
import { useBetSlip } from "@/lib/bet-slip";
import { ConfidenceRing } from "./confidence-ring";
import { TeamCrest } from "./team-crest";
import { isUnlocked, type Pick, type UnlockedPick } from "@/lib/types";
import { formatMarket, matchClock, teamName } from "@/lib/format";

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

/**
 * How long after kickoff a match is certainly over.
 *
 * Ninety minutes plus stoppage, half time and the walk to the tunnel. The same
 * figure runAutoGrade uses to decide a fixture is overdue for a result, and it
 * should stay the same figure: this is the label for the window between "the
 * grader would now be interested" and "the grader has actually run".
 */
const CERTAINLY_FINISHED_MS = 2.5 * 60 * 60 * 1000;

/**
 * The clock, not the feed.
 *
 * This read `fixture.status` and nothing else, so it inherited every staleness
 * in the upstream feed. A fixture whose status never moved off `scheduled` —
 * because nothing fetched the result — kept rendering "Starts 6:45 pm" three
 * hours after 6:45 pm, in the future tense, next to a PENDING badge. The card
 * was not merely out of date, it was making a claim about the future that the
 * reader could see was false by glancing at their own clock.
 *
 * Kickoff time is known locally and needs no feed. So the status is trusted
 * where it is informative and the clock is used where it is not: a kickoff in
 * the past is never "Starts", whatever the row says.
 */
export function timing(pick: Pick, now: number = Date.now()): string {
  const d = new Date(pick.fixture.date);
  const start = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true });

  if (pick.fixture.status === "finished") return "Full time";
  if (pick.fixture.status === "live") return `Kicked off ${start}`;

  const since = now - d.getTime();
  if (since >= CERTAINLY_FINISHED_MS) return "Awaiting result";
  if (since > 0) return `Kicked off ${start}`;

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
  // Only for a fixture the feed says is in progress. matchClock returns null
  // where there is no minute to show, and the kickoff line takes over.
  const clock = pick.fixture.status === "live" ? matchClock(pick.fixture) : null;
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
          {/*
            A live fixture shows the minute, and shows it LOUDLY.

            The kickoff time is the one fact a viewer watching a match already
            has; the minute is the one they want, and at 10px in muted grey it
            would read as the same incidental metadata it replaced. So it takes
            the live treatment — larger, bold, and in the live red the pulsing
            dot already uses, so the two read as one indicator.
          */}
          {clock ? (
            <span
              className="numeral whitespace-nowrap text-[15px] font-bold leading-none"
              style={{ color: "var(--lost-ink)" }}
              aria-label={`Live, ${clock.replace("'", " minutes")}`}
            >
              {clock}
            </span>
          ) : (
            <span className="whitespace-nowrap text-[10px] font-medium" style={{ color: subtleInk }}>
              {timing(pick)}
            </span>
          )}
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
          /*
            A score behind frosted glass, not an empty padlock.
            
            The lock alone read as "nothing here" — a locked card looked like a
            card that had failed to load, which is why people scrolled past
            rather than tapping. A blurred ring reads as withheld: there is
            clearly a value, and clearly you cannot have it yet.
            
            THE BLUR IS DECORATION, NOT A CONTROL. There is no real number under
            it — confidence_score is not in the locked payload and must never be
            added to it, because CSS blur is readable by anyone who opens the
            inspector. The arc below is a fixed placeholder, so it reveals
            nothing about the actual call.
          */
          <span className="relative flex h-[54px] w-[54px] flex-none items-center justify-center">
            <span
              aria-hidden
              className="absolute inset-0 rounded-full blur-[5px]"
              style={{
                background: `conic-gradient(${
                  feature ? "rgba(255,255,255,0.55)" : "var(--accent)"
                } 0turn 0.62turn, ${
                  feature ? "rgba(255,255,255,0.10)" : "var(--accent-wash)"
                } 0.62turn 1turn)`,
                mask: "radial-gradient(circle, transparent 58%, #000 59%)",
                WebkitMask: "radial-gradient(circle, transparent 58%, #000 59%)",
              }}
            />
            <span
              className="relative flex h-9 w-9 items-center justify-center rounded-full"
              style={{
                background: feature ? "rgba(255,255,255,0.12)" : "var(--surface)",
                color: feature ? "#fff" : "var(--accent)",
              }}
            >
              <Lock className="h-3.5 w-3.5" strokeWidth={2.5} />
            </span>
            <span className="sr-only">Confidence hidden until unlocked</span>
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
            {/* Visible at rest, brighter on hover. It was opacity-0 until hover,
                which on a phone means never — and the arrow is the only thing
                on the card saying it leads somewhere. */}
            <ArrowUpRight className="h-3.5 w-3.5 opacity-50 transition-opacity duration-200 group-hover:opacity-100" />
          </button>
        ) : (
          /*
            Filled, not a tinted word. On a locked card this is the only thing
            worth pressing, and as plain accent text it carried the same weight
            as "Summary" on an unlocked one — so the two cards looked equally
            finished and neither invited a tap.

            No price on it. It used to name one, on the reasoning that "Unlock"
            alone makes the reader go and find out what it costs — but a board
            is a grid of these, so the same $3 was repeated down the page a
            dozen times, which reads as a product asking rather than offering.
            The price is stated once, on the paywall panel under the board.
          */
          <Link
            href="/checkout/day-pass"
            className="press flex flex-1 items-center justify-center gap-1.5 px-4 py-3.5 text-[12px] font-semibold"
            style={{
              background: feature ? "rgba(255,255,255,0.14)" : "var(--accent)",
              color: feature ? "#fff" : "var(--accent-foreground)",
            }}
          >
            <Lock className="h-3.5 w-3.5" />
            Unlock today
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
