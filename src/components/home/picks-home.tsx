"use client";

import { useEffect, useMemo, useState } from "react";
import {
  LayoutGrid,
  List,
  Lock,
  SlidersHorizontal,
  Sparkles,
  TrendingUp,
  X,
} from "@/components/ui/icons";
import { PredictionCard } from "@/components/predictions/prediction-card";
import { PredictionSummary } from "@/components/predictions/prediction-summary";
import { HeroSlider } from "./hero-slider";
import { LiveBoard } from "./live-board";
import { PicksTable } from "./picks-table";
import { EMPTY_FILTERS, FilterRail, type Filters } from "./filter-rail";
import { LinkButton } from "@/components/ui/link-button";
import { Alert } from "@/components/ui/alert";
import {
  useAccessState,
  useEngineStats,
  useExtraPicks,
  usePicksByStatus,
  useStatusCounts,
  useTodaysPicks,
} from "@/lib/queries";
import { useBoardView } from "@/lib/view-preference";
import { formatPercent } from "@/lib/format";
import type { Market, Pick, UnlockedPick } from "@/lib/types";
import {
  PASS_PRICE_USD,
  EXTRA_PICK_GAMES_PER_LEAGUE,
  EXTRA_PICK_PRICE_USD,
} from "@/lib/pricing";

/**
 * The board.
 *
 * A marketplace, laid out like one: filters pinned left, inventory right, full
 * width. The previous centred column was a feed, fine for a handful of picks a
 * day, wrong for something you're meant to shop. Narrowing is the primary verb
 * here, so the controls that narrow never leave the screen.
 *
 * Two readings of the same data. Cards are for browsing, the table for
 * comparing, and which one you prefer is remembered on your profile.
 */

