"use client";

import Link from "next/link";
import { ArrowLeft, Check, Lock, MapPin, Plus, Users } from "@/components/ui/icons";
import { MeterRoot, MeterTrack, MeterFill } from "@heroui/react";
import { usePredictionDetail, type FixtureStats } from "@/lib/queries";
import { useBetSlip } from "@/lib/bet-slip";
import { ConfidenceRing } from "./confidence-ring";
import { TeamCrest } from "./team-crest";
import { isUnlocked, type Pick } from "@/lib/types";
import { confidencePercent, formatMarket, teamName } from "@/lib/format";

/**
 * The detail page.
 *
 * Kalshi's information architecture: a wide analysis column with a narrow,
 * sticky decision rail beside it. You read down the left and act on the right
 * without ever losing the action, which is the whole reason their pages work.
 *
 * The ordering is deliberate. Public evidence comes first (form, head to head,
 * season splits) and our interpretation second, so a reader can reach their own
 * view before being told ours. A page that led with the call and buried the
 * evidence would be asking for trust rather than earning it.
 */

/* ------------------------------ primitives ------------------------------ */

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section
      className="overflow-hidden rounded-[1.5rem] border border-border bg-surface"
    >
      <div className="px-6 pt-6">
        <h2 className="text-[15px] font-semibold">{title}</h2>
        {description && (
          <p className="mt-1 text-[13px] leading-relaxed text-muted">{description}</p>
        )}
      </div>
      <div className="px-6 pb-6 pt-4">{children}</div>
    </section>
  );
}

