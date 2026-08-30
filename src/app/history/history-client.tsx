"use client";

import { useState } from "react";
import Link from "next/link";
import {
  usePredictionHistory,
  useHistoryStats,
  useHistoryFacets,
  useClvSummary,
  useTipsterPerformance,
  type HistoryFilters,
} from "@/lib/queries";
import { TeamCrest } from "@/components/predictions/team-crest";
import { Check, X, Clock, ChevronLeft, ChevronRight, BarChart3 } from "@/components/ui/icons";
import {
  MARKET_LABELS,
  formatMarketShort,
  formatPercent,
  formatSigned,
  teamShort,
} from "@/lib/format";
import type { Market, Pick } from "@/lib/types";

/**
 * The record, in full.
 *
 * Two things a visitor wants before trusting a prediction: how often has this
 * been right, and can I check. The stats answer the first, the table answers
 * the second, and the table is deliberately the larger of the two, because a
 * headline number with nothing under it is the shape of every tipster site
 * that has ever overstated itself.
 */

const OUTCOMES = [
  { id: null, label: "All" },
  { id: "won", label: "Won" },
  { id: "lost", label: "Lost" },
  { id: "void", label: "Void" },
] as const;

function OutcomeBadge({ status }: { status: Pick["status"] }) {
  if (status === "won") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em]"
        style={{ background: "var(--won-wash)", color: "var(--won-ink)" }}
      >
        <Check className="h-2.5 w-2.5" strokeWidth={4} />
        Won
      </span>
    );
  }
  if (status === "lost") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em]"
        style={{ background: "var(--lost-wash)", color: "var(--lost-ink)" }}
      >
        <X className="h-2.5 w-2.5" strokeWidth={4} />
        Lost
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em]"
      style={{ background: "var(--surface-secondary)", color: "var(--muted)" }}
    >
      <Clock className="h-2.5 w-2.5" strokeWidth={3} />
      Void
    </span>
  );
}