export function PicksHome() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [summary, setSummary] = useState<UnlockedPick | null>(null);
  const [railOpen, setRailOpen] = useState(false);

  /**
   * A clock that ticks rather than a fresh Date.now() per render.
   *
   * The kickoff filter is time-relative ("next 3 hours"), so it needs a
   * current reading, but reading the clock during render is impure and makes
   * the same render produce different output. A snapshot refreshed each minute
   * is both pure and more correct: the window advances on its own instead of
   * only when something else happens to re-render.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const { view, choose } = useBoardView();
  const { data: access } = useAccessState();
  const { data: stats } = useEngineStats();
  const { data: counts } = useStatusCounts();
  // Exactly one of these runs. Both were mounted and only one was ever read,
  // which was free while neither refetched and became a doubled request every
  // ten seconds the moment they started polling live fixtures.
  const showingAll = filters.status === "all";
  const today = useTodaysPicks({ enabled: showingAll });
  const byStatus = usePicksByStatus(filters.status, { enabled: !showingAll });
  const extra = useExtraPicks(access?.hasFullAccess === true);

  const source = showingAll ? today.data : byStatus.data;
  const isPending = showingAll ? today.isPending : byStatus.isPending;
  const all = useMemo(() => source?.picks ?? [], [source]);

  // Facet counts come from the status-filtered set, not the fully filtered one:
  // a league's count shouldn't drop to zero because you ticked another league.
  const leagues = useMemo(() => {
    const m = new Map<string, { count: number; logo: string | null }>();
    for (const p of all) {
      const n = p.league.name;
      if (!n) continue;
      const prev = m.get(n);
      m.set(n, {
        count: (prev?.count ?? 0) + 1,
        logo: prev?.logo ?? p.league.logo ?? null,
      });
    }
    return [...m.entries()]
      .map(([name, v]) => ({ name, count: v.count, logo: v.logo }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [all]);

  // Only unlocked picks have a market to count. For a guest that means the
  // market facet is nearly empty, correct, since filtering by a market you
  // can't see would be a way to probe for it.
  const markets = useMemo(() => {
    const m = new Map<Market, number>();
    for (const p of all) {
      if (!p.predictionType) continue;
      m.set(p.predictionType, (m.get(p.predictionType) ?? 0) + 1);
    }
    return [...m.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count);
  }, [all]);

  const visible = useMemo(() => {
    return all.filter((p) => {
      if (filters.leagues.length && !filters.leagues.includes(p.league.name ?? "")) return false;
      if (filters.markets.length) {
        // Same reasoning as confidence below: a locked pick has no market, so
        // a market filter excludes it rather than guessing.
        if (!p.predictionType) return false;
        if (!filters.markets.includes(p.predictionType)) return false;
      }
      if (filters.minConfidence > 0) {
        // A locked pick has no confidence to compare, so a confidence filter
        // necessarily excludes it rather than silently treating it as zero.
        if (p.confidenceScore === undefined) return false;
        if (p.confidenceScore < filters.minConfidence) return false;
      }
      if (filters.kickoff !== "any") {
        const t = new Date(p.fixture.date).getTime();
        if (t < now) return false;
        if (filters.kickoff === "next3h" && t > now + 3 * 3600_000) return false;
      }
      return true;
    });
  }, [all, filters, now]);

  // The hero shortlist ignores the filters on purpose, it's the day's headline,
  // not a view of the current query.
  //
  // Locked picks are NOT excluded. For a guest that means two unlocked calls
  // and a third behind the paywall, which is the honest framing of "your free
  // picks are among today's best", and a far better argument for paying than
  // a shortlist that quietly shrinks to the size of your entitlement.
  const hero = useMemo(
    () => all.filter((p) => p.status === "pending").slice(0, 3),
    [all],
  );

  const lockedCount = all.filter((p) => p.locked).length;
  const showPaywall = !access?.hasFullAccess && lockedCount > 0;

  return (
    <main className="mx-auto w-full max-w-[110rem] px-5 py-6 sm:px-8">
      <PredictionSummary
        pick={summary}
        isOpen={summary !== null}
        onClose={() => setSummary(null)}
      />

      {access?.isSuspended && (
        <Alert status="danger" title="Your account is suspended" className="mb-6">
          Pick access is blocked while your account is suspended, including days
          you have already paid for. Contact support to resolve it.
        </Alert>
      )}

      {/* ------------------------- header ------------------------- */}
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          {/* The server and the browser disagree about locale and timezone, so
              this string legitimately differs between the two renders. Telling
              React to expect that is correct here; the alternative is a
              placeholder that shifts layout on mount.

              The date shown is the BOARD's day, not the reader's. Between
              midnight and the morning run the board is still yesterday's, and
              a header dated today above yesterday's results would be the one
              piece of the page that lies. */}
          <span className="label flex items-center gap-1.5" suppressHydrationWarning>
            <Sparkles className="h-3 w-3" />
            {(source?.boardDate ? new Date(source.boardDate) : new Date()).toLocaleDateString(undefined, {
              weekday: "long",
              day: "numeric",
              month: "long",
            })}
          </span>
          <h1 className="display mt-1.5 text-[2rem] sm:text-4xl">
            {source?.isPreviousDay
              ? "Latest results"
              : "Today\u2019s predictions"}
          </h1>
          {source?.isPreviousDay && (
            <p className="mt-2 max-w-prose text-[13px] leading-relaxed text-muted">
              How the last board finished. Today&rsquo;s predictions are published
              around 5am GMT.
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-4">
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

          {/* View toggle */}
          <div
            className="flex gap-0.5 rounded-full border border-border p-1"
            role="group"
            aria-label="Board layout"
          >
            {([
              { v: "cards", Icon: LayoutGrid, label: "Card view" },
              { v: "table", Icon: List, label: "Table view" },
            ] as const).map(({ v, Icon, label }) => {
              const on = view === v;
              return (
                <button
                  key={v}
                  type="button"
                  onClick={() => choose(v)}
                  aria-pressed={on}
                  aria-label={label}
                  title={label}
                  className="press flex h-8 w-8 items-center justify-center rounded-full transition-colors"
                  style={
                    on
                      ? { background: "var(--accent)", color: "var(--accent-foreground)" }
                      : { color: "var(--muted)" }
                  }
                >
                  <Icon className="h-4 w-4" />
                </button>
              );
            })}
          </div>
        </div>
      </header>

      {/* Mobile: the rail collapses behind a button rather than eating the fold. */}
      <button
        type="button"
        onClick={() => setRailOpen((v) => !v)}
        aria-expanded={railOpen}
        className="press mb-4 flex items-center gap-1.5 rounded-full border border-border bg-surface px-4 py-2 text-[13px] font-semibold text-muted lg:hidden"
      >
        <SlidersHorizontal className="h-3.5 w-3.5" />
        Filters
      </button>

      <div className="grid gap-6 lg:grid-cols-[17rem_1fr] lg:items-start">
        {/* The rail scrolls on its own rather than with the page: with a dozen
            leagues and a dozen markets it is taller than the viewport, and a
            sidebar you have to scroll the whole board to reach the bottom of
            isn't pinned in any useful sense. */}
        <aside
          className={`${railOpen ? "" : "hidden"} lg:sticky lg:top-20 lg:block lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pb-4`}
        >
          <FilterRail
            filters={filters}
            onChange={setFilters}
            leagues={leagues}
            markets={markets}
            statusCounts={counts}
          />
        </aside>

        {/* min-w-0 again, and for the same reason as the slider: the table
            declares min-w-[52rem], which without this becomes the grid column's
            minimum and drags the whole page wider than the phone. With it, the
            column stays put and the table scrolls inside its own
            overflow-x-auto wrapper, which is what that wrapper was for. */}
        <div className="min-w-0">
          {/* ------------------------- hero row -------------------------
              Lives inside the content column, not above it, so the filter rail
              runs the full height of the page beside everything it filters.
              Two thirds for the day's shortlist, one third for what's already
              happening: they answer different questions, "what should I look
              at" and "how are we doing", and a visitor forms a view of the
              product from both at once.

              min-w-0 on the slider column is load-bearing, not decoration:
              grid and flex children default to min-width:auto, so the three
              `flex-none` slides inside the slider set a min-content width of
              three viewports and force the whole page sideways on a phone. */}
          {hero.length > 0 && (
            <div className="mb-8 grid gap-4 xl:grid-cols-3 xl:items-stretch">
              <div className="min-w-0 xl:col-span-2">
                <HeroSlider picks={hero} onSummary={setSummary} />
              </div>
              {/* The Live Board must not drive this row's height, or a busy
                  evening stretches the row and the slider grows with it.
                  min-h-0 lets the panel shrink but nothing stops it pushing
                  the row taller, so at xl the panel is taken out of flow
                  entirely: the wrapper stretches to whatever the slider sets,
                  the panel fills it absolutely, and the list scrolls inside.
                  Below xl the columns stack and it lays out normally. */}
              <div className="relative min-w-0">
                <div className="xl:absolute xl:inset-0">
                  <LiveBoard picks={all} />
                </div>
              </div>
            </div>
          )}

          <p className="mb-3 text-[13px] text-muted">
            Showing <span className="numeral font-semibold">{visible.length}</span>
            {visible.length !== all.length && ` of ${all.length}`}{" "}
            {visible.length === 1 ? "prediction" : "predictions"}
          </p>

          {isPending ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="shimmer h-[22rem] rounded-[1.5rem] bg-surface" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="rounded-[1.5rem] border border-border bg-surface p-14 text-center">
              <p className="font-semibold">Nothing matches</p>
              <p className="mx-auto mt-1.5 max-w-sm text-sm leading-relaxed text-muted">
                No predictions fit those filters. Try widening them.
              </p>
              <button
                type="button"
                onClick={() => setFilters(EMPTY_FILTERS)}
                className="press mt-5 inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-[13px] font-semibold"
              >
                <X className="h-3.5 w-3.5" />
                Clear filters
              </button>
            </div>
          ) : view === "table" ? (
            <PicksTable picks={visible} />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {visible.map((p: Pick) => (
                <PredictionCard key={p.id} pick={p} onSummary={setSummary} />
              ))}
            </div>
          )}

          {/* ------------------------- paywall ------------------------- */}
          {showPaywall && (
            <div className="mt-6 rounded-[1.5rem] border border-accent-edge bg-accent-wash p-8 text-center">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface">
                <Lock className="h-5 w-5 text-accent" />
              </span>
              <h2 className="display mt-4 text-2xl">
                {lockedCount} {lockedCount === 1 ? "prediction" : "predictions"} locked
              </h2>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted">
                {access?.isFirstDay
                  ? "You're seeing your free picks. The day pass unlocks the rest, and the full board tomorrow."
                  : "One pass, one day, every prediction. No subscription."}
              </p>
              <LinkButton href="/checkout/day-pass" size="lg" variant="primary" className="mt-5">
                Unlock today · ${PASS_PRICE_USD}
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
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {extra.data.map((p) => (
                    <PredictionCard key={p.id} pick={p} onSummary={setSummary} />
                  ))}
                </div>
              ) : (
                <div className="rounded-[1.5rem] border border-border bg-surface p-10 text-center text-sm text-muted">
                  ${EXTRA_PICK_PRICE_USD} unlocks up to {EXTRA_PICK_GAMES_PER_LEAGUE} games
                  in every league you pick. One price, however many you choose.
                </div>
              )}
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
