"use client";

import Link from "next/link";
import { ArrowLeft, Check, Lock, MapPin, Plus, Users } from "@/components/ui/icons";
import { MeterRoot, MeterTrack, MeterFill } from "@heroui/react";
import {
  usePredictionDetail,
  type FixtureLineups,
  type FixtureStats,
  type LineupPlayer,
  type TeamLineup,
} from "@/lib/queries";
import { useBetSlip } from "@/lib/bet-slip";
import { PASS_PRICE_USD } from "@/lib/pricing";
import { ConfidenceRing } from "./confidence-ring";
import { TeamCrest } from "./team-crest";
import { isUnlocked, type Pick } from "@/lib/types";
import { confidencePercent, formatMarket, teamName } from "@/lib/format";
import { describeFilters } from "@/lib/engine/filters";

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
  className = "",
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  /** For ordering within the column. See the main column's comment. */
  className?: string;
}) {
  return (
    <section
      className={`overflow-hidden rounded-[1.5rem] border border-border bg-surface ${className}`}
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
        {/*
          flex rather than space-y, so one child can be reordered on mobile.

          The reading order was built for a wide screen: evidence first, our
          interpretation second, so someone can reach their own view before
          being told ours. That is the right order when the rail sits alongside
          and the whole page is in view at once.

          On a phone it stacks, and "form, head-to-head, season" becomes three
          screens of scrolling before the call is explained — so the thing the
          reader came for is the last thing they reach. Only "Why this
          prediction" moves, and only below lg; the evidence still follows it,
          which keeps it checkable rather than hidden.
        */}
        <div className="order-2 flex flex-col gap-4 lg:order-none">
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
            className="order-first lg:order-none"
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
                pass.
              </LockedNotice>
            )}
          </Section>

          <FactorsSection pick={pick} unlocked={unlocked} />

          <LineupsSection
            lineups={data.lineups ?? null}
            homeName={teamName(pick.homeTeam)}
            awayName={teamName(pick.awayTeam)}
          />
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

/**
 * What the engine checked, and what it could not.
 *
 * One list before, every string ticked green. That put a tick beside
 * "skipped_no_personnel_data" — claiming as a completed screen the one thing
 * the engine explicitly could not do — under a heading promising these are the
 * screens applied before publishing. The split is the honest shape: a customer
 * deciding whether to trust a number needs to know what went unchecked at least
 * as much as what did.
 *
 * The unavailable list is not an apology and is not hidden. Most of these are
 * permanent properties of the feed, not today's outage, and saying so is what
 * makes the confidence number readable.
 */
