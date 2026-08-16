"use client";

import Link from "next/link";
import { Radio, ArrowRight } from "@/components/ui/icons";
import { TeamCrest } from "@/components/predictions/team-crest";
import type { Pick } from "@/lib/types";
import { teamShort, formatMarketShort } from "@/lib/format";

/**
 * The Live Board.
 *
 * Matches in play, and nothing else. It used to also carry recent results,
 * which made it a mixed feed: the settled rows never changed while you watched,
 * so the one thing a live panel is for, motion, was diluted by history that now
 * has a page of its own.
 *
 * The panel is a fixed height, matching the slider beside it. That is the grid
 * doing the work (`xl:items-stretch` on the parent, `h-full` here), so the two
 * columns stay level however many matches are in play. `min-h-0` on the list is
 * what keeps a long list scrolling inside the panel rather than stretching the
 * row and pushing the slider taller than it should be.
 */

function LiveRow({ pick }: { pick: Pick }) {
  return (
    <li>
      <Link
        href={`/predictions/${pick.id}`}
        className="flex items-center gap-3 rounded-xl px-2 py-4 transition-colors hover:bg-surface-secondary"
      >
        <span className="flex flex-none items-center -space-x-1.5">
          <TeamCrest name={teamShort(pick.homeTeam)} logo={pick.homeTeam?.logo} size={22} />
          <TeamCrest name={teamShort(pick.awayTeam)} logo={pick.awayTeam?.logo} size={22} />
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium leading-tight">
            {teamShort(pick.homeTeam)} v {teamShort(pick.awayTeam)}
          </span>
          <span className="mt-1 block truncate text-[11px] leading-tight text-muted">
            {pick.predictionType
              ? formatMarketShort(pick.predictionType, pick.predictedValue ?? "")
              : "Market withheld"}
          </span>
        </span>

        <span className="flex flex-none items-center gap-2.5">
          <span className="numeral text-[13px] font-semibold">
            {pick.fixture.homeGoals ?? 0}&ndash;{pick.fixture.awayGoals ?? 0}
          </span>
          <span
            className="inline-flex flex-none items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.08em]"
            style={{
              color: "var(--danger)",
              background: "color-mix(in oklab, currentColor 12%, transparent)",
            }}
          >
            <span className="ping-soft relative inline-block h-1 w-1 rounded-full bg-current" />
            Live
          </span>
        </span>
      </Link>
    </li>
  );
}

/**
 * Nothing in play.
 *
 * This is the panel's usual state for most of the day, not an edge case, so it
 * gets a designed answer rather than a line of grey text: a quiet pitch motif,
 * a sentence that says what to do with the wait, and a way out to the record.
 */
function NoLiveGames() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-8 text-center">
      <span className="relative mb-5 flex h-16 w-16 items-center justify-center">
        {/* Concentric rings reading as a stilled broadcast pulse. */}
        <span
          className="absolute inset-0 rounded-full"
          style={{ background: "color-mix(in oklab, var(--muted) 7%, transparent)" }}
        />
        <span
          className="absolute inset-[0.6rem] rounded-full"
          style={{ background: "color-mix(in oklab, var(--muted) 9%, transparent)" }}
        />
        <Radio
          className="relative h-6 w-6"
          strokeWidth={1.5}
          style={{ color: "var(--muted)" }}
        />
      </span>

      <p className="text-[13px] font-semibold">No games in play</p>
      <p className="mx-auto mt-1.5 max-w-[15rem] text-[12px] leading-relaxed text-muted">
        Kick-offs light this panel up as they happen. Until then, the record is
        the more interesting read.
      </p>

      <Link
        href="/history"
        className="press mt-5 inline-flex items-center gap-1.5 rounded-full border border-border px-3.5 py-2 text-[12px] font-semibold transition-colors hover:bg-surface-secondary"
      >
        See how calls settled
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>
    </div>
  );
}

export function LiveBoard({ picks }: { picks: Pick[] }) {
  // Live only. Most recent kick-off first, so the match that just started sits
  // at the top rather than buried under one in its 80th minute.
  const rows = picks
    .filter((p) => p.fixture.status === "live")
    .sort(
      (a, b) =>
        new Date(b.fixture.date).getTime() - new Date(a.fixture.date).getTime(),
    );

  return (
    <section
      className="flex h-full min-h-[22rem] flex-col rounded-[1.5rem] border border-border bg-surface p-4"
      aria-label="Live board"
    >
      <div className="mb-1 flex flex-none items-baseline justify-between gap-3 px-2">
        <h2 className="text-[13px] font-semibold">Live Board</h2>
        {rows.length > 0 && (
          <span className="numeral text-[11px]" style={{ color: "var(--danger)" }}>
            {rows.length} live
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <NoLiveGames />
      ) : (
        // min-h-0 is load-bearing: without it a flex child refuses to shrink
        // below its content, the list stretches the grid row, and the panel
        // stops matching the slider it is meant to sit level with.
        <ul className="scroll-subtle -mx-2 min-h-0 flex-1 divide-y divide-separator overflow-y-auto">
          {rows.map((p) => (
            <LiveRow key={p.id} pick={p} />
          ))}
        </ul>
      )}
    </section>
  );
}
