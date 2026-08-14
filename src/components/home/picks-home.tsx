"use client";

import { useMemo, useState } from "react";
import { LinkButton } from "@/components/ui/link-button";
import { Card } from "@heroui/react/card";
import { Chip } from "@heroui/react/chip";
import { Skeleton } from "@heroui/react/skeleton";
import { Alert } from "@heroui/react/alert";
import { CalendarOff, Lock, Sparkles, TrendingUp } from "lucide-react";
import { PickCard } from "@/components/picks/pick-card";
import { PickDetail } from "@/components/picks/pick-detail";
import {
  useAccessState,
  useEngineStats,
  useExtraPicks,
  usePicksByStatus,
  useStatusCounts,
  useTodaysPicks,
} from "@/lib/queries";
import { MARKET_LABELS } from "@/lib/format";
import { confidencePercent, formatPercent, teamName } from "@/lib/format";
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
  const [selected, setSelected] = useState<Pick | null>(null);

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

  const hidden = Math.max((source?.totalCount ?? 0) - (source?.picks.length ?? 0), 0);
  const showPaywall = !access?.hasFullAccess && hidden > 0;

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 px-5 py-8">
      <PickDetail
        pick={selected}
        isOpen={selected !== null}
        onClose={() => setSelected(null)}
      />

      {access?.isSuspended && (
        <Alert status="danger">
          <Alert.Title>Your account is suspended</Alert.Title>
          <Alert.Description>
            Pick access is blocked while your account is suspended, including
            days you have already paid for. Contact support to resolve it.
          </Alert.Description>
        </Alert>
      )}

      {/* --------------- headline stats --------------- */}
      <section className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-border bg-border">
        <StatTile
          label="Win rate"
          value={stats ? formatPercent(stats.winRate) : "—"}
          tone="success"
          icon={<TrendingUp className="h-3.5 w-3.5" />}
        />
        <StatTile
          label="ROI"
          value={stats ? formatPercent(stats.roi) : "—"}
          tone={(stats?.roi ?? 0) >= 0 ? "success" : "danger"}
        />
        <StatTile
          label="Settled picks"
          value={stats ? String(stats.totalPicks) : "—"}
        />
      </section>

      {/* --------------- filters --------------- */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              aria-pressed={filter === f.key}
              className={`cursor-pointer rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                filter === f.key
                  ? "border-elevated bg-surface-secondary text-foreground"
                  : "border-border text-muted hover:text-foreground"
              }`}
            >
              {f.label}
              {counts && (
                <span className="ml-1.5 font-mono text-[11px] text-muted">
                  {counts[f.key]}
                </span>
              )}
            </button>
          ))}

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <select
              value={league}
              onChange={(e) => setLeague(e.target.value)}
              aria-label="Filter by league"
              className="cursor-pointer rounded-lg border border-field-border bg-field px-2.5 py-1.5 text-sm text-foreground"
            >
              <option value="all">All leagues</option>
              {leagues.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>

            <select
              value={market}
              onChange={(e) => setMarket(e.target.value as Market | "all")}
              aria-label="Filter by market"
              className="cursor-pointer rounded-lg border border-field-border bg-field px-2.5 py-1.5 text-sm text-foreground"
            >
              <option value="all">All markets</option>
              {Object.entries(MARKET_LABELS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* --------------- pick grid --------------- */}
        {isPending ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-52 rounded-xl" />
            ))}
          </div>
        ) : visible.length === 0 ? (
          <Card>
            <Card.Content className="flex flex-col items-center gap-3 p-12 text-center">
              <CalendarOff className="h-8 w-8 text-muted" strokeWidth={1.5} />
              <p className="font-medium">
                {showPaywall
                  ? "Today's picks are ready"
                  : "Nothing to show here"}
              </p>
              <p className="max-w-sm text-sm text-muted">
                {showPaywall
                  ? `${hidden} picks are waiting behind the day pass.`
                  : market !== "all" || league !== "all"
                    ? "No picks match those filters. Try widening them."
                    : "Today's picks are still being lined up — check back shortly."}
              </p>
            </Card.Content>
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((pick) => (
              <PickCard key={pick.id} pick={pick} onOpen={setSelected} />
            ))}
          </div>
        )}

        {/* --------------- paywall --------------- */}
        {showPaywall && (
          <Card className="border-gradient">
            <Card.Content className="flex flex-col items-center gap-4 p-8 text-center">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-secondary">
                <Lock className="h-5 w-5 text-muted" />
              </div>
              <div className="space-y-1.5">
                <h3 className="display text-xl">
                  {hidden} more {hidden === 1 ? "pick" : "picks"} today
                </h3>
                <p className="max-w-md text-sm text-muted">
                  {access?.isFirstDay
                    ? "You're seeing your two free picks. The day pass unlocks the rest — and every pick tomorrow."
                    : "One pass, one day, every pick. No subscription."}
                </p>
              </div>
              <LinkButton size="lg" variant="gradient" href="/checkout/day-pass">
                Unlock today · $3
              </LinkButton>
            </Card.Content>
          </Card>
        )}
      </section>

      {/* --------------- extra picks --------------- */}
      {access?.hasFullAccess && (
        <section className="space-y-4">
          <div className="flex items-end justify-between gap-4">
            <div>
              <p className="eyebrow">Pass-holder perk</p>
              <h2 className="display text-xl">Extra league picks</h2>
            </div>
            <LinkButton variant="secondary" size="sm" href="/checkout/extra-picks">
              <Sparkles className="h-3.5 w-3.5" />
              Buy more leagues
            </LinkButton>
          </div>

          {extra.data?.length ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {extra.data.map((pick) => (
                <PickCard key={pick.id} pick={pick} onOpen={setSelected} />
              ))}
            </div>
          ) : (
            <Card>
              <Card.Content className="p-8 text-center text-sm text-muted">
                Pick up to 3 games from any league we cover — $2 per group of 3.
              </Card.Content>
            </Card>
          )}
        </section>
      )}
    </div>
  );
}

function StatTile({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string;
  tone?: "success" | "danger";
  icon?: React.ReactNode;
}) {
  const color =
    tone === "success"
      ? "text-success"
      : tone === "danger"
        ? "text-danger"
        : "text-foreground";

  return (
    <div className="bg-surface px-4 py-4">
      <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-widest text-muted">
        {icon}
        {label}
      </p>
      <p className={`mt-1.5 font-mono text-2xl font-semibold leading-none ${color}`}>
        {value}
      </p>
    </div>
  );
}