function StatsPanel({ filters }: { filters: HistoryFilters }) {
  const { data: stats, isPending } = useHistoryStats(filters);

  // Only league and market reach the numbers. See useHistoryStats.
  const narrowing = [filters.league, filters.market].filter(Boolean) as string[];
  const narrowed = narrowing.length > 0;

  if (isPending) {
    return <div className="shimmer mb-8 h-40 rounded-[1.5rem] bg-surface" />;
  }
  /*
   * A filter that matches nothing gets a sentence, not a blank.
   *
   * Returning null here was right when these numbers covered the whole record
   * — no record, nothing to say. Now that they follow the filters, the same
   * null means the panel silently disappears when someone picks a league with
   * no settled calls, and the page looks broken rather than empty.
   */
  if (!stats) return null;
  if (stats.settled === 0) {
    return narrowed ? (
      <section aria-label="Historical performance" className="mb-8">
        <p className="rounded-[1.25rem] border border-border bg-surface p-5 text-[13px] text-muted">
          Nothing has settled in this view yet.
        </p>
      </section>
    ) : null;
  }

  const tiles: {
    label: string;
    value: string;
    ink?: string;
    note?: string | null;
  }[] = [
    {
      label: "Win rate",
      value: stats.winRate == null ? "-" : formatPercent(stats.winRate),
      ink: stats.winRate != null && stats.winRate >= 0.5 ? "var(--success)" : undefined,
      // A point estimate on a young record reads as a promise. The interval is
      // what turns it back into evidence.
      note:
        stats.winRateInterval?.low != null && stats.winRateInterval?.high != null
          ? `${formatPercent(stats.winRateInterval.low, 0)} to ${formatPercent(stats.winRateInterval.high, 0)}`
          : null,
    },
    {
      label: "Return",
      value: stats.roi == null ? "-" : formatSigned(stats.roi),
      ink:
        stats.roi == null
          ? undefined
          : stats.roi >= 0
            ? "var(--success)"
            : "var(--danger)",
    },
    { label: "Settled calls", value: String(stats.settled) },
    { label: "Average price", value: stats.avgOdds == null ? "-" : stats.avgOdds.toFixed(2) },
  ];

  const best = stats.byMarket.length
    ? [...stats.byMarket].sort((a, b) => b.winRate - a.winRate)[0]
    : null;

  return (
    <section aria-label="Historical performance" className="mb-8">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <div
            key={t.label}
            className="rounded-[1.25rem] border border-border bg-surface p-5"
          >
            <dd
              className="numeral text-2xl sm:text-3xl"
              style={t.ink ? { color: t.ink } : undefined}
            >
              {t.value}
            </dd>
            <dt className="label mt-1.5">{t.label}</dt>
            {t.note && (
              <p className="numeral mt-1 text-[11px] text-muted">{t.note}</p>
            )}
          </div>
        ))}
      </dl>

      {/*
        Says what the numbers are OF.

        They follow the league and market filters now, so a headline that drops
        from 81% to 64% needs to name the reason on the same screen — otherwise
        it reads as the record having changed rather than the question.
      */}
      {narrowed && (
        <p className="mt-3 text-[12px] leading-relaxed">
          <span className="font-semibold">{narrowing.join(" · ")}</span>
          <span className="text-muted">
            {" "}— {stats.settled} settled call{stats.settled === 1 ? "" : "s"}.
            {filters.outcome
              ? " Rates cover every outcome; the tabs filter the list below."
              : ""}
          </span>
        </p>
      )}

      {stats.winRateInterval?.low != null && (
        <p className="mt-3 text-[11px] leading-relaxed text-muted">
          The range under the win rate is the 95% confidence interval on{" "}
          <span className="numeral">{stats.settled}</span> settled calls. It is
          the honest width of the claim: with this much evidence the true rate
          is very likely somewhere in that band, not exactly the headline
          figure. It narrows as the record grows.
        </p>
      )}


      <ClvPanel />

      {/*
        Behind a press, because it is reference rather than headline.
        
        Most people reading this page want one number and the list of results.
        The market breakdown is what you open when that number has raised a
        question — so it sits closed, says how much is in it, and opens on
        demand. <details> rather than state: it works before hydration and the
        browser handles the semantics.
      */}
      {stats.byMarket.length > 0 && (
        <details className="group mt-3 rounded-[1.25rem] border border-border bg-surface p-5">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
            <span className="text-[13px] font-semibold">
              By market
              <span className="ml-2 font-normal text-muted">
                {stats.byMarket.length} market{stats.byMarket.length === 1 ? "" : "s"}
              </span>
            </span>
            <span className="text-[11px] font-semibold text-muted transition-transform group-open:rotate-180">
              ▾
            </span>
          </summary>
          <div className="mb-4 mt-4 flex items-baseline justify-between gap-3">
            {best && (
              <p className="text-[11px] text-muted">
                Strongest:{" "}
                <span className="font-semibold text-foreground">
                  {MARKET_LABELS[best.market as Market] ?? best.market}
                </span>
              </p>
            )}
          </div>

          <ul className="space-y-3">
            {stats.byMarket.map((m) => (
              <li key={m.market} className="flex items-center gap-3">
                <span className="w-36 flex-none truncate text-[12px] sm:w-44">
                  {MARKET_LABELS[m.market as Market] ?? m.market}
                </span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface-secondary">
                  <span
                    className="block h-full rounded-full"
                    style={{
                      width: `${Math.round(m.winRate * 100)}%`,
                      background:
                        m.winRate >= 0.5 ? "var(--success)" : "var(--danger)",
                    }}
                  />
                </span>
                <span className="numeral w-12 flex-none text-right text-[12px]">
                  {formatPercent(m.winRate, 0)}
                </span>
                <span className="numeral w-10 flex-none text-right text-[11px] text-muted">
                  {m.settled}
                </span>
              </li>
            ))}
          </ul>

          <p className="mt-4 text-[11px] leading-relaxed text-muted">
            Return assumes one flat unit staked per settled call, returned at
            the price the pick was taken at. Voids are excluded from win rate: a
            refunded stake is neither a win nor a loss.
          </p>
        </details>
      )}
    </section>
  );
}

