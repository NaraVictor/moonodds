"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowDown, ArrowUp, Check, Lock, Plus } from "lucide-react";
import { useBetSlip } from "@/lib/bet-slip";
import { TeamCrest } from "@/components/predictions/team-crest";
import { isUnlocked, type Pick } from "@/lib/types";
import { confidencePercent, formatMarket, teamName } from "@/lib/format";

/**
 * The board as a table.
 *
 * For the reader who is comparing rather than browsing — scanning forty calls
 * for the two with the best confidence-to-price ratio is miserable in cards and
 * trivial in a table. Kept deliberately plain: no zebra striping, no borders
 * between every cell, one hover tint. The data is the texture.
 *
 * Sorting is client-side because the whole board is already in memory; going
 * back to the server to reorder rows we hold would add latency for nothing.
 */

type SortKey = "kickoff" | "confidence" | "league" | "match" | "odds";
type Dir = "asc" | "desc";

const COLUMNS: { key: SortKey; label: string; align?: "right"; sortable: boolean }[] = [
  { key: "match", label: "Match", sortable: true },
  { key: "league", label: "League", sortable: true },
  { key: "kickoff", label: "Kickoff", sortable: true },
  { key: "confidence", label: "Confidence", align: "right", sortable: true },
  { key: "odds", label: "Price", align: "right", sortable: true },
];

export function PicksTable({ picks }: { picks: Pick[] }) {
  const [sort, setSort] = useState<SortKey>("confidence");
  const [dir, setDir] = useState<Dir>("desc");
  const slip = useBetSlip();

  function toggle(key: SortKey) {
    if (key === sort) {
      setDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSort(key);
      // Text reads best A–Z; figures read best highest-first.
      setDir(key === "match" || key === "league" ? "asc" : "desc");
    }
  }

  const rows = useMemo(() => {
    const sign = dir === "asc" ? 1 : -1;
    return [...picks].sort((a, b) => {
      switch (sort) {
        case "match":
          return sign * teamName(a.homeTeam).localeCompare(teamName(b.homeTeam));
        case "league":
          return sign * (a.league.name ?? "").localeCompare(b.league.name ?? "");
        case "kickoff":
          return sign * (new Date(a.fixture.date).getTime() - new Date(b.fixture.date).getTime());
        case "odds":
          return sign * ((a.odds ?? 0) - (b.odds ?? 0));
        default:
          return sign * ((a.confidenceScore ?? -1) - (b.confidenceScore ?? -1));
      }
    });
  }, [picks, sort, dir]);

  if (!picks.length) return null;

  return (
    <div
      className="overflow-hidden rounded-[1.5rem] border border-border bg-surface"
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] border-collapse text-left">
          <caption className="sr-only">
            Today&rsquo;s predictions, sortable by match, league, kickoff,
            confidence and price
          </caption>
          <thead>
            <tr className="border-b border-separator">
              {COLUMNS.map((c) => {
                const active = sort === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
                    className={`px-4 py-3 text-[11px] font-bold uppercase tracking-[0.08em] ${
                      c.align === "right" ? "text-right" : ""
                    }`}
                    style={{ color: "var(--muted)" }}
                  >
                    <button
                      type="button"
                      onClick={() => toggle(c.key)}
                      className={`inline-flex items-center gap-1 hover:text-foreground ${
                        c.align === "right" ? "flex-row-reverse" : ""
                      }`}
                      style={{ color: active ? "var(--foreground)" : undefined }}
                    >
                      {c.label}
                      {active &&
                        (dir === "asc" ? (
                          <ArrowUp className="h-3 w-3" />
                        ) : (
                          <ArrowDown className="h-3 w-3" />
                        ))}
                    </button>
                  </th>
                );
              })}
              <th scope="col" className="px-4 py-3">
                <span className="sr-only">Add to slip</span>
              </th>
            </tr>
          </thead>

          <tbody>
            {rows.map((p) => {
              const unlocked = isUnlocked(p);
              const settled = p.status === "won" || p.status === "lost";
              const addable = unlocked && !settled && p.fixture.status === "scheduled";
              const inSlip = slip.has(p.id);

              return (
                <tr
                  key={p.id}
                  className="group border-b border-separator transition-colors last:border-b-0 hover:bg-surface-secondary"
                >
                  <td className="px-4 py-3">
                    <Link href={`/predictions/${p.id}`} className="flex items-center gap-2.5">
                      <span className="flex flex-none items-center -space-x-2">
                        <TeamCrest name={teamName(p.homeTeam)} logo={p.homeTeam?.logo} size={24} />
                        <TeamCrest name={teamName(p.awayTeam)} logo={p.awayTeam?.logo} size={24} />
                      </span>
                      <span className="min-w-0">
                        <span className="block truncate text-[13px] font-semibold">
                          {teamName(p.homeTeam)} v {teamName(p.awayTeam)}
                        </span>
                        <span
                          className="block truncate text-[11px]"
                          style={{ color: unlocked ? "var(--accent)" : "var(--muted)" }}
                        >
                          {unlocked ? (
                            formatMarket(p.predictionType, p.predictedValue)
                          ) : (
                            <span className="inline-flex items-center gap-1">
                              <Lock className="h-2.5 w-2.5" />
                              {formatMarket(p.predictionType)}
                            </span>
                          )}
                        </span>
                      </span>
                    </Link>
                  </td>

                  <td className="px-4 py-3">
                    <span className="text-[12px] text-muted">{p.league.name}</span>
                  </td>

                  <td className="px-4 py-3">
                    <span className="numeral text-[12px] text-muted">
                      {new Date(p.fixture.date).toLocaleTimeString([], {
                        hour: "numeric",
                        minute: "2-digit",
                        hour12: true,
                      })}
                    </span>
                  </td>

                  <td className="px-4 py-3 text-right">
                    {unlocked ? (
                      <span
                        className="numeral text-[13px] font-semibold"
                        style={{
                          color:
                            p.status === "won"
                              ? "var(--won-ink)"
                              : p.status === "lost"
                                ? "var(--lost-ink)"
                                : "var(--foreground)",
                        }}
                      >
                        {confidencePercent(p.confidenceScore)}%
                      </span>
                    ) : (
                      <span className="text-[13px] text-muted">—</span>
                    )}
                  </td>

                  <td className="px-4 py-3 text-right">
                    <span className="numeral text-[13px]">
                      {p.odds != null ? p.odds.toFixed(2) : "—"}
                    </span>
                  </td>

                  <td className="px-4 py-3 text-right">
                    {addable ? (
                      <button
                        type="button"
                        onClick={() => (inSlip ? slip.remove(p.id) : slip.add(p))}
                        aria-pressed={inSlip}
                        aria-label={
                          inSlip
                            ? `Remove ${teamName(p.homeTeam)} v ${teamName(p.awayTeam)} from slip`
                            : `Add ${teamName(p.homeTeam)} v ${teamName(p.awayTeam)} to slip`
                        }
                        className="press inline-flex h-8 w-8 items-center justify-center rounded-full border"
                        style={
                          inSlip
                            ? {
                                borderColor: "transparent",
                                background: "var(--accent-wash)",
                                color: "var(--accent)",
                              }
                            : { borderColor: "var(--border)", color: "var(--muted)" }
                        }
                      >
                        {inSlip ? (
                          <Check className="h-3.5 w-3.5" strokeWidth={3} />
                        ) : (
                          <Plus className="h-3.5 w-3.5" strokeWidth={2.5} />
                        )}
                      </button>
                    ) : (
                      <span className="text-[11px] text-muted">
                        {settled ? p.status : ""}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
