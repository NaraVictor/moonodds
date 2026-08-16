"use client";

import Link from "next/link";
import { Check, X, Clock } from "@/components/ui/icons";
import { TeamCrest } from "@/components/predictions/team-crest";
import type { Pick } from "@/lib/types";
import { teamShort } from "@/lib/format";

/**
 * What's happening right now.
 *
 * The board answers "what should I look at today"; this answers "what already
 * happened". Live matches first because they're the only rows that change while
 * you watch, then the most recent results, which double as evidence, since a
 * visitor deciding whether to trust the engine can see calls landing and
 * missing in real time rather than taking a headline win rate on faith.
 *
 * Deliberately compact: crest, crest, score, outcome. No reasoning, no
 * confidence, nothing to read, it's a ticker, and a ticker that needs study
 * has failed.
 */

function StatusDot({ pick }: { pick: Pick }) {
  const live = pick.fixture.status === "live";
  if (live) {
    return (
      <span
        className="inline-flex flex-none items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em]"
        style={{ color: "var(--danger)", background: "color-mix(in oklab, currentColor 12%, transparent)" }}
      >
        <span className="ping-soft relative inline-block h-1 w-1 rounded-full bg-current" />
        Live
      </span>
    );
  }

  const won = pick.status === "won";
  const lost = pick.status === "lost";
  if (!won && !lost) {
    return <Clock className="h-3 w-3 flex-none" style={{ color: "var(--muted)" }} />;
  }

  return (
    <span
      className="inline-flex h-4 w-4 flex-none items-center justify-center rounded-full"
      style={{
        background: won ? "var(--won-wash)" : "var(--lost-wash)",
        color: won ? "var(--won-ink)" : "var(--lost-ink)",
      }}
    >
      {won ? <Check className="h-2.5 w-2.5" strokeWidth={4} /> : <X className="h-2.5 w-2.5" strokeWidth={4} />}
    </span>
  );
}

function Row({ pick }: { pick: Pick }) {
  return (
    <li>
      <Link
        href={`/predictions/${pick.id}`}
        className="flex items-center gap-2.5 rounded-xl px-2 py-3.5 transition-colors hover:bg-surface-secondary"
      >
        <span className="flex flex-none items-center -space-x-1.5">
          <TeamCrest name={teamShort(pick.homeTeam)} logo={pick.homeTeam?.logo} size={20} />
          <TeamCrest name={teamShort(pick.awayTeam)} logo={pick.awayTeam?.logo} size={20} />
        </span>

        <span className="min-w-0 flex-1 truncate text-[12px] font-medium">
          {teamShort(pick.homeTeam)} v {teamShort(pick.awayTeam)}
        </span>

        <span className="numeral flex-none text-[12px] font-semibold">
          {pick.fixture.homeGoals ?? 0}&ndash;{pick.fixture.awayGoals ?? 0}
        </span>

        <StatusDot pick={pick} />
      </Link>
    </li>
  );
}

export function ActivityPanel({
  picks,
  excludeIds = [],
}: {
  picks: Pick[];
  /**
   * Picks already shown in the hero slider beside this panel. Repeating them
   * here would spend a third of the column restating what's immediately to its
   * left.
   */
  excludeIds?: string[];
}) {
  const skip = new Set(excludeIds);

  // Live first, then most recently kicked off. A finished match that ended an
  // hour ago is more interesting than one from this morning.
  const rows = [...picks]
    .filter(
      (p) =>
        !skip.has(p.id) &&
        (p.fixture.status === "live" ||
          p.status === "won" ||
          p.status === "lost"),
    )
    .sort((a, b) => {
      const liveDelta =
        Number(b.fixture.status === "live") - Number(a.fixture.status === "live");
      if (liveDelta !== 0) return liveDelta;
      return new Date(b.fixture.date).getTime() - new Date(a.fixture.date).getTime();
    })
    .slice(0, 5);

  const liveCount = rows.filter((p) => p.fixture.status === "live").length;

  return (
    <section
      className="flex h-full flex-col rounded-[1.5rem] border border-border bg-surface p-4"
      aria-label="Live and settled predictions"
    >
      <div className="mb-1 flex items-baseline justify-between gap-3 px-2">
        <h2 className="text-[13px] font-semibold">Live &amp; settled</h2>
        {liveCount > 0 && (
          <span className="numeral text-[11px]" style={{ color: "var(--danger)" }}>
            {liveCount} live
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="px-2 py-8 text-center text-[12px] text-muted">
          Nothing has kicked off yet today.
        </p>
      ) : (
        <ul className="-mx-2 flex-1 divide-y divide-separator overflow-y-auto">
          {rows.map((p) => (
            <Row key={p.id} pick={p} />
          ))}
        </ul>
      )}
    </section>
  );
}