/** A labelled figure with an optional comparison bar between the two sides. */
function StatRow({
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
  const h = home ?? 0;
  const a = away ?? 0;
  const total = h + a;
  const homePct = total > 0 ? (h / total) * 100 : 50;

  // A meter, not a progress bar: this is a share of a known total rather than
  // completion of a task. HeroUI's Meter carries exactly that semantic, so
  // screen readers announce "62%" against the right role.
  return (
    <MeterRoot
      value={homePct}
      minValue={0}
      maxValue={100}
      aria-label={`${label}: ${format(h)} to ${format(a)}`}
      className="block py-3"
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="numeral text-[13px] font-semibold">{format(h)}</span>
        <span className="text-[11px] uppercase tracking-[0.08em] text-muted">{label}</span>
        <span className="numeral text-[13px] font-semibold">{format(a)}</span>
      </div>
      <MeterTrack
        className="mt-2 h-1.5 overflow-hidden rounded-full"
        style={{ background: "var(--surface-tertiary)" }}
      >
        <MeterFill
          className="h-full rounded-full"
          style={{ width: `${homePct}%`, background: "var(--accent)" }}
        />
      </MeterTrack>
    </MeterRoot>
  );
}

/** Recent results as W/D/L chips, most recent last, the way form is read. */
function FormRun({ form }: { form: string | null | undefined }) {
  if (!form) return <span className="text-[13px] text-muted">Not available</span>;
  return (
    <div className="flex gap-1">
      {form.split("").map((r, i) => {
        const tone =
          r === "W"
            ? { bg: "var(--won-wash)", fg: "var(--won-ink)" }
            : r === "L"
              ? { bg: "var(--lost-wash)", fg: "var(--lost-ink)" }
              : { bg: "var(--surface-tertiary)", fg: "var(--muted)" };
        return (
          <span
            key={i}
            className="flex h-6 w-6 items-center justify-center rounded-md text-[11px] font-bold"
            style={{ background: tone.bg, color: tone.fg }}
          >
            {r}
          </span>
        );
      })}
    </div>
  );
}

/* -------------------------------- page -------------------------------- */

export function PredictionDetail({ id }: { id: string }) {
  const { data, isPending, error } = usePredictionDetail(id);

  if (isPending) {
    return (
      <main className="mx-auto w-full max-w-[80rem] px-5 py-8 sm:px-8">
        <div className="shimmer h-64 rounded-[1.5rem] bg-surface" />
        <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_22rem]">
          <div className="shimmer h-96 rounded-[1.5rem] bg-surface" />
          <div className="shimmer h-72 rounded-[1.5rem] bg-surface" />
        </div>
      </main>
    );
  }

  if (error || !data?.pick) {
    return (
      <main className="mx-auto w-full max-w-[80rem] px-5 py-20 text-center sm:px-8">
        <h1 className="display text-2xl">Prediction not found</h1>
        <p className="mt-2 text-sm text-muted">
          It may have been withdrawn, or the link is wrong.
        </p>
        <Link
          href="/"
          className="press mt-6 inline-flex h-11 items-center rounded-full bg-accent px-6 text-sm font-semibold text-accent-foreground"
        >
          Back to the board
        </Link>
      </main>
    );
  }

  const { pick, stats } = data;
  const unlocked = isUnlocked(pick);
  const settled = pick.status === "won" || pick.status === "lost";

  return (
    <main className="mx-auto w-full max-w-[80rem] px-5 py-6 sm:px-8">
      <Link
        href="/"
        className="press mb-5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-muted hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        All predictions
      </Link>

      <MatchHeader pick={pick} />

      {/*
        Source order is desktop order: analysis on the left, the call in the
        right rail. On a phone the grid collapses to one column and that order
        buries the call under every analysis section, so the reader scrolls past
        form, head-to-head and line-ups to reach the one thing the page is for.
        The rail is reordered to sit directly under the match header instead,
        and returns to the right-hand column at lg.
      */}
      <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_22rem] lg:items-start">
        {/* ---------------------- analysis column ---------------------- */}
        <div className="order-2 space-y-4 lg:order-none">
          <Section
            title="Recent form"
            description="Each side's last five, oldest first."
          >
            <div className="grid gap-5 sm:grid-cols-2">
              <div>
                <p className="mb-2 text-[13px] font-semibold">{teamName(pick.homeTeam)}</p>
                <FormRun form={stats?.homeForm} />
              </div>
              <div>
                <p className="mb-2 text-[13px] font-semibold">{teamName(pick.awayTeam)}</p>
                <FormRun form={stats?.awayForm} />
              </div>
            </div>
          </Section>

          <Section
            title="Head to head"
            description="How these two have gone historically."
          >
            {stats ? (
              <>
                <div className="mb-4 grid grid-cols-3 gap-3 text-center">
                  {[
                    { n: stats.h2hHomeWins, l: `${teamName(pick.homeTeam)} wins` },
                    { n: stats.h2hDraws, l: "Draws" },
                    { n: stats.h2hAwayWins, l: `${teamName(pick.awayTeam)} wins` },
                  ].map((x, i) => (
                    <div key={i} className="rounded-2xl bg-surface-secondary px-3 py-4">
                      <p className="numeral text-2xl">{x.n ?? 0}</p>
                      <p className="mt-1 text-[11px] leading-tight text-muted">{x.l}</p>
                    </div>
                  ))}
                </div>
                <dl className="divide-y divide-separator">
                  <div className="flex items-center justify-between py-2.5">
                    <dt className="text-[13px] text-muted">Average goals</dt>
                    <dd className="numeral text-[13px] font-semibold">
                      {stats.h2hAvgGoals ?? "-"}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between py-2.5">
                    <dt className="text-[13px] text-muted">Both teams scored</dt>
                    <dd className="numeral text-[13px] font-semibold">
                      {stats.h2hBttsRate != null
                        ? `${Math.round(stats.h2hBttsRate * 100)}%`
                        : "-"}
                    </dd>
                  </div>
                </dl>
              </>
            ) : (
              <p className="text-[13px] text-muted">No head-to-head record available.</p>
            )}
          </Section>

          <Section
            title="Season so far"
            description="Both sides across the current campaign."
          >
            <SeasonComparison stats={stats} />
          </Section>

          {/* Reasoning is ours, so it follows the evidence and is gated. */}
          <Section
            title="Why this prediction"
            description={
              unlocked
                ? "The model's own account of the call."
                : "Available with access."
            }
          >
            {unlocked ? (
              <>
                <p className="text-[14px] leading-relaxed">{pick.reasoning}</p>
                {!!pick.reasoningTags?.length && (
                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {pick.reasoningTags.map((t) => (
                      <span
                        key={t}
                        className="rounded-full px-2.5 py-1 text-[11px] font-medium"
                        style={{ background: "var(--accent-wash)", color: "var(--accent)" }}
                      >
                        {t.replace(/_/g, " ")}
                      </span>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <LockedNotice>
                The reasoning, confidence score and the call itself unlock with a
                day pass.
              </LockedNotice>
            )}
          </Section>

          <Section
            title="Factors considered"
            description="Screens the model applies before it will publish a call."
          >
            {unlocked && pick.filtersApplied ? (
              <ul className="grid gap-2 sm:grid-cols-2">
                {Object.entries(pick.filtersApplied).map(([k, passed]) => (
                  <li
                    key={k}
                    className="flex items-center gap-2.5 rounded-xl bg-surface-secondary px-3 py-2.5"
                  >
                    <span
                      className="flex h-5 w-5 flex-none items-center justify-center rounded-full"
                      style={{
                        background: passed ? "var(--won-wash)" : "var(--surface-tertiary)",
                        color: passed ? "var(--won-ink)" : "var(--muted)",
                      }}
                    >
                      {passed ? <Check className="h-3 w-3" strokeWidth={3} /> : "–"}
                    </span>
                    <span className="text-[13px] capitalize">
                      {k.replace(/([A-Z])/g, " $1").toLowerCase()}
                    </span>
                  </li>
                ))}
              </ul>
            ) : unlocked ? (
              <p className="text-[13px] text-muted">No filters recorded for this call.</p>
            ) : (
              <LockedNotice>Unlocks with the call.</LockedNotice>
            )}
          </Section>

          {/*
            Line-ups are not fetched yet. API-Football publishes them roughly
            20-40 minutes before kickoff, so a slot that says so beats a section
            that silently renders nothing.
          */}
          <Section title="Line-ups">
            <div className="flex items-center gap-3 rounded-2xl bg-surface-secondary px-4 py-5">
              <Users className="h-4 w-4 flex-none text-muted" />
              <p className="text-[13px] leading-relaxed text-muted">
                Confirmed line-ups are published about 40 minutes before kickoff.
                They&rsquo;ll appear here once the teams are announced.
              </p>
            </div>
          </Section>
        </div>

        {/* ---------------------- decision rail ---------------------- */}
        <aside className="order-1 lg:order-none lg:sticky lg:top-20">
          <SummaryRail pick={pick} settled={settled} />
        </aside>
      </div>
    </main>
  );
}

/* ------------------------------ components ------------------------------ */

function LockedNotice({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex items-start gap-3 rounded-2xl px-4 py-5"
      style={{ background: "var(--accent-wash)" }}
    >
      <Lock className="mt-0.5 h-4 w-4 flex-none" style={{ color: "var(--accent)" }} />
      <div>
        <p className="text-[13px] leading-relaxed">{children}</p>
        <Link
          href="/checkout/day-pass"
          className="press mt-3 inline-flex h-9 items-center rounded-full bg-accent px-4 text-[13px] font-semibold text-accent-foreground"
        >
          Unlock today · $3
        </Link>
      </div>
    </div>
  );
}

/**
 * How a settled prediction colours the page.
 *
 * Only won and lost take a colour. Void and review_needed are deliberately
 * left on the neutral surface: they are not results, and painting them green
 * or red would state an outcome the grader explicitly declined to call.
 */
const OUTCOME_TONE = {
  won: {
    label: "Won",
    // Header ground: theme-stable, because the header is dark in both themes.
    surface: "var(--feature-won)",
    // Badge on the normal surface: ink on wash, which does flip with the theme.
    ink: "var(--won-ink)",
    wash: "var(--won-wash)",
  },
  lost: {
    label: "Lost",
    surface: "var(--feature-lost)",
    ink: "var(--lost-ink)",
    wash: "var(--lost-wash)",
  },
} as const;

function outcomeTone(pick: Pick) {
  return pick.status === "won" || pick.status === "lost" ? OUTCOME_TONE[pick.status] : null;
}

function MatchHeader({ pick }: { pick: Pick }) {
  const live = pick.fixture.status === "live";
  const settled = pick.fixture.status === "finished";
  const kickoff = new Date(pick.fixture.date);
  const tone = outcomeTone(pick);

  return (
    <header
      className="overflow-hidden rounded-[1.5rem] px-6 py-8 text-feature-foreground"
      style={
        {
          boxShadow: "var(--shadow-lift)",
          // The result carries the header once there is one. Overriding
          // --feature-muted here rather than at each call site means every
          // secondary line inside inherits a tint that stays legible on a
          // saturated ground instead of the grey tuned for near-black.
          background: tone ? tone.surface : "var(--feature)",
          ...(tone
            ? { "--feature-muted": "color-mix(in oklab, white 72%, transparent)" }
            : null),
        } as React.CSSProperties
      }
    >
      <div className="mb-6 flex flex-wrap items-center justify-center gap-2 text-center">
        {pick.league.logo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={pick.league.logo} alt="" width={18} height={18} className="h-[18px] w-[18px] object-contain" />
        )}
        <span className="text-[13px] font-semibold">{pick.league.name}</span>
        <span style={{ color: "var(--feature-muted)" }}>·</span>
        <span className="text-[13px]" style={{ color: "var(--feature-muted)" }}>
          {pick.league.country}
        </span>
        {live && (
          <span
            className="ml-1 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]"
            style={{ color: "var(--danger)", background: "color-mix(in oklab, currentColor 14%, transparent)" }}
          >
            <span className="ping-soft relative inline-block h-1.5 w-1.5 rounded-full bg-current" />
            Live
          </span>
        )}
      </div>

      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4">
        {[pick.homeTeam, pick.awayTeam].map((team, i) => (
          <div key={i} className={`flex flex-col items-center gap-3 text-center ${i === 1 ? "order-3" : ""}`}>
            <TeamCrest name={teamName(team)} logo={team?.logo} size={72} onFeature />
            <span className="text-[15px] font-semibold">{teamName(team)}</span>
          </div>
        ))}

        <div className="order-2 flex flex-col items-center gap-1.5">
          {settled || live ? (
            <span className="numeral text-[3rem] leading-none">
              {pick.fixture.homeGoals ?? 0}
              <span style={{ color: "var(--feature-muted)" }} className="mx-2 font-normal">
                :
              </span>
              {pick.fixture.awayGoals ?? 0}
            </span>
          ) : (
            <span className="numeral text-[2rem] leading-none">
              {kickoff.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true })}
            </span>
          )}
          <span className="text-[11px]" style={{ color: "var(--feature-muted)" }}>
            {kickoff.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
          </span>
        </div>
      </div>

      {(pick.fixture.venue || pick.fixture.round) && (
        <p
          className="mt-6 flex flex-wrap items-center justify-center gap-1.5 text-center text-[12px]"
          style={{ color: "var(--feature-muted)" }}
        >
          <MapPin className="h-3 w-3" />
          {[pick.fixture.venue, pick.fixture.round].filter(Boolean).join(" · ")}
        </p>
      )}
    </header>
  );
}

function SeasonComparison({ stats }: { stats: FixtureStats | null }) {
  if (!stats) return <p className="text-[13px] text-muted">No season data available.</p>;

  const h = stats.homeSeason ?? {};
  const a = stats.awaySeason ?? {};
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const two = (n: number) => n.toFixed(2);

  return (
    <div className="divide-y divide-separator">
      <StatRow label="Wins" home={h.wins} away={a.wins} />
      <StatRow label="Goals scored / game" home={h.avgGoalsScored} away={a.avgGoalsScored} format={two} />
      <StatRow label="Goals conceded / game" home={h.avgGoalsConceded} away={a.avgGoalsConceded} format={two} />
      <StatRow label="Clean sheets" home={h.cleanSheetRate} away={a.cleanSheetRate} format={pct} />
      <StatRow label="Both teams scored" home={h.bttsRate} away={a.bttsRate} format={pct} />
    </div>
  );
}

const FIXTURE_STATUS_LABEL: Record<string, string> = {
  scheduled: "Not started",
  live: "In play",
  finished: "Finished",
};

/**
 * Every prediction status, named in words a reader owes nothing to the schema
 * to understand. `review_needed` in particular has to say what it means: the
 * grader could not evaluate this market and a human has to look, which is very
 * different from a loss, and the Convex original used to record it as one.
 */
const STATUS_LABEL: Record<string, string> = {
  pending: "Not settled yet",
  won: "Won",
  lost: "Lost",
  void: "Void, stake returned",
  review_needed: "Awaiting review",
  disputed: "Disputed",
};

function OutcomeBadge({ pick }: { pick: Pick }) {
  const tone = outcomeTone(pick);
  const label = STATUS_LABEL[pick.status] ?? pick.status;

  if (!tone) {
    return <span className="text-[13px] font-semibold text-muted">{label}</span>;
  }

  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-bold"
      style={{ background: tone.wash, color: tone.ink }}
    >
      {label}
    </span>
  );
}

/** The sticky decision rail: the call, and the one action worth taking. */
function SummaryRail({ pick, settled }: { pick: Pick; settled: boolean }) {
  const slip = useBetSlip();
  const unlocked = isUnlocked(pick);
  const inSlip = slip.has(pick.id);
  const addable = unlocked && !settled && pick.fixture.status === "scheduled";

  return (
    <div
      className="overflow-hidden rounded-[1.5rem] border border-border bg-surface"
    >
      <div className="px-6 pt-6">
        <p
          className="text-[10px] font-bold uppercase tracking-[0.12em]"
          style={{ color: "var(--accent)" }}
        >
          {unlocked ? "AI prediction" : "Locked"}
        </p>
        <p className="display mt-2 text-[1.5rem] leading-tight">
          {formatMarket(pick.predictionType, pick.predictedValue)}
        </p>
      </div>

      {unlocked ? (
        <>
          <div className="mt-5 flex items-center gap-5 px-6">
            <ConfidenceRing value={pick.confidenceScore} tone="accent" size={68} />
            <div>
              <p className="numeral text-[15px] font-semibold">
                {confidencePercent(pick.confidenceScore)}% confidence
              </p>
              <p className="mt-0.5 text-[12px] text-muted">
                Staked {pick.stakingUnit} of 5 units
              </p>
            </div>
          </div>

          <dl className="mt-5 divide-y divide-separator border-t border-separator">
            {pick.odds != null && (
              <div className="flex items-center justify-between px-6 py-3">
                <dt className="text-[13px] text-muted">Indicative price</dt>
                <dd className="numeral text-[14px] font-semibold">{pick.odds.toFixed(2)}</dd>
              </div>
            )}
            {pick.altPredictedValue && pick.altMarket && (
              <div className="flex items-center justify-between gap-3 px-6 py-3">
                <dt className="text-[13px] text-muted">Safer alternative</dt>
                <dd className="text-right text-[13px] font-semibold">
                  {formatMarket(pick.altMarket, pick.altPredictedValue)}
                </dd>
              </div>
            )}

            {/*
              How the call actually finished, and where the match is. Two
              separate facts: a fixture can be finished while the prediction is
              still review_needed, and reading only one of them would tell you
              the game is over without telling you the call never resolved.
            */}
            <div className="flex items-center justify-between gap-3 px-6 py-3">
              <dt className="text-[13px] text-muted">Outcome</dt>
              <dd>
                <OutcomeBadge pick={pick} />
              </dd>
            </div>
            <div className="flex items-center justify-between gap-3 px-6 py-3">
              <dt className="text-[13px] text-muted">Status</dt>
              <dd className="text-right text-[13px] font-semibold">
                {FIXTURE_STATUS_LABEL[pick.fixture.status] ?? pick.fixture.status}
              </dd>
            </div>
          </dl>
        </>
      ) : (
        <div className="px-6 pb-2 pt-5">
          <LockedNotice>
            See the call, its confidence and the full reasoning.
          </LockedNotice>
        </div>
      )}

      <div className="px-6 pb-6 pt-5">
        {addable ? (
          <button
            type="button"
            onClick={() => (inSlip ? slip.remove(pick.id) : slip.add(pick))}
            aria-pressed={inSlip}
            className="press flex h-12 w-full items-center justify-center gap-2 rounded-full text-sm font-semibold"
            style={
              inSlip
                ? { background: "var(--accent-wash)", color: "var(--accent)" }
                : { background: "var(--accent)", color: "var(--accent-foreground)" }
            }
          >
            {inSlip ? (
              <>
                <Check className="h-4 w-4" strokeWidth={3} />
                In your slip
              </>
            ) : (
              <>
                <Plus className="h-4 w-4" strokeWidth={2.5} />
                Add to slip
              </>
            )}
          </button>
        ) : (
          unlocked && (
            <p className="text-center text-[12px] leading-relaxed text-muted">
              {settled
                ? "This one has settled, it can't be added to a slip."
                : "This match has started, so the pre-match price no longer applies."}
            </p>
          )
        )}

        <p className="mt-3 text-center text-[11px] leading-snug text-muted">
          Analysis, not advice. Kicka doesn&rsquo;t take bets or hold funds.
        </p>
      </div>
    </div>
  );
}