function HistoryRow({ pick }: { pick: Pick }) {
  const settledOn = pick.settledAt ?? pick.fixture.date;

  return (
    <li>
      <Link
        href={`/predictions/${pick.id}`}
        className="flex items-center gap-3 px-4 py-4 transition-colors hover:bg-surface-secondary sm:px-5"
      >
        <span className="flex flex-none items-center -space-x-1.5">
          <TeamCrest name={teamShort(pick.homeTeam)} logo={pick.homeTeam?.logo} size={26} />
          <TeamCrest name={teamShort(pick.awayTeam)} logo={pick.awayTeam?.logo} size={26} />
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold leading-tight">
            {teamShort(pick.homeTeam)} v {teamShort(pick.awayTeam)}
          </span>
          <span className="mt-1 block truncate text-[11px] leading-tight text-muted">
            {pick.league?.name} ·{" "}
            {new Date(settledOn).toLocaleDateString(undefined, {
              day: "numeric",
              month: "short",
              year: "numeric",
            })}
          </span>
        </span>

        <span className="hidden min-w-0 flex-none sm:block sm:w-44">
          <span className="block truncate text-[12px] font-medium">
            {pick.predictionType
              ? formatMarketShort(pick.predictionType, pick.predictedValue ?? "")
              : "Market withheld"}
          </span>
          <span className="mt-1 block text-[11px] text-muted">
            {pick.odds != null && (
              <span className="numeral">{Number(pick.odds).toFixed(2)}</span>
            )}
          </span>
        </span>

        <span className="numeral hidden w-12 flex-none text-right text-[13px] font-semibold md:block">
          {pick.fixture.homeGoals ?? "-"}&ndash;{pick.fixture.awayGoals ?? "-"}
        </span>

        <span className="flex-none">
          <OutcomeBadge status={pick.status} />
        </span>
      </Link>
    </li>
  );
}

