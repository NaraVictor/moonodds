"use client";

import { useEffect } from "react";
import Link from "next/link";
import { ArrowUpRight, Check, Plus, X } from "@/components/ui/icons";
import { usePredictionDetail } from "@/lib/queries";
import { useBetSlip } from "@/lib/bet-slip";
import { ConfidenceRing } from "./confidence-ring";
import { TeamCrest } from "./team-crest";
import type { UnlockedPick } from "@/lib/types";
import { confidencePercent, formatMarket, teamName } from "@/lib/format";

/**
 * The summary.
 *
 * One view, not the four-step walkthrough this replaces. Stepping through
 * panels made a reader work for information they wanted at a glance, and the
 * only thing a summary owes them is enough to decide: what we called, how sure
 * we are, why, and how the two sides compare.
 *
 * Structured after the match-details reference: a dark header carrying the
 * fixture, then centred comparison rows reading home-figure / label /
 * away-figure. Those rows show the season and head-to-head numbers we actually
 * hold rather than the in-play stats the reference used — we have no live feed
 * for shots or possession, and inventing rows for them would be decoration.
 *
 * Anything deeper belongs on the detail page, which this links to rather than
 * duplicates.
 */

/** home-figure · label · away-figure, the reference's centred comparison row. */
function CompareRow({
  label,
  home,
  away,
  format = (n: number) => String(n),
}: {
  label: string;
  home: number | null | undefined;
  away: number | null | undefined;
  format?: (n: number) => string;
}) {
  if (home == null && away == null) return null;
  return (
    <div className="grid grid-cols-[3rem_1fr_3rem] items-center gap-3 py-2.5">
      <span className="numeral text-left text-[15px] font-semibold">
        {home == null ? "—" : format(home)}
      </span>
      <span className="text-center text-[12px] text-muted">{label}</span>
      <span className="numeral text-right text-[15px] font-semibold">
        {away == null ? "—" : format(away)}
      </span>
    </div>
  );
}

