"use client";

import { useMemo, useState } from "react";
import { Lock, TrendingUp, Sparkles, SlidersHorizontal } from "lucide-react";
import { PredictionCard } from "@/components/predictions/prediction-card";
import { ReasoningSheet } from "@/components/predictions/reasoning-sheet";
import { LinkButton } from "@/components/ui/link-button";
import {
  useAccessState,
  useEngineStats,
  useExtraPicks,
  usePicksByStatus,
  useStatusCounts,
  useTodaysPicks,
} from "@/lib/queries";
import { MARKET_LABELS, formatPercent } from "@/lib/format";
import type { Market, Pick, StatusFilter } from "@/lib/types";

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "upcoming", label: "Upcoming" },
  { key: "live", label: "Live" },
  { key: "settled", label: "Settled" },
];

export function PicksHome() {
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [market, setMarket] = useState<Market | "all">("all");
  const [league, setLeague] = useState("all");
  const [reasoning, setReasoning] = useState<Pick | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  const { data: access } = useAccessState();
  const { data: stats } = useEngineStats();
  const { data: counts } = useStatusCounts();
  const today = useTodaysPicks();
  const filtered = usePicksByStatus(filter);
  const extra = useExtraPicks(access?.hasFullAccess === true);

  const source = filter === "all" ? today.data : filtered.data;
  const isPending = filter === "all" ? today.isPending : filtered.isPending;

  const leagues = useMemo(() => {
    const names = (source?.picks ?? [])
      .map((p) => p.league.name)
      .filter((n): n is string => Boolean(n));
    return [...new Set(names)].sort();
  }, [source]);

  const visible = useMemo(() => {
    let list = source?.picks ?? [];
    if (market !== "all") list = list.filter((p) => p.predictionType === market);
    if (league !== "all") list = list.filter((p) => p.league.name === league);
    return list;
  }, [source, market, league]);

  const hidden = Math.max(
    (source?.totalCount ?? 0) - (source?.picks.length ?? 0),
    0,
  );
  const showPaywall = !access?.hasFullAccess && hidden > 0;

  const [hero, ...rest] = visible;

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-8">
      <ReasoningSheet
        pick={reasoning}
        isOpen={reasoning !== null}
        onClose={() => setReasoning(null)}
      />

      {access?.isSuspended && (
        <div className="mb-6 rounded-2xl border border-lost-edge bg-lost-wash p-5">
          <p className="text-sm font-semibold" style={{ color: "var(--lost-ink)" }}>
            Your account is suspended
          </p>
          <p className="mt-1 text-[13px] leading-relaxed text-muted">
            Pick access is blocked while your account is suspended, including
            days you have already paid for. Contact support to resolve it.
          </p>
        </div>
      )}

      {/* ------------------------- header ------------------------- */}
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="label flex items-center gap-1.5">
            <Sparkles className="h-3 w-3" />
            {new Date().toLocaleDateString(undefined, {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </span>
          <h1 className="display mt-1.5 text-[2rem] sm:text-4xl">
            Today&rsquo;s predictions
          </h1>
        </div>

        {stats && stats.totalPicks > 0 && (
          <dl className="flex items-center divide-x divide-border">
            <div className="pr-5">
              <dd className="numeral text-xl" style={{ color: "var(--success)" }}>
                {formatPercent(stats.winRate, 0)}
              </dd>
              <dt className="label mt-0.5">Win rate</dt>
            </div>
            <div className="px-5">
              <dd className="numeral text-xl">{stats.totalPicks}</dd>
              <dt className="label mt-0.5">Settled</dt>
            </div>
          </dl>
        )}
      </header>

      {/* ------------------------- filters ------------------------- */}
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <div className="flex flex-1 gap-1.5 overflow-x-auto">
          {FILTERS.map((f) => {
            const on = filter === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => setFilter(f.key)}
                aria-pressed={on}
                className={`press flex-none rounded-full border px-4 py-2 text-[13px] font-semibold ${
                  on
                    ? "border-transparent bg-feature text-feature-foreground"
                    : "border-border bg-surface text-muted hover:text-foreground"
                }`}
              >
                {f.label}
                {counts && (
                  <span className="ml-1.5 opacity-60">{counts[f.key]}</span>
                )}
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => setShowFilters((v) => !v)}
          aria-expanded={showFilters}
          className={`press flex flex-none items-center gap-1.5 rounded-full border px-4 py-2 text-[13px] font-semibold ${
            market !== "all" || league !== "all"
              ? "border-accent-edge bg-accent-wash text-accent"
              : "border-border bg-surface text-muted hover:text-foreground"
          }`}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Filter
        </button>
      </div>

      {showFilters && (
        <div className="rise mb-6 grid gap-3 rounded-2xl border border-border bg-surface p-4 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="label">League</span>
            <select
              value={league}
              onChange={(e) => setLeague(e.target.value)}
              className="w-full cursor-pointer rounded-xl border border-field-border bg-field px-3 py-2.5 text-sm"
            >
              <option value="all">All leagues</option>
              {leagues.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="label">Market</span>
            <select
              value={market}
              onChange={(e) => setMarket(e.target.value as Market | "all")}
              className="w-full cursor-pointer rounded-xl border border-field-border bg-field px-3 py-2.5 text-sm"
            >
              <option value="all">All markets</option>
              {Object.entries(MARKET_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      {/* ------------------------- feed ------------------------- */}
      {isPending ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="shimmer h-[26rem] rounded-[1.75rem] bg-surface lg:col-span-2" />
          <div className="shimmer h-[24rem] rounded-[1.75rem] bg-surface" />
          <div className="shimmer h-[24rem] rounded-[1.75rem] bg-surface" />
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-[1.75rem] border border-border bg-surface p-14 text-center">
          <p className="font-semibold">
            {showPaywall ? "Today's board is ready" : "Nothing here"}
          </p>
          <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-muted">
            {showPaywall
              ? `${hidden} predictions are waiting behind the day pass.`
              : market !== "all" || league !== "all"
                ? "No predictions match those filters. Try widening them."
                : "Today's predictions are still being built — check back shortly."}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {/* The strongest call of the day gets the dark feature treatment. */}
          {hero && (
            <div className="lg:col-span-2">
              <PredictionCard pick={hero} feature onReasoning={setReasoning} />
            </div>
          )}
          {rest.map((p) => (
            <PredictionCard key={p.id} pick={p} onReasoning={setReasoning} />
          ))}
        </div>
      )}

      {/* ------------------------- paywall ------------------------- */}
      {showPaywall && (
        <div className="mt-6 rounded-[1.75rem] border border-accent-edge bg-accent-wash p-8 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface">
            <Lock className="h-5 w-5 text-accent" />
          </span>
          <h2 className="display mt-4 text-2xl">
            {hidden} more {hidden === 1 ? "prediction" : "predictions"} today
          </h2>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
            {access?.isFirstDay
              ? "You're seeing your free picks. The day pass unlocks the rest — and the full board tomorrow."
              : "One pass, one day, every prediction. No subscription."}
          </p>
          <LinkButton
            href="/checkout/day-pass"
            size="lg"
            variant="primary"
            className="mt-5"
          >
            Unlock today · $3
          </LinkButton>
        </div>
      )}

      {/* ------------------------- extra picks ------------------------- */}
      {access?.hasFullAccess && (
        <section className="mt-12">
          <div className="mb-5 flex items-end justify-between gap-4">
            <div>
              <span className="label flex items-center gap-1.5">
                <TrendingUp className="h-3 w-3" />
                Pass-holder perk
              </span>
              <h2 className="display mt-1.5 text-2xl">Extra league picks</h2>
            </div>
            <LinkButton href="/checkout/extra-picks" variant="secondary" size="sm">
              Add leagues
            </LinkButton>
          </div>

          {extra.data?.length ? (
            <div className="grid gap-4 lg:grid-cols-2">
              {extra.data.map((p) => (
                <PredictionCard key={p.id} pick={p} onReasoning={setReasoning} />
              ))}
            </div>
          ) : (
            <div className="rounded-[1.75rem] border border-border bg-surface p-10 text-center text-sm text-muted">
              Pick up to 3 games from any league we cover — $2 per group of 3.
            </div>
          )}
        </section>
      )}
    </main>
  );
}