export function HistoryClient() {
  const [page, setPage] = useState(0);
  const [filters, setFilters] = useState<HistoryFilters>({});
  const { data, isPending, isPlaceholderData } = usePredictionHistory(page, filters);
  const { data: facets } = useHistoryFacets();

  function update(next: HistoryFilters) {
    setFilters((f) => ({ ...f, ...next }));
    setPage(0);
  }

  const rows = data?.rows ?? [];
  const total = data?.total ?? 0;
  const pageSize = data?.limit ?? 24;
  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, total);

  return (
    <main className="mx-auto w-full max-w-[70rem] px-5 py-8 sm:px-8">
      <header className="mb-8">
        <span className="label">The record</span>
        <h1 className="display mt-1.5 text-[2rem] sm:text-4xl">
          Prediction history
        </h1>
        <p className="mt-3 max-w-xl text-[15px] leading-relaxed text-muted">
          Every call that has settled, and how it finished. Nothing is removed
          once it is here, including the ones that missed.
        </p>
      </header>

      <StatsPanel filters={filters} />

      {/* Filters. Outcome first because it is the one people reach for when
          they are checking whether the losses are being shown. */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex gap-1 rounded-full border border-border bg-surface p-1">
          {OUTCOMES.map((o) => (
            <button
              key={o.label}
              type="button"
              onClick={() => update({ outcome: o.id })}
              aria-pressed={(filters.outcome ?? null) === o.id}
              className={`press rounded-full px-3.5 py-1.5 text-[12px] font-semibold transition-colors ${
                (filters.outcome ?? null) === o.id
                  ? "bg-surface-secondary text-foreground"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>

        <select
          value={filters.league ?? ""}
          onChange={(e) => update({ league: e.target.value || null })}
          aria-label="Filter by league"
          className="h-9 rounded-full border border-field-border bg-field px-3.5 text-[12px] font-medium"
        >
          <option value="">All leagues</option>
          {(facets?.leagues ?? []).map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>

        <select
          value={filters.market ?? ""}
          onChange={(e) => update({ market: e.target.value || null })}
          aria-label="Filter by market"
          className="h-9 rounded-full border border-field-border bg-field px-3.5 text-[12px] font-medium"
        >
          <option value="">All markets</option>
          {(facets?.markets ?? []).map((m) => (
            <option key={m} value={m}>
              {MARKET_LABELS[m as Market] ?? m}
            </option>
          ))}
        </select>
      </div>

      {isPending ? (
        <div className="shimmer h-[30rem] rounded-[1.5rem] bg-surface" />
      ) : rows.length === 0 ? (
        <div className="rounded-[1.5rem] border border-border bg-surface p-14 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface-secondary">
            <BarChart3 className="h-5 w-5 text-muted" strokeWidth={1.75} />
          </span>
          <p className="mt-4 font-semibold">Nothing matches that</p>
          <p className="mx-auto mt-1.5 max-w-xs text-sm leading-relaxed text-muted">
            Try widening the filters, or clear them to see the whole record.
          </p>
          <button
            type="button"
            onClick={() => {
              setFilters({});
              setPage(0);
            }}
            className="press mt-5 rounded-full border border-border px-4 py-2 text-[13px] font-semibold hover:bg-surface-secondary"
          >
            Clear filters
          </button>
        </div>
      ) : (
        <>
          <div
            className={`overflow-hidden rounded-[1.5rem] border border-border bg-surface transition-opacity ${
              isPlaceholderData ? "opacity-60" : ""
            }`}
          >
            <ul className="divide-y divide-separator">
              {rows.map((p) => (
                <HistoryRow key={p.id} pick={p} />
              ))}
            </ul>
          </div>

          <nav
            aria-label="History pages"
            className="mt-5 flex items-center justify-between gap-4"
          >
            <p className="text-[12px] text-muted">
              <span className="numeral">{from}</span>&ndash;
              <span className="numeral">{to}</span> of{" "}
              <span className="numeral font-semibold">{total}</span>
            </p>

            <div className="flex gap-2">
              <button
                type="button"
                disabled={page === 0}
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                className="press flex h-9 items-center gap-1.5 rounded-full border border-border px-3.5 text-[13px] font-semibold disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
                Previous
              </button>
              <button
                type="button"
                disabled={!data?.hasMore}
                onClick={() => setPage((p) => p + 1)}
                className="press flex h-9 items-center gap-1.5 rounded-full border border-border px-3.5 text-[13px] font-semibold disabled:opacity-40"
              >
                Next
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </nav>
        </>
      )}
    </main>
  );
}


/**
 * Closing line value.
 *
 * The most credible evidence a tipster can show, and it was already being
 * measured. Beating the close means the market moved toward our position after
 * we called it, which is the one signal that separates a real edge from a run
 * of good luck.
 *
 * The two win rates underneath are the honest test: if picks that beat the
 * close win no more often than picks the market moved against, our CLV is noise
 * and the headline number is decoration.
 */
function ClvPanel() {
  const { data: clv } = useClvSummary();
  const { data: tipsters } = useTipsterPerformance();

  if (!clv || clv.measured === 0) return null;

  const beat = clv.beatCloseRate;
  const wBeat = clv.winRateWhenBeatingClose;
  const wOpp = clv.winRateWhenOpposed;
  const separates = wBeat != null && wOpp != null && wBeat - wOpp >= 0.05;

  return (
    <div className="mt-3 rounded-[1.25rem] border border-border bg-surface p-5">
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <h2 className="text-[13px] font-semibold">Against the closing line</h2>
        <span className="numeral text-[11px] text-muted">
          {clv.measured} priced calls
        </span>
      </div>
      <p className="mb-4 text-[12px] leading-relaxed text-muted">
        Whether the market moved toward our pick after we made it. Taking a
        better price than the close is the clearest evidence an edge is real
        rather than lucky.
      </p>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {[
          {
            label: "Beat the close",
            value: beat == null ? "-" : formatPercent(beat, 0),
            ink: beat != null && beat > 0.5 ? "var(--success)" : undefined,
          },
          {
            label: "Won when we beat it",
            value: wBeat == null ? "-" : formatPercent(wBeat, 0),
          },
          {
            label: "Won when opposed",
            value: wOpp == null ? "-" : formatPercent(wOpp, 0),
          },
        ].map((t) => (
          <div key={t.label} className="rounded-2xl bg-surface-secondary p-4">
            <dd
              className="numeral text-xl"
              style={t.ink ? { color: t.ink } : undefined}
            >
              {t.value}
            </dd>
            <dt className="label mt-1">{t.label}</dt>
          </div>
        ))}
      </dl>

      <p className="mt-3 text-[11px] leading-relaxed text-muted">
        {separates
          ? "Calls that beat the close win noticeably more often than calls the market moved against, which is what an edge looks like."
          : "On this sample the two win rates are close together, so the closing-line figure is not yet evidence of an edge on its own. It needs more settled calls to separate."}
      </p>

      {tipsters && tipsters.length > 1 && (
        <div className="mt-5 border-t border-separator pt-4">
          <h3 className="mb-3 text-[12px] font-semibold">By tipster</h3>
          <ul className="space-y-2">
            {tipsters.map((t) => (
              <li key={t.id} className="flex items-center gap-3 text-[12px]">
                <span className="min-w-0 flex-1 truncate font-medium">{t.name}</span>
                <span className="numeral text-muted">{t.settled}</span>
                <span className="numeral w-12 text-right font-semibold">
                  {t.winRate == null ? "-" : formatPercent(t.winRate, 0)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