export function PredictionSummary({
  pick,
  isOpen,
  onClose,
}: {
  pick: UnlockedPick | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  const { data } = usePredictionDetail(pick?.id ?? "");
  const slip = useBetSlip();

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

  const stats = data?.stats ?? null;
  const h = stats?.homeSeason ?? {};
  const a = stats?.awaySeason ?? {};
  const settled = pick.status === "won" || pick.status === "lost";
  const live = pick.fixture.status === "live";
  const inSlip = slip.has(pick.id);
  const addable = !settled && pick.fixture.status === "scheduled";

  const kickoff = new Date(pick.fixture.date);
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const two = (n: number) => n.toFixed(2);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close summary"
        onClick={onClose}
        className="absolute inset-0"
        style={{ background: "var(--backdrop)" }}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Prediction summary"
        className="rise relative flex max-h-[92vh] w-full flex-col overflow-y-auto rounded-t-[2rem] bg-surface pb-2 sm:max-w-md sm:rounded-[2rem]"
        style={{ boxShadow: "var(--shadow-lift)" }}
      >
        {/* ---------------- dark fixture header ---------------- */}
        <header className="relative m-2 rounded-[1.5rem] bg-feature px-5 pb-6 pt-5 text-feature-foreground">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              {pick.league.logo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={pick.league.logo} alt="" width={16} height={16} className="h-4 w-4 flex-none object-contain" />
              )}
              <span className="truncate text-[13px] font-semibold">{pick.league.name}</span>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="press flex h-7 w-7 flex-none items-center justify-center rounded-full"
              style={{ background: "rgba(255,255,255,0.1)" }}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-5 grid grid-cols-[1fr_auto_1fr] items-center gap-3">
            {[pick.homeTeam, pick.awayTeam].map((team, i) => (
              <div key={i} className={`flex flex-col items-center gap-2 text-center ${i === 1 ? "order-3" : ""}`}>
                <TeamCrest name={teamName(team)} logo={team?.logo} size={48} onFeature />
                <span className="line-clamp-1 text-[12px] font-semibold">{teamName(team)}</span>
              </div>
            ))}
            <div className="order-2 flex flex-col items-center gap-1">
              {settled || live ? (
                <span className="numeral text-[2rem] leading-none">
                  {pick.fixture.homeGoals ?? 0}
                  <span style={{ color: "var(--feature-muted)" }} className="mx-1.5 font-normal">
                    :
                  </span>
                  {pick.fixture.awayGoals ?? 0}
                </span>
              ) : (
                <span className="numeral text-[1.5rem] leading-none">
                  {kickoff.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true })}
                </span>
              )}
              <span className="text-[10px]" style={{ color: "var(--feature-muted)" }}>
                {settled ? "Full time" : live ? "Live" : "Kickoff"}
              </span>
            </div>
          </div>
        </header>

        {/* ---------------- the call ---------------- */}
        <div className="flex items-center gap-4 px-6 pt-4">
          <ConfidenceRing value={pick.confidenceScore} tone="accent" size={64} />
          <div className="min-w-0">
            <p className="text-[10px] font-bold uppercase tracking-[0.12em]" style={{ color: "var(--accent)" }}>
              We predict
            </p>
            <p className="display mt-1 text-[1.35rem] leading-tight">
              {formatMarket(pick.predictionType, pick.predictedValue)}
            </p>
            <p className="mt-1 text-[12px] text-muted">
              {confidencePercent(pick.confidenceScore)}% confidence · staked{" "}
              {pick.stakingUnit} of 5 units
            </p>
          </div>
        </div>

        {/* ---------------- reasoning ---------------- */}
        <div className="px-6 pt-5">
          <p className="label">Why</p>
          <p className="mt-2 text-[13px] leading-relaxed">{pick.reasoning}</p>
        </div>

        {/* ---------------- comparison ---------------- */}
        <div className="px-6 pt-6">
          <p className="text-center text-[15px] font-semibold">Match details</p>
          <div className="mt-2 divide-y divide-separator">
            <CompareRow label="Goals scored / game" home={h.avgGoalsScored} away={a.avgGoalsScored} format={two} />
            <CompareRow label="Goals conceded / game" home={h.avgGoalsConceded} away={a.avgGoalsConceded} format={two} />
            <CompareRow label="Clean sheets" home={h.cleanSheetRate} away={a.cleanSheetRate} format={pct} />
            <CompareRow label="Both teams scored" home={h.bttsRate} away={a.bttsRate} format={pct} />
            <CompareRow label="Wins this season" home={h.wins} away={a.wins} />
          </div>
        </div>

        {/* ---------------- head to head ---------------- */}
        {stats && (
          <div className="px-6 pt-6">
            <p className="text-center text-[15px] font-semibold">Head to head</p>
            <div className="mt-3 flex items-center justify-center gap-4">
              <TeamCrest name={teamName(pick.homeTeam)} logo={pick.homeTeam?.logo} size={36} />
              {[
                { n: stats.h2hHomeWins ?? 0, l: "Wins" },
                { n: stats.h2hDraws ?? 0, l: "Draw" },
                { n: stats.h2hAwayWins ?? 0, l: "Wins" },
              ].map((x, i) => (
                <div
                  key={i}
                  className={`px-4 text-center ${i === 1 ? "border-x border-separator" : ""}`}
                >
                  <p className="numeral text-xl">{x.n}</p>
                  <p className="label mt-0.5">{x.l}</p>
                </div>
              ))}
              <TeamCrest name={teamName(pick.awayTeam)} logo={pick.awayTeam?.logo} size={36} />
            </div>
          </div>
        )}

        {/* ---------------- actions ---------------- */}
        <div className="sticky bottom-0 mt-6 flex gap-2 border-t border-separator bg-surface px-6 py-4">
          <Link
            href={`/predictions/${pick.id}`}
            onClick={onClose}
            className="press flex h-12 flex-1 items-center justify-center gap-1.5 rounded-full border border-border text-[13px] font-semibold"
          >
            See details
            <ArrowUpRight className="h-3.5 w-3.5" />
          </Link>

          {addable && (
            <button
              type="button"
              onClick={() => (inSlip ? slip.remove(pick.id) : slip.add(pick))}
              aria-pressed={inSlip}
              className="press flex h-12 flex-1 items-center justify-center gap-1.5 rounded-full text-[13px] font-semibold"
              style={
                inSlip
                  ? { background: "var(--accent-wash)", color: "var(--accent)" }
                  : { background: "var(--accent)", color: "var(--accent-foreground)" }
              }
            >
              {inSlip ? (
                <>
                  <Check className="h-4 w-4" strokeWidth={3} />
                  In slip
                </>
              ) : (
                <>
                  <Plus className="h-4 w-4" strokeWidth={2.5} />
                  Add to slip
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