function FactorsSection({ pick, unlocked }: { pick: Pick; unlocked: boolean }) {
  const { applied, unavailable } = describeFilters(pick.filtersApplied);

  return (
    <Section
      title="Factors considered"
      description="The screens the engine ran on this fixture, and the ones it had no data for."
    >
      {!unlocked ? (
        <LockedNotice>Unlocks with the call.</LockedNotice>
      ) : !applied.length && !unavailable.length ? (
        <p className="text-[13px] text-muted">
          No screens were recorded for this call.
        </p>
      ) : (
        <div className="space-y-6">
          {!!applied.length && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
                Applied
              </p>
              <ul className="mt-3 space-y-2">
                {applied.map((f) => (
                  <li
                    key={f.raw}
                    className="flex items-start gap-3 rounded-xl bg-surface-secondary px-3 py-2.5"
                  >
                    <span
                      className="mt-px flex h-5 w-5 flex-none items-center justify-center rounded-full"
                      style={{ background: "var(--won-wash)", color: "var(--won-ink)" }}
                    >
                      <Check className="h-3 w-3" strokeWidth={3} />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium">{f.label}</span>
                      {f.detail && (
                        <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">
                          {f.detail}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!!unavailable.length && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
                No data to check
              </p>
              <p className="mt-1.5 text-[12px] leading-relaxed text-muted">
                These screens need inputs this fixture doesn&rsquo;t carry. The engine
                skips them rather than guessing, and a skipped screen counts against
                the confidence score, never for it.
              </p>
              <ul className="mt-3 space-y-2">
                {unavailable.map((f) => (
                  <li
                    key={f.raw}
                    className="flex items-start gap-3 rounded-xl px-3 py-2.5"
                    style={{ background: "var(--surface-tertiary)" }}
                  >
                    <span
                      className="mt-px flex h-5 w-5 flex-none items-center justify-center rounded-full text-[13px] leading-none text-muted"
                      style={{ background: "var(--surface-secondary)" }}
                      aria-hidden
                    >
                      &ndash;
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium text-muted">
                        {f.label}
                      </span>
                      {f.detail && (
                        <span className="mt-0.5 block text-[12px] leading-relaxed text-muted">
                          {f.detail}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

/**
 * The team sheets, once the clubs name them.
 *
 * This section was a hard-coded paragraph for the whole life of the page, and
 * it could never have become anything else: `lineups` sat in the pipeline's
 * list of feeds nothing fetched, so the promise that they would "appear here"
 * was one nothing in the codebase could keep.
 *
 * The paragraph survives, as the state it always described rather than as the
 * only state. Each side is rendered independently — one club naming its XI does
 * not oblige the other, and waiting for both would blank the section through
 * the twenty minutes between them.
 */
function LineupsSection({
  lineups,
  homeName,
  awayName,
}: {
  lineups: FixtureLineups | null;
  homeName: string;
  awayName: string;
}) {
  const home = lineups?.home ?? null;
  const away = lineups?.away ?? null;

  if (!home && !away) {
    return (
      <Section title="Line-ups">
        <div className="flex items-center gap-3 rounded-2xl bg-surface-secondary px-4 py-5">
          <Users className="h-4 w-4 flex-none text-muted" />
          <p className="text-[13px] leading-relaxed text-muted">
            Confirmed line-ups are published about 40 minutes before kickoff.
            They&rsquo;ll appear here once the teams are announced.
          </p>
        </div>
      </Section>
    );
  }

  return (
    <Section
      title="Line-ups"
      description="As named by the clubs. Substitutions during the match are not reflected."
    >
      <div className="grid gap-6 sm:grid-cols-2">
        <TeamSheet name={homeName} sheet={home} />
        <TeamSheet name={awayName} sheet={away} />
      </div>
    </Section>
  );
}

function TeamSheet({ name, sheet }: { name: string; sheet: TeamLineup | null }) {
  if (!sheet) {
    return (
      <div>
        <p className="text-[13px] font-semibold">{name}</p>
        <p className="mt-2 text-[12px] leading-relaxed text-muted">
          Not named yet.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="truncate text-[13px] font-semibold">{name}</p>
        {sheet.formation && (
          <span className="numeral flex-none text-[12px] text-muted">{sheet.formation}</span>
        )}
      </div>
      {sheet.coach && (
        <p className="mt-0.5 text-[11px] text-muted">Coach: {sheet.coach}</p>
      )}

      <ul className="mt-3 space-y-1.5">
        {sheet.startXI.map((p, i) => (
          <PlayerRow key={p.externalId ?? `xi-${i}`} player={p} />
        ))}
      </ul>

      {!!sheet.substitutes.length && (
        <>
          <p className="mt-4 text-[11px] font-bold uppercase tracking-[0.08em] text-muted">
            Bench
          </p>
          <ul className="mt-2 space-y-1.5">
            {sheet.substitutes.map((p, i) => (
              <PlayerRow key={p.externalId ?? `sub-${i}`} player={p} muted />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function PlayerRow({ player, muted = false }: { player: LineupPlayer; muted?: boolean }) {
  return (
    <li className="flex items-baseline gap-2.5">
      {/* Fixed width so the names line up into a column rather than stepping
          in and out with the width of each shirt number. */}
      <span className="numeral w-5 flex-none text-right text-[11px] text-muted">
        {player.number ?? "\u2013"}
      </span>
      <span className={`min-w-0 flex-1 truncate text-[12.5px] ${muted ? "text-muted" : ""}`}>
        {player.name}
      </span>
      {player.position && (
        <span className="flex-none text-[10px] font-semibold uppercase tracking-[0.06em] text-muted">
          {player.position}
        </span>
      )}
    </li>
  );
}

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
          Unlock · from ${PASS_PRICE_USD}
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
      /*
        Tighter gutters on a phone, because this row has three columns and a
        fixed-width crest in two of them. At 375px the old px-6 plus gap-4 left
        the middle column about 125px, and "7:00 pm" at 2rem needs more than
        that — so the kickoff time wrapped mid-value, onto two lines, which then
        pushed the date out of line with the crests beside it.
      */
      className="overflow-hidden rounded-[1.5rem] px-4 py-6 text-feature-foreground sm:px-6 sm:py-8"
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

      {/*
        minmax(0,1fr), not 1fr.

        A grid track sized `1fr` carries an implicit `min-width: auto`, which is
        min-content — so a column holding an unbreakable word wider than its
        share does not shrink, it pushes the whole grid past its container's
        padding. That is why a long single-word team name reached the card edge
        even after the text itself was allowed to wrap: the wrapping was fine,
        the TRACK was the thing refusing to give ground.

        minmax(0,1fr) lets the track shrink to whatever is left, and break-words
        below then does the wrapping inside it.
      */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-2 sm:gap-4">
        {[pick.homeTeam, pick.awayTeam].map((team, i) => (
          <div key={i} className={`flex flex-col items-center gap-3 text-center ${i === 1 ? "order-3" : ""}`}>
            <TeamCrest name={teamName(team)} logo={team?.logo} size={72} onFeature />
            {/*
              A fixed two-line box, whatever the name does inside it.

              "Barcelona" fits on one line and "Athletic Club" did not, so the
              two columns were different heights — and with items-center on the
              grid, a taller column recentres itself and drags its crest out of
              line with the other one. Reserving the second line keeps both
              crests level whether a name wraps or not, and a name long enough
              to need a third still only pushes its own column.

              A block, not a flex row. As a flex container the text becomes an
              anonymous flex item, which will not shrink below its min-content
              width — so break-words had nothing to act on and a single long
              word like "Wolverhampton" ran past the card's padding. In normal
              block flow the wrapping rules apply to the text directly, and a
              one-line name still sits at the top of the reserved box without
              needing items-start to put it there.

              w-full because the column is `flex flex-col items-center`, and a
              block child of a centred flex column sizes to MAX-CONTENT, not to
              the column. Without it "Mönchengladbach" laid itself out 118px
              wide inside a 100px track and spilled evenly out of both sides,
              which put it under the kickoff time. Taking the full track width
              is what gives break-words something to wrap against.

              hyphens-auto so the rare forced break reads as a hyphenation
              rather than as a bug. It needs a lang on the document, which the
              root layout sets. Only the longest names in European football
              reach this — "Mönchengladbach" does not fit a 100px column at any
              weight — and breaking one is still better than letting it run past
              the card.
            */}
            <span className="block w-full min-h-[2.5em] hyphens-auto text-balance break-words text-[13px] font-semibold leading-tight sm:text-[15px]">
              {teamName(team)}
            </span>
          </div>
        ))}

        {/*
          items-start above, and a crest-height box here.

          With items-center, a column whose name wrapped to three lines —
          "Borussia Mönchengladbach" does at this width — became taller than the
          other and recentred itself, dragging its crest out of line. Top-
          aligning the tracks pins every crest to the same y whatever the names
          below them do.

          The kickoff then has to be centred against the crests rather than
          against the row, which is what this fixed 72px box does: it matches
          the crest and centres its contents inside it. Reserving two lines for
          the name is still worth it, because it keeps the common one-line and
          two-line cases from shifting relative to each other.
        */}
        <div className="order-2 flex h-[72px] flex-col items-center justify-center gap-1.5">
          {settled || live ? (
            <span className="numeral whitespace-nowrap text-[2.25rem] leading-none sm:text-[3rem]">
              {pick.fixture.homeGoals ?? 0}
              <span style={{ color: "var(--feature-muted)" }} className="mx-2 font-normal">
                :
              </span>
              {pick.fixture.awayGoals ?? 0}
            </span>
          ) : (
            // nowrap is the load-bearing part. A kickoff time is one value and
            // must never break across lines; the smaller mobile size is what
            // makes keeping it on one line affordable in the space left.
            <span className="numeral whitespace-nowrap text-[1.5rem] leading-none sm:text-[2rem]">
              {kickoff.toLocaleTimeString([], { hour: "numeric", minute: "2-digit", hour12: true })}
            </span>
          )}
          <span className="whitespace-nowrap text-[11px]" style={{ color: "var(--feature-muted)" }}>
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
