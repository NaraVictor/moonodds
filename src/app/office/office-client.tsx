"use client";

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Zap,
  LayoutGrid,
  ListChecks,
  CheckCircle2,
  Database,
  Brain,
  BarChart3,
  KeyRound,
  Play,
  Check,
  X,
  Clock,
  AlertTriangle,
  Trash2,
} from "@/components/ui/icons";
import {
  DEFAULT_MAX_FIXTURES_PER_SESSION,
  ENGINE_CALL_BUDGET_MS,
  MAX_FIXTURES_OVERRIDE,
  sessionCap,
} from "@/lib/engine/limits";
import {
  useAdminPredictions,
  useAdminUsers,
  useCatalog,
  useEngineConfig,
  useJobQueue,
  useOfficeAction,
  usePredictionRuns,
  useTuningReports,
  useUpcomingFixtures,
  usePredictedFixtureIds,
  useDashboardMetrics,
  usePredictionReport,
  useUserPicksReport,
  useAllConfigs,
  useFxFallback,
  adminKeys,
  type BoardFixture,
  type CatalogLeague,
  type CatalogTeam,
} from "@/lib/admin-queries";
import {
  confidencePercent,
  formatDateShort,
  formatMarket,
  formatPercent,
  teamShort,
} from "@/lib/format";
import type { Pick } from "@/lib/types";
import { Alert } from "@/components/ui/alert";
import {
  ENGINE_VARIABLES,
  resolveEngineVariables,
  validateEngineVariables,
  VARIABLES_BY_KEY,
  type EngineVariable,
  type VariableGroup,
} from "@/lib/engine/variables";
import { placeholdersIn } from "@/lib/engine/template";
import { useBacktest } from "@/lib/queries";

/**
 * The Office.
 *
 * An admin panel, but part of the same product, so it uses the Kicka
 * language rather than dashboard conventions: light ground, generous spacing,
 * rounded surfaces, and the SAME outcome vocabulary as the prediction card, so
 * green/red/amber mean exactly what they mean everywhere else.
 *
 * Density is earned, not assumed: the operator wants to know what ran, what's
 * queued, and what needs a decision, those come first on every tab.
 */

const TABS = [
  { key: "dashboard", label: "Dashboard", Icon: LayoutGrid },
  { key: "pipeline", label: "Pipeline", Icon: Zap },
  { key: "predictions", label: "Predictions", Icon: ListChecks },
  { key: "grade", label: "Grade", Icon: CheckCircle2 },
  { key: "catalog", label: "Catalog", Icon: Database },
  { key: "engine", label: "Engine", Icon: Brain },
  { key: "reports", label: "Reports", Icon: BarChart3 },
  { key: "users", label: "Users", Icon: KeyRound },
] as const;

type TabKey = (typeof TABS)[number]["key"];

/* ------------------------------ primitives ------------------------------ */

/**
 * A league badge or team crest, with a monogram behind it.
 *
 * Every one of these comes from API-Football's CDN at a path derived purely
 * from the entity id, so there is no key, no quota and no request in the
 * pipeline to produce them. The monogram is not decoration: a broken image in
 * a catalogue of forty rows is indistinguishable from a row with no data, and
 * `onError` is the only way to notice a crest that 404s.
 */
function Crest({
  src,
  name,
  size = 20,
}: {
  src?: string | null;
  name: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const initials = name.replace(/[^A-Za-z ]/g, "").split(/\s+/).slice(0, 2)
    .map((w) => w[0]).join("").toUpperCase();

  if (!src || failed) {
    return (
      <span
        aria-hidden="true"
        className="flex flex-none items-center justify-center rounded-full font-semibold"
        style={{
          width: size, height: size, fontSize: size * 0.42,
          background: "var(--surface-tertiary)", color: "var(--muted)",
        }}
      >
        {initials || "?"}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      onError={() => setFailed(true)}
      className="flex-none object-contain"
      style={{ width: size, height: size }}
    />
  );
}


function Panel({
  title,
  description,
  action,
  children,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      className="overflow-hidden rounded-[1.5rem] border border-border bg-surface"
    >
      <div className="flex flex-wrap items-start justify-between gap-3 px-6 pt-6">
        <div>
          <h2 className="text-[15px] font-semibold">{title}</h2>
          {description && (
            <p className="mt-1 max-w-md text-[13px] leading-relaxed text-muted">
              {description}
            </p>
          )}
        </div>
        {action}
      </div>
      <div className="px-6 pb-6 pt-5">{children}</div>
    </section>
  );
}

function Tag({
  tone,
  children,
}: {
  tone: "won" | "lost" | "pending" | "accent";
  children: React.ReactNode;
}) {
  const ink =
    tone === "won"
      ? "var(--won-ink)"
      : tone === "lost"
        ? "var(--lost-ink)"
        : tone === "accent"
          ? "var(--accent)"
          : "var(--pending-ink)";

  return (
    <span
      className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em]"
      style={{ color: ink, background: "color-mix(in oklab, currentColor 10%, transparent)" }}
    >
      {children}
    </span>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="py-10 text-center text-sm text-muted">{children}</p>
  );
}

function Loading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="shimmer h-14 rounded-xl bg-surface-secondary" />
      ))}
    </div>
  );
}

/* -------------------------------- shell -------------------------------- */

export function OfficeClient({
  adminName,
}: {
  adminName: string;
}) {
  const [tab, setTab] = useState<TabKey>("dashboard");

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-8">
      <header className="mb-6">
        <span className="label">Signed in as {adminName}</span>
        <h1 className="display mt-1.5 text-[2rem] sm:text-4xl">Office</h1>
        <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted">
          Run the pipeline, review what the engine proposes, and manage access.
        </p>
      </header>

      <nav
        aria-label="Office sections"
        className="mb-6 flex gap-1.5 overflow-x-auto pb-1"
      >
        {TABS.map(({ key, label, Icon }) => {
          const on = tab === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              aria-current={on ? "page" : undefined}
              className={`press flex flex-none items-center gap-1.5 rounded-full border px-4 py-2 text-[13px] font-semibold ${
                on
                  ? "border-transparent bg-feature text-feature-foreground"
                  : "border-border bg-surface text-muted hover:text-foreground"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          );
        })}
      </nav>

      <div className="rise">
        {tab === "dashboard" && <DashboardPanel />}
        {tab === "pipeline" && <PipelinePanel />}
        {tab === "predictions" && <PredictionsPanel />}
        {tab === "grade" && <GradePanel />}
        {tab === "catalog" && <CatalogPanel />}
        {tab === "engine" && <EnginePanel />}
        {tab === "reports" && <ReportsPanel />}
        {tab === "users" && <UsersPanel />}
      </div>
    </main>
  );
}

/* ------------------------------ pipeline ------------------------------ */

/**
 * "Fetch stats" used to be its own tile and no longer is.
 *
 * On the schedule it stays separate for a reason — fixtures land at 00:30 and
 * stats at 03:30, so the 36-hour window is centred on the 05:00 engine run.
 * By hand there is no 05:00 to wait for, and a tile you had to remember to
 * press second was a tile that got forgotten, leaving the engine reasoning
 * over team names. The fixture pull now carries the stats pull with it.
 */
const STAGES = [
  { action: "fetchFixtures", label: "Fetch fixtures", hint: "Pull today's matches, with the numbers the engine reads" },
  { action: "generatePicks", label: "Generate picks", hint: "Run the engine over today's board" },
  { action: "gradeResults", label: "Grade results", hint: "Settle anything that has finished" },
  { action: "clvCheck", label: "CLV check", hint: "Flag lines that moved against us" },
  { action: "recalibrate", label: "Recalibrate", hint: "Propose weight changes from results" },
];

/**
 * A stage result, in words.
 *
 * Every runner returns a small object and the panel used to dump it through
 * JSON.stringify into a <pre>. That is a developer reading their own return
 * value, not an operator being told what happened — and it hides the two
 * outcomes that matter most: a stage that ran and did nothing, and a stage
 * that skipped entirely. `{"skipped":"no active engine config"}` in a green
 * "finished" box reads as success.
 *
 * So each shape gets a sentence and a tone. Anything unrecognised still falls
 * back to the raw object, because a new field appearing is better shown than
 * swallowed.
 */
type StageOutcome = { tone: "won" | "pending" | "lost"; headline: string; detail?: string };

function describeStage(stage: string, result: unknown): StageOutcome {
  const r = (result ?? {}) as Record<string, unknown>;
  const n = (k: string) => Number(r[k] ?? 0);

  // A skip is not a success. It is the single most common way a pipeline stage
  // does nothing while looking like it worked.
  if (typeof r.skipped === "string") {
    return { tone: "pending", headline: "Nothing to do", detail: r.skipped };
  }

  switch (stage) {
    case "fetchFixtures":
      return n("upserted") === 0
        ? { tone: "pending", headline: "No fixtures found",
            detail: `Checked ${n("leagues")} league(s) for ${String(r.date ?? "today")}. The API returned nothing, which on a quiet day is normal and otherwise means the plan or the league list.` }
        : { tone: "won", headline: `${n("upserted")} fixture(s) saved`,
            detail: `${n("fixtures")} returned across ${n("leagues")} league(s) for ${String(r.date ?? "today")}. ${describeStatsLeg(r.stats)}` };

    case "fetchStats":
      return n("fetched") === 0
        ? { tone: "pending", headline: "No stats fetched",
            detail: "Nothing upcoming in the next 36 hours to enrich. Run the fixture pull first." }
        : { tone: "won", headline: `Stats for ${n("upserted")} fixture(s)`,
            detail: `${n("fetched")} fetched of ${n("requested")} requested, capped at ${n("limit")} by the API budget.` };

    case "generatePicks":
      return n("generated") === 0
        ? { tone: "pending", headline: "No picks published",
            /*
             * This used to read "0 fell below the confidence floor" on a run
             * where every single fixture fell below it. The zero-pick return
             * carries no `rejected` key at all — nothing was rejected, nothing
             * qualified in the first place — so the panel read a missing field
             * as zero and printed the exact opposite of what happened. Someone
             * reading it would conclude the floor was not the problem.
             */
            detail: `${describeShortfall(r)} ${describeTiming(r)}` }
        : { tone: "won", headline: `${n("generated")} pick(s) published`,
            detail: `From ${n("considered")} analysed. ${n("noBetZone")} no-bet, ${n("rejected")} unusable` +
              // A rerun over the same board is mostly duplicates, and silence
              // about them reads as an engine that found nothing new to say.
              (n("replaced") ? `, ${n("replaced")} replaced a weaker call` : "") +
              (n("duplicates") ? `, ${n("duplicates")} left alone as already covered` : "") +
              (n("configFallbacks") || n("warnings")
                ? `. ${n("configFallbacks")} config fallback(s), ${n("warnings")} warning(s) — check the Engine tab.`
                : ".") +
              ` ${describeTiming(r)}` };

    case "gradeResults":
      return n("graded") === 0
        ? { tone: "pending", headline: "Nothing to settle",
            detail: `${n("fixtures")} finished fixture(s) checked; no ungraded picks against them.` }
        : { tone: "won", headline: `${n("graded")} pick(s) settled`,
            detail: `Across ${n("fixtures")} finished fixture(s).` };

    case "clvCheck":
      return { tone: n("flagged") > 0 ? "pending" : "won",
        headline: `${n("reviewed")} line(s) reviewed`,
        detail: n("reviewed") === 0
          ? "No odds snapshots to compare yet."
          : `${n("flagged")} moved against us by more than ${String(r.thresholdPct ?? "?")}%.` };

    case "recalibrate":
      return n("proposals") === 0
        ? { tone: "won", headline: "No changes proposed",
            detail: `${n("reviewed")} settled pick(s) reviewed. ${String(r.note ?? "Performance is within target.")}` }
        : { tone: "pending", headline: `${n("proposals")} change(s) proposed`,
            detail: `From ${n("reviewed")} settled pick(s). ${r.autoApplied ? "Applied automatically." : "Waiting for approval in the Reports tab."}` };

    case "fetchAndGenerate": {
      // A composite is only as good as its worst leg, so each half is described
      // by the same code that describes it alone and the pair is reported by
      // whichever one stopped short.
      const fetched = describeStage("fetchFixtures", r.fetch);
      const picks = describeStage("generatePicks", r.picks);
      return {
        tone: picks.tone === "won" ? fetched.tone : picks.tone,
        headline: `${fetched.headline}, then ${picks.headline.toLowerCase()}`,
        detail: [fetched.detail, picks.detail].filter(Boolean).join(" "),
      };
    }

    default:
      return { tone: "won", headline: "Finished" };
  }
}

/**
 * Why nothing published, in the terms that decide what to do about it.
 *
 * Two different failures land in the same "0 generated" branch and want
 * opposite responses. Everything scoring below the floor is a calibration
 * question — how far below decides whether the floor is a shade too high or
 * the engine found nothing. Selections the grader cannot parse are a bug.
 */
function describeShortfall(r: Record<string, unknown>): string {
  const n = (k: string) => Number(r[k] ?? 0);
  const considered = n("considered");
  const noBet = n("noBetZone");
  const noBetClause = noBet ? ` ${noBet} of them were no-bet fixtures.` : "";

  // The all-rejected path: picks DID clear the floor, but their selections
  // could not be graded. Nothing to do with calibration.
  if (n("rejected") > 0 && !r.note) {
    return `${n("rejected")} of ${considered} cleared the floor but named a selection the grader cannot settle, so none were published.${noBetClause}`;
  }

  const floor = r.floor == null ? null : Number(r.floor);
  const best = r.best == null ? null : Number(r.best);

  if (floor === null) return `The engine analysed ${considered} and published none.${noBetClause}`;

  const margin =
    best === null
      ? ""
      : ` The strongest scored ${best.toFixed(1)}, ${(floor - best).toFixed(1)} short.`;

  return `All ${considered} scored below the ${floor} publication floor.${margin}${noBetClause}`;
}

/**
 * What the run cost in time, against what it had.
 *
 * The model call replaced the API call budget as the thing that stops a run,
 * and nothing in the Office said so — a run either came back or the request
 * died, with no way to tell a comfortable pass from one that finished with
 * four seconds to spare. Both readings look identical in a list of pick counts.
 *
 * Reported as used-of-budget for exactly that reason: 152s means nothing alone,
 * 152s of 240s over 7 fixtures is a sentence an operator can act on.
 */
function describeTiming(r: Record<string, unknown>): string {
  const ms = Number(r.modelDurationMs ?? 0);
  if (!ms) return "";

  const budget = Number(r.callBudgetMs ?? 0);
  const secs = (ms / 1000).toFixed(0);
  const fixtures = Number(r.fixtures ?? 0);
  const over = fixtures ? ` over ${fixtures} fixture${fixtures === 1 ? "" : "s"}` : "";

  if (!budget) return `The engine call took ${secs}s${over}.`;

  const share = Math.round((ms / budget) * 100);
  const headroom =
    share >= 75
      ? " Close enough to the ceiling that a heavier day would abort — cut the fixture count."
      : "";
  return `The engine call took ${secs}s${over}, ${share}% of its ${Math.round(budget / 1000)}s budget.${headroom}`;
}

/**
 * The stats leg of a fixture pull, in one clause.
 *
 * Absent means the pull was asked not to enrich, which is not a failure and
 * must not read as one. Zero fetched with a budget skip is the one an operator
 * needs to see, because the engine will run on names and say nothing about it.
 */
function describeStatsLeg(stats: unknown): string {
  if (stats == null) return "";
  const s = stats as Record<string, unknown>;
  if (typeof s.skipped === "string") return `No stats pulled: ${s.skipped}.`;

  const upserted = Number(s.upserted ?? 0);
  if (upserted === 0) return "No stats to pull, nothing kicks off inside the next 36 hours.";

  // An override the API budget quietly overruled looks identical to one that
  // was honoured, and the operator would go on believing they asked for 30.
  const throttled =
    s.boundBy === "budget"
      ? ` Capped at ${Number(s.limit ?? 0)} by the API budget, not by the run size you set.`
      : "";
  return `Stats attached to ${upserted} of them.${throttled}`;
}

/**
 * The board, between the fetch and the engine.
 *
 * The pull is indiscriminate: it takes every fixture the selected leagues put
 * on for the day, and some of those are ones nobody wants a pick on — a dead
 * rubber, a reserve derby, a kickoff the operator knows is in doubt. Before
 * this, the only way to keep one out of the prompt was to let the engine pay
 * for it and then delete the pick afterwards, which spends model calls to
 * produce something you already knew you would throw away.
 *
 * So the list is shown in the order `runDailyPicks` reads it, and the cut is
 * drawn where the session cap falls. Rows below the line are not going to be
 * analysed no matter what happens here, and saying so is the difference
 * between pruning the board and rearranging a list.
 */
function BoardPanel({ override }: { override?: number }) {
  const action = useOfficeAction();
  const { data, isPending } = useUpcomingFixtures();
  const config = useEngineConfig();
  const predicted = usePredictedFixtureIds();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{ deleted: number; refused: number } | null>(null);

  const fixtures = data ?? [];
  // The same function runDailyPicks calls, not a second copy of the number.
  // A line drawn here that the engine does not draw is worse than no line.
  const cap = sessionCap(
    config.data?.api_budget as { maxFixturesPerSession?: number } | undefined,
    override,
  );

  /*
   * A fixture that already has a pick cannot be dropped, and is not selectable.
   *
   * Deleting a fixture cascades to its predictions, so the route refuses one
   * that has any. Enforcing that here as well is not belt-and-braces for its
   * own sake: without it the operator ticks a dozen rows, gets four refusals
   * back, and has no way of telling WHICH four without reading ids. The server
   * check stays because this list can be stale — a run can publish between the
   * page loading and the button being pressed.
   */
  const deletable = fixtures.filter((f) => !predicted.ids.has(f.id));
  /*
   * Intersected with what is on screen, not just filtered.
   *
   * `selected` outlives a refetch, and the board refetches. A fixture that has
   * kicked off, been graded, or picked up a prediction since it was ticked is
   * no longer on this list — and sending its id anyway would ask the server to
   * delete something the operator can no longer see, which is the one thing a
   * selection UI must never do.
   */
  const onBoard = new Set(deletable.map((f) => f.id));
  const chosen = [...selected].filter((id) => onBoard.has(id));
  const allChosen = deletable.length > 0 && chosen.length === deletable.length;

  function toggle(id: string) {
    setResult(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setResult(null);
    setConfirming(false);
    setSelected(allChosen ? new Set() : new Set(deletable.map((f) => f.id)));
  }

  function remove() {
    action.mutate(
      { action: "deleteFixtures", fixtureIds: chosen },
      {
        onSuccess: (res) => {
          setResult({
            deleted: Number(res?.deleted ?? 0),
            refused: Array.isArray(res?.refused) ? res.refused.length : 0,
          });
          setSelected(new Set());
          setConfirming(false);
        },
      },
    );
  }

  return (
    <Panel
      title="Today's board"
      description={
        fixtures.length
          ? `${fixtures.length} fixture${fixtures.length === 1 ? "" : "s"} upcoming. The engine reads the first ${cap} in kickoff order, drop anything you don't want a pick on before you generate.`
          : "What the engine will read when you generate picks."
      }
      action={
        deletable.length > 0 ? (
          <button type="button" onClick={toggleAll} className={PILL}>
            {allChosen ? "Clear selection" : `Select all ${deletable.length}`}
          </button>
        ) : undefined
      }
    >
      {isPending ? (
        <Loading />
      ) : !fixtures.length ? (
        <Empty>Nothing on the board. Fetch fixtures to fill it.</Empty>
      ) : (
        <>
          <ul className="max-h-[28rem] divide-y divide-separator overflow-y-auto">
            {fixtures.map((f, i) => (
              <BoardRow
                key={f.id}
                fixture={f}
                // The cap counts from the top of this same ordering, so the row
                // that crosses it is the row the engine stops before.
                beyondCap={i >= cap}
                locked={predicted.ids.has(f.id)}
                checked={selected.has(f.id)}
                busy={action.isPending}
                onToggle={() => toggle(f.id)}
              />
            ))}
          </ul>

          {/*
            The bar appears only with a selection, so the common case — reading
            the board before generating — carries no chrome at all.
          */}
          {chosen.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-surface-secondary p-3">
              <span className="text-[13px] font-semibold">
                {chosen.length} selected
              </span>
              {confirming ? (
                <span className="flex flex-wrap items-center gap-2">
                  <span className="text-[12px] text-muted">
                    Drop {chosen.length === 1 ? "it" : "them"} from the board?
                  </span>
                  <button
                    type="button"
                    disabled={action.isPending}
                    onClick={remove}
                    className="press rounded-full px-3 py-1.5 text-[11px] font-semibold disabled:opacity-40"
                    style={{ background: "var(--lost-wash)", color: "var(--lost-ink)" }}
                  >
                    {action.isPending ? "Dropping…" : "Yes, drop"}
                  </button>
                  <button type="button" onClick={() => setConfirming(false)} className={PILL}>
                    Cancel
                  </button>
                </span>
              ) : (
                <button
                  type="button"
                  disabled={action.isPending}
                  onClick={() => setConfirming(true)}
                  className={`${PILL} inline-flex items-center gap-1.5`}
                >
                  <Trash2 className="h-3 w-3" />
                  Drop selected
                </button>
              )}
            </div>
          )}
        </>
      )}

      {/*
        Partial success is the expected outcome, so it is reported as an outcome
        rather than as an error. "12 dropped" and "12 dropped, 3 kept" are
        different events and the second one needs its reason attached.
      */}
      {result && (
        <p className="mt-3 text-[13px] leading-relaxed text-muted">
          {result.deleted} fixture{result.deleted === 1 ? "" : "s"} dropped
          {result.refused > 0
            ? `. ${result.refused} kept — ${result.refused === 1 ? "it has" : "they have"} predictions against ${result.refused === 1 ? "it" : "them"}, so removing ${result.refused === 1 ? "it" : "them"} would take those too.`
            : "."}
        </p>
      )}

      {action.error && <ActionError message={action.error.message} />}
    </Panel>
  );
}

function BoardRow({
  fixture: f,
  beyondCap,
  locked,
  checked,
  busy,
  onToggle,
}: {
  fixture: BoardFixture;
  beyondCap: boolean;
  /** Already has a prediction, so the route would refuse to remove it. */
  locked: boolean;
  checked: boolean;
  busy: boolean;
  onToggle: () => void;
}) {
  const label = `${f.home?.name ?? "?"} v ${f.away?.name ?? "?"}`;

  return (
    <li className="flex items-center gap-3 py-2.5 first:pt-0">
      {/*
        The whole row is the target, not just the box. These are 40px-tall rows
        being ticked a dozen at a time, and a 16px hit area for that is a way to
        make somebody miss and drop the wrong fixture.

        A locked row is a <div>: not disabled-looking-clickable, just not a
        control. Its reason sits in the subtitle where the row already explains
        itself, rather than in a tooltip nobody hovers.
      */}
      {locked ? (
        <div className="flex min-w-0 flex-1 items-center gap-3 opacity-60">
          <span
            aria-hidden
            className="flex h-4 w-4 flex-none items-center justify-center rounded border border-border text-[9px] text-muted"
          >
            &mdash;
          </span>
          <Crest src={f.leagues?.logo} name={f.leagues?.name ?? "?"} />
          <BoardRowText fixture={f} label={label} beyondCap={beyondCap} locked />
        </div>
      ) : (
        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={checked}
            disabled={busy}
            onChange={onToggle}
            aria-label={`Select ${label}`}
            className="h-4 w-4 flex-none accent-[var(--accent)]"
          />
          <Crest src={f.leagues?.logo} name={f.leagues?.name ?? "?"} />
          <BoardRowText fixture={f} label={label} beyondCap={beyondCap} locked={false} />
        </label>
      )}
    </li>
  );
}

function BoardRowText({
  fixture: f,
  label,
  beyondCap,
  locked,
}: {
  fixture: BoardFixture;
  label: string;
  beyondCap: boolean;
  locked: boolean;
}) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-[13px] font-semibold">{label}</span>
      <span className="block truncate text-[11px] text-muted">
        {f.leagues?.name ?? "Unknown league"} ·{" "}
        {new Date(f.fixture_date).toLocaleString(undefined, {
          day: "numeric", month: "short",
          hour: "numeric", minute: "2-digit", hour12: true,
        })}
        {beyondCap && " · past the session cap"}
        {locked && " · has a prediction, cannot be dropped"}
      </span>
    </span>
  );
}

/**
 * One run's model-call time, coloured by how close it came to the ceiling.
 *
 * Null for every row written before this was tracked, and null is rendered as
 * a dash rather than as zero — an untimed run is unknown, not instant, and a
 * column of 0s would read as the fastest runs in the table.
 */
function RunDuration({
  ms,
  fixtures,
}: {
  ms: number | null | undefined;
  fixtures: number | null | undefined;
}) {
  if (ms == null) {
    return (
      <span className="numeral text-[11px] text-muted" title="Not recorded for this run">
        &ndash;
      </span>
    );
  }

  // Three bands, and the middle one is accent rather than "pending": that wash
  // is plain white in light mode, so a badge painted with it would vanish into
  // the panel exactly when it has something to say.
  const share = ms / ENGINE_CALL_BUDGET_MS;
  const tone =
    share >= 0.75
      ? { background: "var(--lost-wash)", color: "var(--lost-ink)" }
      : share >= 0.5
        ? { background: "var(--accent-wash)", color: "var(--accent)" }
        : { background: "var(--won-wash)", color: "var(--won-ink)" };

  return (
    <span
      className="numeral rounded-full px-2 py-1 text-[11px] font-semibold"
      style={tone}
      title={`${Math.round(share * 100)}% of the ${Math.round(ENGINE_CALL_BUDGET_MS / 1000)}s call budget${
        fixtures ? `, over ${fixtures} fixture${fixtures === 1 ? "" : "s"}` : ""
      }`}
    >
      {(ms / 1000).toFixed(0)}s
    </span>
  );
}

/**
 * How many fixtures this run should work over.
 *
 * The engine reads the top N of the board in kickoff order, and N came only
 * from the active config — a number you can change in the Engine tab, which
 * writes a new config version, which is a heavy thing to do because you want a
 * three-fixture pass to check that a prompt edit did what you meant.
 *
 * The ceiling is not politeness. The route dies at 300 seconds and the model
 * client at 240, and an overrun does not return a short answer — it aborts a
 * call that has already been paid for, mid-write. So the field will not accept
 * a number above MAX_FIXTURES_OVERRIDE, and it says why rather than clamping
 * silently, because an operator who typed 60 and got 40 should know which
 * number ran.
 */
function RunSize({
  value,
  onChange,
  valid,
  effective,
}: {
  value: string;
  onChange: (v: string) => void;
  valid: boolean;
  effective: number | null;
}) {
  return (
    <div className="mb-4 rounded-2xl bg-surface-secondary p-4">
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor="run-size" className="text-[13px] font-semibold">
          Fixtures this run
        </label>
        <input
          id="run-size"
          type="number"
          inputMode="numeric"
          min={1}
          max={MAX_FIXTURES_OVERRIDE}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Config default"
          aria-invalid={!valid}
          aria-describedby="run-size-hint"
          className={`${FIELD} w-40`}
        />
        {/* Shown whenever the field holds anything, INCLUDING an invalid value.
            Gating it on `valid` is what made the out-of-range state a dead end:
            every button greyed out and the one control that clears it hidden. */}
        {value.trim() !== "" && (
          <button type="button" onClick={() => onChange("")} className={PILL}>
            Use config default
          </button>
        )}
      </div>

      <p
        id="run-size-hint"
        className="mt-2 text-[12px] leading-relaxed"
        style={{ color: valid ? "var(--muted)" : "var(--lost-ink)" }}
      >
        {!valid
          ? `Between 1 and ${MAX_FIXTURES_OVERRIDE}. Above that the model call runs past its timeout and the run aborts part-written.`
          : effective !== null
            ? `This run only. It won't change the config, and the scheduled jobs keep using the config's own cap.`
            : `Leave empty to use the active config's cap (${DEFAULT_MAX_FIXTURES_PER_SESSION} where it sets none). Applies to the fixture pull, the stats that come with it, and the engine.`}
      </p>
    </div>
  );
}

function PipelinePanel() {
  const action = useOfficeAction();
  const runs = usePredictionRuns();
  const jobs = useJobQueue();
  const [last, setLast] = useState<{ stage: string; result: unknown } | null>(null);

  /**
   * Empty means "whatever the config says", not zero.
   *
   * Held as the raw string so the field can be cleared back to the default.
   * A number with no null in it would force the operator to type the config's
   * own cap back in from memory to undo an override.
   */
  const [sizeInput, setSizeInput] = useState("");
  const parsed = Number(sizeInput);
  const size =
    sizeInput.trim() && Number.isFinite(parsed) ? Math.floor(parsed) : undefined;
  const sizeValid =
    size === undefined || (size >= 1 && size <= MAX_FIXTURES_OVERRIDE);

  async function run(stage: string) {
    setLast(null);
    try {
      // Only the three stages that read the board take it. Sending it to
      // grading or CLV would be rejected by the route's own union, which is
      // the right place for that to be enforced, but there is no reason to
      // make the request in the first place.
      const sized = ["fetchFixtures", "generatePicks", "fetchAndGenerate"].includes(stage);
      const result = await action.mutateAsync({
        action: stage,
        ...(sized && size !== undefined ? { maxFixtures: size } : {}),
      });
      setLast({ stage, result });
    } catch {
      // The mutation already holds the error and ActionError below renders it.
      // Swallowed here only so a failed stage doesn't surface as an unhandled
      // rejection in the console on top of the message the operator can see.
    }
  }

  return (
    <div className="space-y-4">
      <Panel
        title="Run a stage"
        description="These are the same functions pg_cron calls on schedule. Running one here does exactly what the scheduled job does."
        action={
          <button
            type="button"
            disabled={action.isPending || !sizeValid}
            onClick={() => run("fetchAndGenerate")}
            className="press flex flex-none items-center gap-2 rounded-full bg-accent px-5 py-2.5 text-[13px] font-semibold text-accent-foreground disabled:opacity-50"
          >
            <Zap className="h-3.5 w-3.5" />
            {action.isPending ? "Working…" : "Fetch & generate"}
          </button>
        }
      >
        {/* The whole day in one press: fixtures, their stats, then the engine.
            Called out as slow because it is the one action here that can sit
            for minutes, and a button that looks stuck gets pressed twice. */}
        <p className="mb-4 text-[13px] leading-relaxed text-muted">
          <b className="font-semibold text-foreground">Fetch &amp; generate</b> runs
          the fixture pull and the engine back to back. It takes a few minutes and
          publishes straight to the board, so use the stages below when you want to
          look at what came back first.
        </p>

        <RunSize
          value={sizeInput}
          onChange={setSizeInput}
          valid={sizeValid}
          effective={size ?? null}
        />

        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {STAGES.map((s) => (
            <button
              key={s.action}
              type="button"
              disabled={action.isPending || !sizeValid}
              onClick={() => run(s.action)}
              className="press lift flex items-start gap-3 rounded-2xl border border-border bg-background p-4 text-left disabled:opacity-50"
            >
              <span
                className="mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-full"
                style={{ background: "var(--accent-wash)", color: "var(--accent)" }}
              >
                <Play className="h-3 w-3" fill="currentColor" />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-semibold">{s.label}</span>
                <span className="mt-0.5 block text-[11px] leading-snug text-muted">
                  {s.hint}
                </span>
              </span>
            </button>
          ))}
        </div>

        {action.isPending && (
          <p className="mt-4 text-[13px] text-muted">Running…</p>
        )}

        {action.error && <ActionError message={action.error.message} />}

        {last && (() => {
          const o = describeStage(last.stage, last.result);
          const label = STAGES.find((s) => s.action === last.stage)?.label ?? last.stage;
          return (
            <div className={`mt-4 rounded-2xl border p-4 state-${o.tone}`}>
              <p className="text-[11px] font-bold uppercase tracking-[0.08em]">{label}</p>
              <p className="mt-1 text-[15px] font-semibold">{o.headline}</p>
              {o.detail && (
                <p className="mt-1 text-[13px] leading-relaxed text-muted">{o.detail}</p>
              )}
              {/* The raw object stays, folded away. An operator gets the
                  sentence; whoever is debugging gets the field that did not
                  make it into one. */}
              <details className="mt-3">
                <summary className="cursor-pointer text-[11px] text-muted">
                  Raw result
                </summary>
                <pre className="mt-2 overflow-x-auto font-mono text-[11px] leading-relaxed text-muted">
                  {JSON.stringify(last.result, null, 2)}
                </pre>
              </details>
            </div>
          );
        })()}
      </Panel>

      <BoardPanel override={size} />

      <div className="grid gap-4 lg:grid-cols-2">
        {/*
          Duration sits here rather than in a log nobody opens, because this is
          the list an operator already reads after a run. The session cap is set
          against a single measured pass — seven fixtures, 152 seconds — and the
          only way that stops being a guess is if the next twenty runs are
          visible next to the count they produced.
        */}
        <Panel
          title="Recent runs"
          description="Each engine pass, what it produced, and how long the model call took."
        >
          {runs.isPending ? (
            <Loading />
          ) : !runs.data?.length ? (
            <Empty>No runs yet.</Empty>
          ) : (
            <ul className="divide-y divide-separator">
              {runs.data.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium">
                      {new Date(r.run_at).toLocaleString(undefined, {
                        day: "numeric", month: "short",
                        hour: "numeric", minute: "2-digit", hour12: true,
                      })}
                    </p>
                    <p className="truncate font-mono text-[11px] text-muted">{r.model_version}</p>
                  </div>
                  <div className="flex flex-none items-center gap-3">
                    <RunDuration
                      ms={r.model_duration_ms}
                      fixtures={r.fixtures_considered}
                    />
                    <span className="numeral text-lg">{r.num_picks}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Job queue"
          description="Replaces Convex's scheduler, with retries and a dead-letter state it never had."
        >
          {jobs.isPending ? (
            <Loading />
          ) : !jobs.data?.length ? (
            <Empty>Queue is empty.</Empty>
          ) : (
            <ul className="divide-y divide-separator">
              {jobs.data.map((j) => (
                <li key={j.id} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-[12px]">{j.kind}</p>
                    <p className="truncate text-[11px] text-muted">
                      {j.last_error ?? `attempt ${j.attempts}/${j.max_attempts}`}
                    </p>
                  </div>
                  <Tag
                    tone={
                      j.status === "done" ? "won"
                        : j.status === "dead" || j.status === "failed" ? "lost"
                        : j.status === "running" ? "accent" : "pending"
                    }
                  >
                    {j.status}
                  </Tag>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

/* ---------------------------- predictions ---------------------------- */

function PredictionsPanel() {
  const [page, setPage] = useState(0);
  const { data, isPending } = useAdminPredictions(page);
  const action = useOfficeAction();
  const [deleting, setDeleting] = useState<string | null>(null);

  const rows = (data?.rows ?? []) as Pick[];
  const pages = Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 25));

  return (
    <Panel
      title="All predictions"
      description={`${data?.total ?? 0} on record. Deleting is for a pick that should never have been published, a settled one or one already on a customer's slip is refused and voided in Grade instead.`}
    >
      {isPending ? (
        <Loading rows={6} />
      ) : !rows.length ? (
        <Empty>Nothing to show.</Empty>
      ) : (
        <>
          <ul className="divide-y divide-separator">
            {rows.map((p) => (
              <li key={p.id} className="py-3 first:pt-0">
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold">
                      {teamShort(p.homeTeam)} v {teamShort(p.awayTeam)}
                    </p>
                    <p className="truncate text-[11px] text-muted">
                      {p.league.name} · {formatMarket(p.predictionType, p.predictedValue)}
                    </p>
                  </div>
                  <span className="numeral w-12 text-right text-sm">
                    {confidencePercent(p.confidenceScore ?? 0)}%
                  </span>
                  <span className="numeral w-8 text-right text-sm text-muted">
                    {p.stakingUnit ?? 0}u
                  </span>
                  <Tag
                    tone={
                      p.status === "won" ? "won"
                        : p.status === "lost" ? "lost"
                        : p.status === "review_needed" ? "accent" : "pending"
                    }
                  >
                    {p.status.replace("_", " ")}
                  </Tag>
                  {deleting === p.id ? (
                    <span className="flex flex-none gap-2">
                      <button
                        type="button"
                        disabled={action.isPending}
                        onClick={() =>
                          action.mutate(
                            { action: "deletePrediction", predictionId: p.id },
                            { onSuccess: () => setDeleting(null) },
                          )
                        }
                        className="press rounded-full px-3 py-1.5 text-[11px] font-semibold disabled:opacity-40"
                        style={{ background: "var(--lost-wash)", color: "var(--lost-ink)" }}
                      >
                        {action.isPending ? "Deleting…" : "Really delete"}
                      </button>
                      <button type="button" onClick={() => setDeleting(null)} className={PILL}>
                        Cancel
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setDeleting(p.id)}
                      aria-label={`Delete the ${formatMarket(p.predictionType, p.predictedValue)} pick`}
                      className={`${PILL} flex-none`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>

          {action.error && <ActionError message={action.error.message} />}

          {pages > 1 && (
            <div className="mt-5 flex items-center justify-between">
              <button
                type="button"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
                className="press rounded-full border border-border px-4 py-2 text-[13px] font-semibold disabled:opacity-40"
              >
                Previous
              </button>
              <span className="numeral text-[13px] text-muted">
                {page + 1} / {pages}
              </span>
              <button
                type="button"
                disabled={page >= pages - 1}
                onClick={() => setPage((p) => p + 1)}
                className="press rounded-full border border-border px-4 py-2 text-[13px] font-semibold disabled:opacity-40"
              >
                Next
              </button>
            </div>
          )}
        </>
      )}
    </Panel>
  );
}

/* -------------------------------- grade -------------------------------- */

function GradePanel() {
  const action = useOfficeAction();
  const { data, isPending } = useAdminPredictions(0);
  const rows = (data?.rows ?? []) as Pick[];
  const needsReview = rows.filter((p) => p.status === "review_needed");
  const unsettled = rows.filter(
    (p) => p.status === "pending" || p.status === "review_needed",
  );

  const [target, setTarget] = useState<Pick | null>(null);
  const [hg, setHg] = useState("");
  const [ag, setAg] = useState("");
  const [reason, setReason] = useState("");

  function submitResult() {
    if (!target) return;
    action.mutate({
      action: "setFixtureResult",
      fixtureId: target.fixture.id,
      homeGoals: Number(hg),
      awayGoals: Number(ag),
    });
    setTarget(null); setHg(""); setAg("");
  }

  return (
    <div className="space-y-4">
      <Panel
        title="Settle finished fixtures"
        description="Fetches results for anything that kicked off more than 2.5 hours ago and grades its predictions."
        action={
          <button
            type="button"
            disabled={action.isPending}
            onClick={() => action.mutate({ action: "gradeResults" })}
            className="press rounded-full bg-accent px-5 py-2.5 text-[13px] font-semibold text-accent-foreground disabled:opacity-50"
          >
            {action.isPending ? "Grading…" : "Grade now"}
          </button>
        }
      >
        <p className="text-[13px] leading-relaxed text-muted">
          Half-time markets grade from the stored HT score. Draw-no-bet and
          handicap pushes void rather than losing. Anything genuinely
          ungradeable is flagged below instead of being written off.
        </p>
      </Panel>

      <Panel
        title="Enter a result manually"
        description="When the feed is wrong or a market can't settle itself. The score re-grades every pending pick on that fixture through the same grader the cron uses, so a manual fix can't diverge from automatic grading."
      >
        {isPending ? (
          <Loading rows={2} />
        ) : !unsettled.length ? (
          <Empty>Nothing unsettled.</Empty>
        ) : (
          <div className="space-y-3">
            <select
              value={target?.id ?? ""}
              onChange={(e) =>
                setTarget(unsettled.find((p) => p.id === e.target.value) ?? null)
              }
              aria-label="Fixture to settle"
              className="h-11 w-full rounded-xl border border-field-border bg-field px-3 text-sm"
            >
              <option value="">Choose a fixture…</option>
              {unsettled.map((p) => (
                <option key={p.id} value={p.id}>
                  {teamShort(p.homeTeam)} v {teamShort(p.awayTeam)}, {p.league.name}
                </option>
              ))}
            </select>

            {target && (
              <div className="rise flex flex-wrap items-end gap-3 rounded-2xl bg-surface-secondary p-4">
                <label className="space-y-1.5">
                  <span className="label">{teamShort(target.homeTeam)}</span>
                  <input
                    type="number" min="0" max="30" value={hg}
                    onChange={(e) => setHg(e.target.value)}
                    className="h-11 w-20 rounded-xl border border-field-border bg-field px-3 text-center font-mono"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="label">{teamShort(target.awayTeam)}</span>
                  <input
                    type="number" min="0" max="30" value={ag}
                    onChange={(e) => setAg(e.target.value)}
                    className="h-11 w-20 rounded-xl border border-field-border bg-field px-3 text-center font-mono"
                  />
                </label>
                <button
                  type="button"
                  disabled={hg === "" || ag === "" || action.isPending}
                  onClick={submitResult}
                  className="press ml-auto h-11 rounded-full bg-accent px-5 text-[13px] font-semibold text-accent-foreground disabled:opacity-40"
                >
                  Settle &amp; grade
                </button>
              </div>
            )}
          </div>
        )}
      </Panel>

      <Panel
        title="Override a prediction"
        description="Force an outcome when grading got it wrong. Every override records who did it and why."
      >
        {!unsettled.length && !rows.length ? (
          <Empty>Nothing to override.</Empty>
        ) : (
          <div className="space-y-3">
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this being overridden?"
              aria-label="Override reason"
              className="h-11 w-full rounded-xl border border-field-border bg-field px-4 text-sm placeholder:text-field-placeholder"
            />
            <ul className="divide-y divide-separator">
              {rows.slice(0, 8).map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2 py-3 first:pt-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold">
                      {teamShort(p.homeTeam)} v {teamShort(p.awayTeam)}
                    </p>
                    <p className="truncate text-[11px] text-muted">
                      {formatMarket(p.predictionType, p.predictedValue)} · {p.status}
                    </p>
                  </div>
                  {(["won", "lost", "void"] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      disabled={reason.trim().length < 3 || action.isPending}
                      onClick={() =>
                        action.mutate({
                          action: "overridePrediction",
                          predictionId: p.id,
                          status: st,
                          reason: reason.trim(),
                        })
                      }
                      className="press rounded-full border border-border px-3 py-1.5 text-[11px] font-semibold capitalize disabled:opacity-30"
                    >
                      {st}
                    </button>
                  ))}
                </li>
              ))}
            </ul>
            {reason.trim().length < 3 && (
              <p className="text-[11px] text-muted">
                Enter a reason to enable the override buttons.
              </p>
            )}
          </div>
        )}
      </Panel>

      <Panel
        title="Needs a human"
        description="Markets the grader can't settle on its own, corners need a data feed we don't call."
      >
        {isPending ? (
          <Loading />
        ) : !needsReview.length ? (
          <Empty>Nothing waiting on a decision.</Empty>
        ) : (
          <ul className="divide-y divide-separator">
            {needsReview.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-3 first:pt-0">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold">
                    {teamShort(p.homeTeam)} v {teamShort(p.awayTeam)}
                  </p>
                  <p className="truncate text-[11px] text-muted">{p.league.name}</p>
                </div>
                <Tag tone="accent">
                  <AlertTriangle className="h-3 w-3" />
                  {formatMarket(p.predictionType, p.predictedValue)}
                </Tag>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/* ------------------------------- catalog ------------------------------- */

const FIELD = "h-11 rounded-xl border border-field-border bg-field px-3 text-sm placeholder:text-field-placeholder";
const PILL = "press rounded-full border border-border px-3 py-1.5 text-[11px] font-semibold disabled:opacity-30";

function CatalogPanel() {
  return (
    <div className="space-y-4">
      {/*
        Coverage, then import, then what you already hold.

        The order follows the job rather than the data model. Coverage decides
        which leagues the daily fetch even asks about; importing is how a league
        gets into that list in the first place. Both are things you come to this
        tab to DO. The league and team tables are what you come to check, and a
        catalogue that grows past a few hundred rows pushed the import search
        below a fold nobody scrolled to — so the answer to "this league is
        missing" sat underneath the list proving it was missing.
      */}
      <CoveragePanel />
      <ImportPanel />
      <div className="grid gap-4 lg:grid-cols-2">
        <LeaguesPanel />
        <TeamsPanel />
      </div>
    </div>
  );
}

/**
 * Which leagues the daily fetch covers.
 *
 * This is the single most consequential setting in the Office: it decides what
 * the engine ever sees. It reads and writes API-Football's league ids, so only
 * leagues that carry an external id can be selected, a hand-created league has
 * nothing to fetch against.
 */
function CoveragePanel() {
  const { data: config, isPending } = useEngineConfig();
  const { data: catalog } = useCatalog();
  const action = useOfficeAction();
  const [draft, setDraft] = useState<number[] | null>(null);

  const saved: number[] = config?.selected_league_ids ?? [];
  const selected = draft ?? saved;
  const dirty = draft !== null && (draft.length !== saved.length || draft.some((id) => !saved.includes(id)));

  const selectable = (catalog?.leagues ?? []).filter((l) => l.external_id !== null);

  function toggle(externalId: number) {
    const next = selected.includes(externalId)
      ? selected.filter((id) => id !== externalId)
      : [...selected, externalId];
    setDraft(next);
  }

  if (isPending) {
    return <Panel title="Engine coverage"><Loading rows={3} /></Panel>;
  }
  if (!config) {
    return (
      <Panel title="Engine coverage">
        <Empty>No active engine config to attach coverage to.</Empty>
      </Panel>
    );
  }

  return (
    <Panel
      title="Engine coverage"
      description="The leagues the daily fixture fetch pulls, and therefore the only matches the engine can ever pick from."
      action={
        <button
          type="button"
          disabled={!dirty || action.isPending}
          onClick={() =>
            action.mutate(
              {
                action: "setSelectedLeagues",
                configId: config.id,
                leagueExternalIds: selected,
              },
              { onSuccess: () => setDraft(null) },
            )
          }
          className="press rounded-full bg-accent px-5 py-2.5 text-[13px] font-semibold text-accent-foreground disabled:opacity-40"
        >
          {action.isPending ? "Saving…" : dirty ? "Save coverage" : "Saved"}
        </button>
      }
    >
      {!selectable.length ? (
        <Empty>No leagues with an upstream id yet. Import one below.</Empty>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {selectable.map((l) => {
              const on = selected.includes(l.external_id!);
              return (
                <button
                  key={l.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(l.external_id!)}
                  className="press flex items-center gap-2 rounded-full border px-4 py-2 text-[12px] font-semibold"
                  style={{
                    borderColor: on ? "var(--accent)" : "var(--border)",
                    background: on ? "color-mix(in oklab, var(--accent) 10%, transparent)" : "transparent",
                    color: on ? "var(--accent)" : "var(--muted)",
                  }}
                >
                  {on && <Check className="h-3.5 w-3.5" />}
                  {l.name}
                  <span className="numeral opacity-60">{l.external_id}</span>
                </button>
              );
            })}
          </div>

          {!selected.length && (
            <p className="mt-4 text-[12px] leading-relaxed" style={{ color: "var(--pending-ink)" }}>
              Nothing selected, the fetch falls back to its six built-in leagues.
              Select explicitly if you want that decision recorded.
            </p>
          )}
        </>
      )}

      {action.error && <ActionError message={action.error.message} />}
    </Panel>
  );
}

function LeaguesPanel() {
  const { data, isPending } = useCatalog();
  const action = useOfficeAction();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  return (
    <Panel
      title="Leagues"
      description={`${data?.leagues.length ?? 0} tracked.`}
      action={
        <button type="button" onClick={() => setAdding((v) => !v)} className={PILL}>
          {adding ? "Cancel" : "Add"}
        </button>
      }
    >
      {adding && (
        <NewLeagueForm
          busy={action.isPending}
          onSubmit={(fields) =>
            action.mutate(
              { action: "createLeague", ...fields },
              { onSuccess: () => setAdding(false) },
            )
          }
        />
      )}

      {isPending ? (
        <Loading />
      ) : !data?.leagues.length ? (
        <Empty>No leagues yet.</Empty>
      ) : (
        <ul className="divide-y divide-separator">
          {data.leagues.map((l) =>
            editing === l.id ? (
              <li key={l.id} className="py-3 first:pt-0">
                <EditLeagueForm
                  league={l}
                  busy={action.isPending}
                  onCancel={() => setEditing(null)}
                  onSubmit={(fields) =>
                    action.mutate(
                      { action: "updateLeague", leagueId: l.id, ...fields },
                      { onSuccess: () => setEditing(null) },
                    )
                  }
                />
              </li>
            ) : (
              <li key={l.id} className="flex items-center justify-between gap-3 py-3 first:pt-0">
                <Crest src={l.logo} name={l.name} size={22} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold">{l.name}</p>
                  <p className="truncate text-[11px] text-muted">
                    {l.country} · season {l.season ?? "-"} · id {l.external_id ?? "-"}
                  </p>
                </div>
                <div className="flex flex-none items-center gap-2">
                  <Tag tone={l.is_active ? "won" : "pending"}>
                    {l.is_active ? "active" : "off"}
                  </Tag>
                  <button type="button" onClick={() => setEditing(l.id)} className={PILL}>
                    Edit
                  </button>
                </div>
              </li>
            ),
          )}
        </ul>
      )}

      {action.error && <ActionError message={action.error.message} />}
    </Panel>
  );
}

function TeamsPanel() {
  const { data, isPending } = useCatalog();
  const action = useOfficeAction();
  const [league, setLeague] = useState<string>("all");
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  const teams = (data?.teams ?? []).filter(
    (t) => league === "all" || t.league_id === league,
  );
  const leagues = data?.leagues ?? [];

  return (
    <Panel
      title="Teams"
      description={`${teams.length} shown of ${data?.teams.length ?? 0}.`}
      action={
        <button
          type="button"
          disabled={!leagues.length}
          onClick={() => setAdding((v) => !v)}
          className={PILL}
        >
          {adding ? "Cancel" : "Add"}
        </button>
      }
    >
      <select
        value={league}
        onChange={(e) => setLeague(e.target.value)}
        aria-label="Filter teams by league"
        className={`${FIELD} mb-3 w-full`}
      >
        <option value="all">All leagues</option>
        {leagues.map((l) => (
          <option key={l.id} value={l.id}>{l.name}</option>
        ))}
      </select>

      {adding && (
        <NewTeamForm
          leagues={leagues}
          defaultLeagueId={league === "all" ? leagues[0]?.id : league}
          busy={action.isPending}
          onSubmit={(fields) =>
            action.mutate(
              { action: "createTeam", ...fields },
              { onSuccess: () => setAdding(false) },
            )
          }
        />
      )}

      {isPending ? (
        <Loading />
      ) : !teams.length ? (
        <Empty>No teams here.</Empty>
      ) : (
        <ul className="max-h-[26rem] divide-y divide-separator overflow-y-auto">
          {teams.map((t) =>
            editing === t.id ? (
              <li key={t.id} className="py-3 first:pt-0">
                <EditTeamForm
                  team={t}
                  leagues={leagues}
                  busy={action.isPending}
                  onCancel={() => setEditing(null)}
                  onDelete={() =>
                    action.mutate(
                      { action: "deleteTeam", teamId: t.id },
                      { onSuccess: () => setEditing(null) },
                    )
                  }
                  onSubmit={(fields) =>
                    action.mutate(
                      { action: "updateTeam", teamId: t.id, ...fields },
                      { onSuccess: () => setEditing(null) },
                    )
                  }
                />
              </li>
            ) : (
              <li key={t.id} className="flex items-center gap-3 py-2.5 first:pt-0">
                <Crest src={t.logo} name={t.name} />
                <span className="min-w-0 flex-1 truncate text-[13px]">
                  {t.name}
                  {!t.is_active && <span className="ml-2 text-[11px] text-muted">off</span>}
                </span>
                <span className="numeral flex-none text-[11px] text-muted">{t.short_name}</span>
                <button type="button" onClick={() => setEditing(t.id)} className={PILL}>
                  Edit
                </button>
              </li>
            ),
          )}
        </ul>
      )}

      {action.error && <ActionError message={action.error.message} />}
    </Panel>
  );
}

/* --------------------------- catalogue import --------------------------- */

type LeagueHit = {
  externalId: number;
  name: string;
  country: string;
  currentSeason: number | null;
  logo: string | null;
};
type TeamHit = {
  externalId: number;
  name: string;
  shortName: string | null;
  logo: string | null;
};

function ImportPanel() {
  const { data: catalog } = useCatalog();
  const action = useOfficeAction();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<"leagues" | "teams">("leagues");
  const [hits, setHits] = useState<{ leagues: LeagueHit[]; teams: TeamHit[] } | null>(null);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState<string>("");

  const leagues = catalog?.leagues ?? [];
  const known = new Set(leagues.map((l) => l.external_id));

  async function search() {
    setError(null);
    setSearching(true);
    setHits(null);
    try {
      const res = await fetch("/api/office", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: kind === "leagues" ? "searchLeagues" : "searchTeams",
          query: query.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Search failed.");
      setHits(
        kind === "leagues"
          ? { leagues: json.results, teams: [] }
          : { leagues: [], teams: json.results },
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Search failed.");
    } finally {
      setSearching(false);
    }
  }

  return (
    <Panel
      title="Find and import"
      description="Search the upstream catalogue for competitions and clubs you don't track yet. Importing a league only adds the league, pull its squad list separately."
    >
      <div className="flex flex-wrap gap-2">
        <div className="flex rounded-full border border-border p-1">
          {(["leagues", "teams"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => { setKind(k); setHits(null); }}
              className="press rounded-full px-4 py-1.5 text-[12px] font-semibold capitalize"
              style={
                kind === k
                  ? { background: "var(--accent)", color: "var(--accent-foreground)" }
                  : { color: "var(--muted)" }
              }
            >
              {k}
            </button>
          ))}
        </div>

        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && query.trim().length >= 3) search(); }}
          placeholder={kind === "leagues" ? "Primeira, Turkey…" : "Benfica, Arsenal…"}
          aria-label={`Search ${kind}`}
          className={`${FIELD} min-w-48 flex-1`}
        />
        <button
          type="button"
          disabled={query.trim().length < 3 || searching}
          onClick={search}
          className="press rounded-full bg-accent px-5 text-[13px] font-semibold text-accent-foreground disabled:opacity-40"
        >
          {searching ? "Searching…" : "Search"}
        </button>
      </div>

      {query.trim().length > 0 && query.trim().length < 3 && (
        <p className="mt-2 text-[11px] text-muted">At least three characters.</p>
      )}

      {error && <ActionError message={error} />}

      {hits?.leagues.map((l) => {
        const already = known.has(l.externalId);
        const local = leagues.find((row) => row.external_id === l.externalId);
        return (
          <div
            key={l.externalId}
            className="mt-3 flex flex-wrap items-center gap-3 rounded-2xl bg-surface-secondary p-4"
          >
            <Crest src={l.logo} name={l.name} size={22} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold">{l.name}</p>
              <p className="truncate text-[11px] text-muted">
                {l.country} · season {l.currentSeason ?? "-"} · id {l.externalId}
              </p>
            </div>

            {already && local ? (
              <button
                type="button"
                disabled={action.isPending || l.currentSeason === null}
                onClick={() =>
                  action.mutate({
                    action: "importTeams",
                    leagueId: local.id,
                    leagueExternalId: l.externalId,
                    season: l.currentSeason!,
                  })
                }
                className={PILL}
              >
                Pull teams
              </button>
            ) : (
              <button
                type="button"
                disabled={action.isPending || l.currentSeason === null}
                onClick={() =>
                  action.mutate({
                    action: "importLeague",
                    externalId: l.externalId,
                    name: l.name,
                    country: l.country,
                    season: l.currentSeason!,
                  })
                }
                className="press rounded-full bg-accent px-4 py-1.5 text-[12px] font-semibold text-accent-foreground disabled:opacity-40"
              >
                Import with teams
              </button>
            )}
          </div>
        );
      })}

      {hits && hits.teams.length > 0 && (
        <div className="mt-3 space-y-3">
          <select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            aria-label="League to import teams into"
            className={`${FIELD} w-full`}
          >
            <option value="">Import into which league?</option>
            {leagues.map((l) => (
              <option key={l.id} value={l.id}>{l.name}</option>
            ))}
          </select>

          <ul className="divide-y divide-separator">
            {hits.teams.map((t) => (
              <li key={t.externalId} className="flex items-center gap-3 py-2.5">
                <Crest src={t.logo} name={t.name} />
                <span className="min-w-0 flex-1 truncate text-[13px]">{t.name}</span>
                <span className="numeral flex-none text-[11px] text-muted">
                  {t.shortName ?? "-"}
                </span>
                <button
                  type="button"
                  disabled={!target || action.isPending}
                  onClick={() =>
                    action.mutate({
                      action: "createTeam",
                      leagueId: target,
                      name: t.name,
                      ...(t.shortName ? { shortName: t.shortName } : {}),
                    })
                  }
                  className={PILL}
                >
                  Add
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {hits && !hits.leagues.length && !hits.teams.length && (
        <Empty>Nothing matched.</Empty>
      )}

      {action.error && <ActionError message={action.error.message} />}
      {action.data?.imported !== undefined && (
        <p className="mt-3 text-[12px]" style={{ color: "var(--won-ink)" }}>
          Imported {action.data.imported} team{action.data.imported === 1 ? "" : "s"}.
        </p>
      )}
    </Panel>
  );
}

/* ---------------------------- catalog forms ---------------------------- */

function ActionError({ message }: { message: string }) {
  return (
    <Alert status="danger" className="mt-4">
      {message}
    </Alert>
  );
}

function NewLeagueForm({
  busy,
  onSubmit,
}: {
  busy: boolean;
  onSubmit: (fields: { name: string; country: string; season?: number }) => void;
}) {
  const [name, setName] = useState("");
  const [country, setCountry] = useState("");
  const [season, setSeason] = useState("");

  return (
    <div className="rise mb-4 space-y-3 rounded-2xl bg-surface-secondary p-4">
      <p className="text-[12px] leading-relaxed text-muted">
        A league added by hand has no upstream id, so nothing will fetch for it.
        Use it for competitions you grade manually.
      </p>
      <div className="flex flex-wrap gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" aria-label="League name" className={`${FIELD} min-w-40 flex-1`} />
        <input value={country} onChange={(e) => setCountry(e.target.value)} placeholder="Country" aria-label="Country" className={`${FIELD} min-w-32 flex-1`} />
        <input value={season} onChange={(e) => setSeason(e.target.value)} placeholder="Season" inputMode="numeric" aria-label="Season" className={`${FIELD} w-24`} />
      </div>
      <button
        type="button"
        disabled={!name.trim() || !country.trim() || busy}
        onClick={() =>
          onSubmit({
            name: name.trim(),
            country: country.trim(),
            ...(season.trim() ? { season: Number(season) } : {}),
          })
        }
        className="press rounded-full bg-accent px-5 py-2 text-[13px] font-semibold text-accent-foreground disabled:opacity-40"
      >
        Create league
      </button>
    </div>
  );
}

function EditLeagueForm({
  league,
  busy,
  onCancel,
  onSubmit,
}: {
  league: CatalogLeague;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (fields: { name: string; country: string; season: number | null; isActive: boolean }) => void;
}) {
  const [name, setName] = useState(league.name);
  const [country, setCountry] = useState(league.country);
  const [season, setSeason] = useState(league.season?.toString() ?? "");
  const [isActive, setIsActive] = useState(league.is_active);

  return (
    <div className="rise space-y-3 rounded-2xl bg-surface-secondary p-4">
      <div className="flex flex-wrap gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} aria-label="League name" className={`${FIELD} min-w-40 flex-1`} />
        <input value={country} onChange={(e) => setCountry(e.target.value)} aria-label="Country" className={`${FIELD} min-w-32 flex-1`} />
        <input value={season} onChange={(e) => setSeason(e.target.value)} inputMode="numeric" aria-label="Season" className={`${FIELD} w-24`} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={isActive}
          onClick={() => setIsActive((v) => !v)}
          className={PILL}
        >
          {isActive ? "Active" : "Inactive"}
        </button>
        <button
          type="button"
          disabled={!name.trim() || !country.trim() || busy}
          onClick={() =>
            onSubmit({
              name: name.trim(),
              country: country.trim(),
              season: season.trim() ? Number(season) : null,
              isActive,
            })
          }
          className="press ml-auto rounded-full bg-accent px-5 py-2 text-[13px] font-semibold text-accent-foreground disabled:opacity-40"
        >
          Save
        </button>
        <button type="button" onClick={onCancel} className={PILL}>Cancel</button>
      </div>
    </div>
  );
}

function NewTeamForm({
  leagues,
  defaultLeagueId,
  busy,
  onSubmit,
}: {
  leagues: CatalogLeague[];
  defaultLeagueId?: string;
  busy: boolean;
  onSubmit: (fields: { leagueId: string; name: string; shortName?: string }) => void;
}) {
  const [leagueId, setLeagueId] = useState(defaultLeagueId ?? "");
  const [name, setName] = useState("");
  const [shortName, setShortName] = useState("");

  return (
    <div className="rise mb-4 space-y-3 rounded-2xl bg-surface-secondary p-4">
      <select value={leagueId} onChange={(e) => setLeagueId(e.target.value)} aria-label="League" className={`${FIELD} w-full`}>
        <option value="">Choose a league…</option>
        {leagues.map((l) => (
          <option key={l.id} value={l.id}>{l.name}</option>
        ))}
      </select>
      <div className="flex flex-wrap gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Team name" aria-label="Team name" className={`${FIELD} min-w-40 flex-1`} />
        <input value={shortName} onChange={(e) => setShortName(e.target.value)} placeholder="ABC" maxLength={8} aria-label="Short name" className={`${FIELD} w-24 text-center uppercase`} />
      </div>
      <button
        type="button"
        disabled={!leagueId || !name.trim() || busy}
        onClick={() =>
          onSubmit({
            leagueId,
            name: name.trim(),
            ...(shortName.trim() ? { shortName: shortName.trim() } : {}),
          })
        }
        className="press rounded-full bg-accent px-5 py-2 text-[13px] font-semibold text-accent-foreground disabled:opacity-40"
      >
        Create team
      </button>
    </div>
  );
}

function EditTeamForm({
  team,
  leagues,
  busy,
  onCancel,
  onDelete,
  onSubmit,
}: {
  team: CatalogTeam;
  leagues: CatalogLeague[];
  busy: boolean;
  onCancel: () => void;
  onDelete: () => void;
  onSubmit: (fields: { name: string; shortName: string; leagueId: string; isActive: boolean }) => void;
}) {
  const [name, setName] = useState(team.name);
  const [shortName, setShortName] = useState(team.short_name);
  const [leagueId, setLeagueId] = useState(team.league_id);
  const [isActive, setIsActive] = useState(team.is_active);
  const [confirming, setConfirming] = useState(false);

  return (
    <div className="rise space-y-3 rounded-2xl bg-surface-secondary p-4">
      <div className="flex flex-wrap gap-2">
        <input value={name} onChange={(e) => setName(e.target.value)} aria-label="Team name" className={`${FIELD} min-w-40 flex-1`} />
        <input value={shortName} onChange={(e) => setShortName(e.target.value)} maxLength={8} aria-label="Short name" className={`${FIELD} w-24 text-center uppercase`} />
      </div>
      <select value={leagueId} onChange={(e) => setLeagueId(e.target.value)} aria-label="League" className={`${FIELD} w-full`}>
        {leagues.map((l) => (
          <option key={l.id} value={l.id}>{l.name}</option>
        ))}
      </select>

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" aria-pressed={isActive} onClick={() => setIsActive((v) => !v)} className={PILL}>
          {isActive ? "Active" : "Inactive"}
        </button>

        {confirming ? (
          <button
            type="button"
            disabled={busy}
            onClick={onDelete}
            className="press rounded-full px-3 py-1.5 text-[11px] font-semibold disabled:opacity-30"
            style={{ background: "var(--lost-wash)", color: "var(--lost-ink)" }}
          >
            Really delete
          </button>
        ) : (
          <button type="button" onClick={() => setConfirming(true)} className={PILL}>
            Delete
          </button>
        )}

        <button
          type="button"
          disabled={!name.trim() || !shortName.trim() || busy}
          onClick={() =>
            onSubmit({
              name: name.trim(),
              shortName: shortName.trim(),
              leagueId,
              isActive,
            })
          }
          className="press ml-auto rounded-full bg-accent px-5 py-2 text-[13px] font-semibold text-accent-foreground disabled:opacity-40"
        >
          Save
        </button>
        <button type="button" onClick={onCancel} className={PILL}>Cancel</button>
      </div>
    </div>
  );
}

/* ------------------------------- engine ------------------------------- */

/**
 * Config versions.
 *
 * The schema has always supported active / draft / archived and enforced a
 * single active row, but nothing could create a draft or promote one, so the
 * only way to change the engine was to edit the live config in place, with no
 * way back if the change was wrong.
 *
 * A draft is a full copy, so experimenting costs nothing and the incumbent
 * keeps running untouched until someone deliberately promotes its replacement.
 */
function ConfigVersions() {
  const { data: configs, isPending } = useAllConfigs();
  const action = useOfficeAction();
  const [drafting, setDrafting] = useState(false);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");

  const live = configs?.find((c) => c.status === "active");

  return (
    <Panel
      title="Versions"
      description="Draft a copy, tune it, then promote it. The live config keeps running until you do."
      action={
        live && (
          <button
            type="button"
            onClick={() => setDrafting((v) => !v)}
            className={PILL}
          >
            {drafting ? "Cancel" : "New draft"}
          </button>
        )
      }
    >
      {drafting && live && (
        <div className="rise mb-4 space-y-3 rounded-2xl bg-surface-secondary p-4">
          <p className="text-[12px] leading-relaxed text-muted">
            Copies every setting from <strong>{live.name}</strong> v{live.version}.
            Nothing goes live until you promote it.
          </p>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name this draft"
            aria-label="Draft name"
            className={`${FIELD} w-full`}
          />
          <input
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="What are you changing, and why?"
            aria-label="Draft notes"
            className={`${FIELD} w-full`}
          />
          <button
            type="button"
            disabled={!name.trim() || action.isPending}
            onClick={() =>
              action.mutate(
                {
                  action: "createDraftConfig",
                  fromConfigId: live.id,
                  name: name.trim(),
                  ...(notes.trim() ? { notes: notes.trim() } : {}),
                },
                {
                  onSuccess: () => {
                    setDrafting(false);
                    setName("");
                    setNotes("");
                  },
                },
              )
            }
            className="press rounded-full bg-accent px-5 py-2 text-[13px] font-semibold text-accent-foreground disabled:opacity-40"
          >
            Create draft
          </button>
        </div>
      )}

      {isPending ? (
        <Loading rows={3} />
      ) : !configs?.length ? (
        <Empty>No configs.</Empty>
      ) : (
        <ul className="divide-y divide-separator">
          {configs.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-semibold">
                  {c.name} <span className="numeral text-muted">v{c.version}</span>
                </p>
                <p className="truncate text-[11px] text-muted">
                  {c.notes || "No notes"}
                  {c.approved_by ? ` · ${c.approved_by}` : ""}
                </p>
              </div>

              <Tag tone={c.status === "active" ? "won" : c.status === "draft" ? "accent" : "pending"}>
                {c.status}
              </Tag>

              {c.status !== "active" && (
                <button
                  type="button"
                  disabled={action.isPending}
                  onClick={() => action.mutate({ action: "activateConfig", configId: c.id })}
                  className={PILL}
                >
                  Promote
                </button>
              )}
              {c.status === "draft" && (
                <button
                  type="button"
                  disabled={action.isPending}
                  onClick={() => action.mutate({ action: "archiveConfig", configId: c.id })}
                  className={PILL}
                >
                  Archive
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {action.error && <ActionError message={action.error.message} />}
    </Panel>
  );
}

/**
 * Variable resolution for the prompt currently in the editor.
 *
 * The question this answers is the one that used to be unanswerable: when you
 * change a number in the config, does the engine actually see it? Before the
 * variable table, most keys resolved to nothing, the names in the config and
 * the names in the prompt were different vocabularies, and the interface gave
 * no hint. Anything listed here as a default is a number you are not
 * controlling, whatever the config says.
 */
function PromptVariables({
  config,
  prompt,
}: {
  config: Record<string, unknown>;
  prompt: string;
}) {
  const resolved = useMemo(() => {
    const used = new Set(placeholdersIn(prompt));
    const { values, overrides, fallbacks, unknownKeys } = resolveEngineVariables(config);
    return {
      used,
      values,
      overrides: overrides.filter((k) => used.has(k)),
      fallbacks: fallbacks.filter((k) => used.has(k)),
      undefinedInTable: [...used].filter((k) => !VARIABLES_BY_KEY.has(k)),
      unknownKeys,
      warnings: validateEngineVariables(values),
    };
  }, [config, prompt]);

  const tiles: [string, string | number, string?][] = [
    ["Referenced", resolved.used.size],
    ["From config", resolved.overrides.length],
    ["Built-in default", resolved.fallbacks.length],
  ];

  return (
    <Panel
      title="Prompt variables"
      description="Substituted into the prompt before it reaches the engine. A variable on its built-in default is one this config is not steering."
    >
      <div className="grid gap-3 sm:grid-cols-3">
        {tiles.map(([label, value]) => (
          <div key={label} className="rounded-2xl bg-surface-secondary p-4">
            <p className="label">{label}</p>
            <p className="numeral mt-1.5 text-xl">{value}</p>
          </div>
        ))}
      </div>

      {resolved.undefinedInTable.length > 0 && (
        <Alert status="danger" className="mt-4">
          <span className="font-semibold">
            The prompt will not render.
          </span>{" "}
          {resolved.undefinedInTable.length} placeholder
          {resolved.undefinedInTable.length === 1 ? "" : "s"} have no definition, so the daily run
          will throw rather than send a half-filled prompt:{" "}
          <code className="font-mono">{resolved.undefinedInTable.join(", ")}</code>
        </Alert>
      )}

      {resolved.warnings.map((w) => (
        <Alert status="warning" className="mt-3" key={w.key}>
          <code className="font-mono font-semibold">
            {w.key} = {String(w.value)}
          </code>{" "}
, {w.message}
        </Alert>
      ))}

      {resolved.unknownKeys.length > 0 && (
        <Alert status="warning" className="mt-3">
          {resolved.unknownKeys.length} config key
          {resolved.unknownKeys.length === 1 ? "" : "s"} match no known variable and are ignored
          entirely: <code className="font-mono">{resolved.unknownKeys.join(", ")}</code>
        </Alert>
      )}

      {resolved.fallbacks.length > 0 && (
        <details className="mt-4 rounded-2xl border border-field-border bg-field p-4">
          <summary className="cursor-pointer text-[13px] font-semibold">
            {resolved.fallbacks.length} on built-in defaults
          </summary>
          <div className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
            {resolved.fallbacks.map((key) => (
              <div key={key} className="flex items-baseline justify-between gap-3 text-[12px]">
                <code className="font-mono text-muted">{key}</code>
                <span className="numeral">{String(resolved.values[key])}</span>
              </div>
            ))}
          </div>
        </details>
      )}
    </Panel>
  );
}

/**
 * The USD/GHS fallback rate.
 *
 * This is what every customer is charged at whenever the FX provider is down or
 * answers with something implausible. It used to be a constant in source, which
 * meant correcting it needed a deploy, and GHS does not wait for one.
 *
 * The panel names the layer in force, because "15" means something different
 * depending on whether someone chose it or it is the compiled-in default nobody
 * has touched since the file was written.
 */
function FxFallbackPanel() {
  const { data: fx, isPending } = useFxFallback();
  const action = useOfficeAction();
  const qc = useQueryClient();
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (isPending || !fx) {
    return (
      <Panel title="Fallback exchange rate">
        <Loading rows={2} />
      </Panel>
    );
  }

  const value = draft ?? (fx.officeValue == null ? "" : String(fx.officeValue));
  const parsed = value.trim() === "" ? null : Number(value);
  const valid = parsed === null || (Number.isFinite(parsed) && parsed >= 1 && parsed <= 200);
  const dirty = value !== (fx.officeValue == null ? "" : String(fx.officeValue));

  const SOURCE_NOTE = {
    office: "Set here. This overrides the environment.",
    env: "From FALLBACK_USD_TO_GHS in the environment. Set a value here to override it.",
    constant:
      "No override and no environment variable, so this is the compiled-in default. Worth setting deliberately.",
  }[fx.source];

  async function save() {
    setError(null);
    try {
      await action.mutateAsync({ action: "setFxFallback", rate: parsed });
      setDraft(null);
      qc.invalidateQueries({ queryKey: adminKeys.fx });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save the rate.");
    }
  }

  return (
    <Panel
      title="Fallback exchange rate"
      description="USD to GHS, used only when the live rate lookup fails. Passes are priced in USD and charged in cedis, so this is a live pricing control."
      action={
        <span className="numeral text-sm">
          1 USD = {fx.rate} GHS
        </span>
      }
    >
      {error && (
        <Alert status="danger" className="mb-4">
          {error}
        </Alert>
      )}

      <p className="mb-4 text-[13px] text-muted">{SOURCE_NOTE}</p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1.5">
          <span className="label">Override</span>
          <input
            type="number"
            step="0.01"
            min="1"
            max="200"
            placeholder="not set"
            value={value}
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            className={`h-11 w-40 rounded-xl border bg-field px-3 font-mono text-sm ${
              valid ? "border-field-border" : "border-danger"
            }`}
          />
        </label>

        <button
          type="button"
          disabled={!dirty || !valid || action.isPending}
          onClick={save}
          className="press h-11 rounded-full bg-accent px-5 text-[13px] font-semibold text-accent-foreground disabled:opacity-40"
        >
          {action.isPending ? "Saving…" : "Save rate"}
        </button>

        {fx.officeValue != null && (
          <button
            type="button"
            disabled={action.isPending}
            onClick={() => {
              setDraft("");
              setError(null);
            }}
            className="h-11 text-[13px] font-medium text-muted"
          >
            Clear override
          </button>
        )}
      </div>

      {!valid && (
        <p className="mt-3 text-[12px] text-danger">
          Enter a rate between 1 and 200, or clear the field to fall back to the environment.
        </p>
      )}
    </Panel>
  );
}

const GROUP_LABELS: Record<VariableGroup, string> = {
  weights: "Ranking weights",
  systemic: "Systemic filters",
  personnel: "Personnel",
  market: "Market and odds",
  contextual: "Travel, rest and surface",
  environmental: "Weather and altitude",
  referee: "Referee",
  form: "Form",
  h2h: "Head to head",
  anchoring: "Anchoring",
  staking: "Staking",
  caps: "Penalty caps",
};

/** Order the editor renders groups in: gated-only groups last. */
const GROUP_ORDER: VariableGroup[] = [
  "systemic",
  "form",
  "h2h",
  "anchoring",
  "caps",
  "staking",
  "market",
  "contextual",
  "personnel",
  "environmental",
  "referee",
];

/**
 * Editor for every tunable that is not a ranking weight.
 *
 * Before this, 96 of the 105 variables could only be changed by writing SQL
 * against `ai_engine_config`, which meant the gated overlays, the thresholds
 * the whole prompt architecture is built around, were the least reachable
 * numbers in the product.
 *
 * Weights are deliberately absent: they must sum to 1.0 and the panel above
 * enforces that. Two editors writing the same column is how that invariant
 * gets broken.
 *
 * A gated variable is shown, not hidden. It is inert today because no feed
 * supplies its input, and hiding it would make the day the feed arrives a
 * search through source rather than a visit to this page. The badge says which
 * is which.
 */
/**
 * The publish floor, editable in place.
 *
 * Goes through the same `updateVariables` action the Overlay panel uses, so it
 * is validated by the same server-side rules and written to the same audit log.
 * This is a second door onto one control, not a second control.
 *
 * Deliberately unsaved until pressed. Typing "6" through a live-binding input
 * would pass through 0.6 and 0 on the way if someone cleared it first, and each
 * of those is a publishable floor that would ship a board of noise.
 */
function PublishFloor({
  config,
}: {
  config: Record<string, unknown> & { id: string };
}) {
  const action = useOfficeAction();
  const live = Number(
    (config.confidence_thresholds as Record<string, number> | undefined)
      ?.primarySlipFloor ?? 7,
  );
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const value = draft ?? String(live);
  const parsed = Number(value);
  const valid = value.trim() !== "" && Number.isFinite(parsed) && parsed >= 0 && parsed <= 10;
  const dirty = valid && parsed !== live;

  async function save() {
    setError(null);
    try {
      await action.mutateAsync({
        action: "updateVariables",
        configId: config.id,
        values: { primarySlipFloor: parsed },
      });
      setDraft(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save.");
    }
  }

  return (
    <div className="rounded-2xl bg-surface-secondary p-4">
      <label htmlFor="publish-floor" className="label">
        Primary floor
      </label>
      <div className="mt-1.5 flex items-center gap-2">
        <input
          id="publish-floor"
          type="number"
          step="0.1"
          min="0"
          max="10"
          value={value}
          onChange={(e) => {
            setError(null);
            setDraft(e.target.value);
          }}
          aria-invalid={!valid}
          className={`${FIELD} numeral w-20 text-xl`}
        />
        {dirty && (
          <button
            type="button"
            disabled={action.isPending}
            onClick={save}
            className="press rounded-full bg-accent px-3 py-1.5 text-[11px] font-semibold text-accent-foreground disabled:opacity-40"
          >
            {action.isPending ? "Saving…" : "Save"}
          </button>
        )}
        {dirty && (
          <button type="button" onClick={() => setDraft(null)} className={PILL}>
            Cancel
          </button>
        )}
      </div>
      <p
        className="mt-2 text-[11px] leading-relaxed"
        style={{ color: valid ? "var(--muted)" : "var(--lost-ink)" }}
      >
        {!valid
          ? "Between 0 and 10."
          : dirty
            ? `Picks scoring under ${parsed} will not publish. Currently ${live}.`
            : "Below this, the engine's call is not published."}
      </p>
      {error && <ActionError message={error} />}
    </div>
  );
}

function OverlayVariables({
  config,
  prompt,
}: {
  config: Record<string, unknown> & { id: string; status?: string };
  prompt: string;
}) {
  const action = useOfficeAction();
  const [edits, setEdits] = useState<Record<string, number | string>>({});
  const [saveError, setSaveError] = useState<string | null>(null);

  const { live, referenced } = useMemo(() => {
    const { values } = resolveEngineVariables(config);
    return { live: values, referenced: new Set(placeholdersIn(prompt)) };
  }, [config, prompt]);

  const groups = useMemo(() => {
    const byGroup = new Map<VariableGroup, EngineVariable[]>();
    for (const v of ENGINE_VARIABLES) {
      if (v.unit === "weight") continue;
      const list = byGroup.get(v.group) ?? [];
      list.push(v);
      byGroup.set(v.group, list);
    }
    return GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => ({
      group: g,
      variables: byGroup.get(g)!,
    }));
  }, []);

  const dirty = Object.keys(edits);
  const merged = { ...live, ...edits };
  const warnings = validateEngineVariables(merged).filter((w) => w.key in edits);

  function setValue(v: EngineVariable, raw: string) {
    setSaveError(null);
    const next = { ...edits };

    if (v.unit === "market") {
      if (raw === String(live[v.key])) delete next[v.key];
      else next[v.key] = raw;
    } else {
      const n = Number(raw);
      // An unparseable number is dropped rather than written as NaN: NaN in a
      // threshold renders as "NaN" in the prompt and the run throws.
      if (raw.trim() === "" || !Number.isFinite(n)) delete next[v.key];
      else if (n === live[v.key]) delete next[v.key];
      else next[v.key] = n;
    }

    setEdits(next);
  }

  async function save() {
    setSaveError(null);
    try {
      await action.mutateAsync({
        action: "updateVariables",
        configId: config.id,
        values: edits,
      });
      setEdits({});
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not save.");
    }
  }

  return (
    <Panel
      title="Overlay thresholds"
      description="Every tunable except the ranking weights. Gated ones are inert until a feed supplies their input; they are editable now so they are ready when it does."
      action={
        dirty.length > 0 ? (
          <span className="numeral text-sm" style={{ color: "var(--warning, var(--accent))" }}>
            {dirty.length} changed
          </span>
        ) : undefined
      }
    >
      {saveError && (
        <Alert status="danger" className="mb-4">
          {saveError}
        </Alert>
      )}

      {warnings.map((w) => (
        <Alert status="warning" className="mb-3" key={w.key}>
          <code className="font-mono font-semibold">
            {w.key} = {String(w.value)}
          </code>{" "}
          , {w.message}
        </Alert>
      ))}

      <div className="space-y-3">
        {groups.map(({ group, variables }) => {
          const gatedCount = variables.filter((v) => v.optionalOverlay).length;
          const allGated = gatedCount === variables.length;

          return (
            <details
              key={group}
              className="rounded-2xl border border-field-border bg-field p-4"
            >
              <summary className="flex cursor-pointer items-center justify-between gap-3 text-[13px] font-semibold">
                <span>{GROUP_LABELS[group]}</span>
                <span className="flex items-center gap-2">
                  {allGated && (
                    <span className="rounded-full bg-surface-secondary px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
                      no feed yet
                    </span>
                  )}
                  <span className="numeral text-[12px] text-muted">{variables.length}</span>
                </span>
              </summary>

              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                {variables.map((v) => {
                  const value = v.key in edits ? edits[v.key] : live[v.key];
                  const changed = v.key in edits;
                  return (
                    <label key={v.key} className="space-y-1.5">
                      <span className="flex items-baseline justify-between gap-2">
                        <code className="font-mono text-[12px]">{v.key}</code>
                        <span className="flex items-center gap-1.5">
                          {v.optionalOverlay && !allGated && (
                            <span className="text-[10px] uppercase tracking-wide text-muted">
                              gated
                            </span>
                          )}
                          {!referenced.has(v.key) && (
                            <span className="text-[10px] uppercase tracking-wide text-muted">
                              not in prompt
                            </span>
                          )}
                          <span className="text-[10px] uppercase tracking-wide text-muted">
                            {v.unit}
                          </span>
                        </span>
                      </span>
                      <input
                        type={v.unit === "market" ? "text" : "number"}
                        step="any"
                        value={String(value ?? "")}
                        onChange={(e) => setValue(v, e.target.value)}
                        className={`h-11 w-full rounded-xl border bg-field px-3 font-mono text-sm ${
                          changed ? "border-accent" : "border-field-border"
                        }`}
                      />
                      <span className="block text-[11px] leading-snug text-muted">{v.note}</span>
                    </label>
                  );
                })}
              </div>
            </details>
          );
        })}
      </div>

      <div className="mt-5 flex items-center gap-3">
        <button
          type="button"
          disabled={!dirty.length || action.isPending}
          onClick={save}
          className="press rounded-full bg-accent px-5 py-2.5 text-[13px] font-semibold text-accent-foreground disabled:opacity-40"
        >
          {action.isPending ? "Saving…" : `Save ${dirty.length || ""} change${dirty.length === 1 ? "" : "s"}`}
        </button>
        {dirty.length > 0 && (
          <button
            type="button"
            onClick={() => {
              setEdits({});
              setSaveError(null);
            }}
            className="text-[13px] font-medium text-muted"
          >
            Discard
          </button>
        )}
      </div>
    </Panel>
  );
}

function EnginePanel() {
  const { data: config, isPending } = useEngineConfig();
  const action = useOfficeAction();
  const [prompt, setPrompt] = useState<string | null>(null);
  const [weights, setWeights] = useState<Record<string, number> | null>(null);
  const [otp, setOtp] = useState<{ masked?: string; devCode?: string } | null>(null);
  const [code, setCode] = useState("");
  const [otpError, setOtpError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function requestCode() {
    setOtpError(null); setBusy(true);
    try {
      const res = await fetch("/api/office/otp", { method: "POST" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setOtp({ masked: json.maskedEmail, devCode: json.devCode });
    } catch (e) {
      setOtpError(e instanceof Error ? e.message : "Could not send a code.");
    } finally { setBusy(false); }
  }

  async function applyPrompt(configId: string) {
    setOtpError(null); setBusy(true);
    try {
      const res = await fetch("/api/office/otp", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, configId, systemPrompt: prompt ?? "" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setPrompt(null); setOtp(null); setCode("");
    } catch (e) {
      setOtpError(e instanceof Error ? e.message : "Could not save the prompt.");
    } finally { setBusy(false); }
  }

  if (isPending) return <Panel title="AI engine"><Loading rows={5} /></Panel>;
  if (!config) return <Panel title="AI engine"><Empty>No active engine config.</Empty></Panel>;

  const current: Record<string, number> =
    weights ?? (config.ranking_weights as Record<string, number>);
  const sum = Object.values(current).reduce((a, b) => a + b, 0);
  const sumOk = Math.abs(sum - 1) < 0.001;

  return (
    <div className="space-y-4">
      <ConfigVersions />

      <Panel
        title={`${config.name} · v${config.version}`}
        description={`Last updated ${new Date(config.last_updated_at).toLocaleString()}${config.approved_by ? ` by ${config.approved_by}` : ""}.`}
      >
        {/*
          The publish floor is edited HERE, where it is read.
          
          It was already editable — as one row among a hundred in Overlay
          thresholds, sorted into "staking", indistinguishable from
          refFoulHeavyBoostPct. But it is not one tunable among a hundred: it
          alone decides whether a day has a board at all, and a run where
          nothing clears it is a contractual event under the Terms. Meanwhile
          this card displayed the number in the place anyone would look for it,
          styled exactly like something you could click, and did nothing.
          
          The other two stay read-only. Absolute min is a clamp the floor
          already dominates, and batch size belongs to self-tuning.
        */}
        <div className="grid gap-3 sm:grid-cols-3">
          <PublishFloor config={config} />
          {[
            ["Absolute min", config.confidence_thresholds?.absoluteMinimumFloor],
            ["Batch size", config.self_tuning?.batchSize],
          ].map(([k, v]) => (
            <div key={String(k)} className="rounded-2xl bg-surface-secondary p-4">
              <p className="label">{k}</p>
              <p className="numeral mt-1.5 text-xl">{String(v ?? "-")}</p>
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        title="Ranking weights"
        description="Must sum to exactly 1.0, the server rejects anything else."
        action={
          <span className={`numeral text-sm ${sumOk ? "" : "text-danger"}`} style={sumOk ? { color: "var(--success)" } : undefined}>
            Σ {sum.toFixed(3)}
          </span>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {Object.entries(current).map(([key, value]) => (
            <label key={key} className="space-y-1.5">
              <span className="label">{key.replace(/Weight$/, "")}</span>
              <input
                type="number" step="0.01" min="0" max="1" value={value}
                onChange={(e) => setWeights({ ...current, [key]: Number(e.target.value) })}
                className="h-11 w-full rounded-xl border border-field-border bg-field px-3 font-mono text-sm"
              />
            </label>
          ))}
        </div>

        <button
          type="button"
          disabled={!sumOk || !weights || action.isPending}
          onClick={() => action.mutate({ action: "updateWeights", configId: config.id, rankingWeights: current })}
          className="press mt-5 rounded-full bg-accent px-5 py-2.5 text-[13px] font-semibold text-accent-foreground disabled:opacity-40"
        >
          Save weights
        </button>
      </Panel>

      <Backtest live={Number(config.confidence_thresholds?.primarySlipFloor ?? 7)} />

      <PromptVariables config={config} prompt={prompt ?? config.system_prompt} />

      <OverlayVariables config={config} prompt={prompt ?? config.system_prompt} />

      <FxFallbackPanel />

      <Panel
        title="System prompt"
        description="The instructions the engine runs against every fixture. Values in double braces are substituted from the config above before the prompt is sent. Changing it needs an emailed confirmation code, a bad edit degrades every call silently."
      >
        <textarea
          rows={12}
          value={prompt ?? config.system_prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="w-full rounded-2xl border border-field-border bg-field p-4 font-mono text-[12px] leading-relaxed"
        />

        {otpError && (
          <Alert status="danger" className="mt-3">
            {otpError}
          </Alert>
        )}

        {otp ? (
          <div className="mt-4 rounded-2xl border border-accent-edge bg-accent-wash p-4">
            <p className="text-[13px] text-muted">
              Code sent to {otp.masked}. Expires in 10 minutes.
              {otp.devCode && (
                <> Providers are mocked, so here it is: <code className="font-mono font-semibold text-foreground">{otp.devCode}</code></>
              )}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <input
                inputMode="numeric" maxLength={6} value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="000000" aria-label="Confirmation code"
                className="h-11 w-32 rounded-full border border-field-border bg-field text-center font-mono tracking-[0.3em]"
              />
              <button
                type="button" disabled={code.length !== 6 || busy}
                onClick={() => applyPrompt(config.id)}
                className="press h-11 rounded-full bg-accent px-5 text-[13px] font-semibold text-accent-foreground disabled:opacity-40"
              >
                Confirm &amp; save
              </button>
              <button
                type="button" disabled={busy}
                onClick={() => { setOtp(null); setCode(""); }}
                className="press h-11 rounded-full border border-border px-5 text-[13px] font-semibold"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <button
              type="button" disabled={prompt === null}
              onClick={() => setPrompt(null)}
              className="press rounded-full border border-border px-5 py-2.5 text-[13px] font-semibold disabled:opacity-40"
            >
              Discard
            </button>
            <button
              type="button" disabled={prompt === null || busy}
              onClick={requestCode}
              className="press rounded-full bg-accent px-5 py-2.5 text-[13px] font-semibold text-accent-foreground disabled:opacity-40"
            >
              Save prompt…
            </button>
          </div>
        )}
      </Panel>
    </div>
  );
}

/* ------------------------------- reports ------------------------------- */

/**
 * Date presets.
 *
 * Windows are half-open, start inclusive, end exclusive, so a month never
 * double-counts a fixture sitting on the boundary. Returns undefined for "all
 * time", which the RPC reads as no filter.
 */
function rangeFor(preset: string): { start?: string; end?: string } {
  const now = new Date();
  const startOfDay = (d: Date) =>
    new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).toISOString();

  switch (preset) {
    case "7d": {
      const s = new Date(now);
      s.setUTCDate(s.getUTCDate() - 7);
      return { start: startOfDay(s) };
    }
    case "30d": {
      const s = new Date(now);
      s.setUTCDate(s.getUTCDate() - 30);
      return { start: startOfDay(s) };
    }
    case "thisMonth":
      return {
        start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(),
      };
    case "lastMonth":
      return {
        start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)).toISOString(),
        end: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(),
      };
    default:
      return {};
  }
}

const PRESETS = [
  { v: "all", label: "All time" },
  { v: "7d", label: "Last 7 days" },
  { v: "30d", label: "Last 30 days" },
  { v: "thisMonth", label: "This month" },
  { v: "lastMonth", label: "Last month" },
];

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="rounded-xl bg-surface-secondary px-3 py-4">
      <p className="numeral text-xl" style={tone ? { color: tone } : undefined}>
        {value}
      </p>
      <p className="label mt-1">{label}</p>
    </div>
  );
}

/* ------------------------------ dashboard ------------------------------ */

/**
 * The Office landing tab.
 *
 * Two groups, and the split is the whole design. "As of today" ignores the
 * date filter, because a catalogue size or an all-time total has no meaningful
 * reading for "the last 7 days"; "in the selected range" answers it. A board
 * whose tiles quietly mean different things is worse than a board with fewer
 * tiles, and the headings are what stop someone reading a lifetime total as a
 * weekly one.
 *
 * Every figure comes from one RPC. Ten round trips to render one screen is ten
 * chances for a half-drawn dashboard and ten sets of numbers that can disagree
 * with each other about when they were taken.
 */
function DashboardPanel() {
  const [preset, setPreset] = useState("30d");
  const range = rangeFor(preset);
  const { data, isPending } = useDashboardMetrics(range);

  const money = (n: number) =>
    `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // A rate with no denominator is unknown, not zero. Rendering 0% for a week
  // with nothing settled reports a perfect miss record that never happened.
  const pct = (n: number | null) => (n === null ? "—" : `${n}%`);
  const num = (n: number) => n.toLocaleString();

  const rangeLabel =
    PRESETS.find((p) => p.v === preset)?.label.toLowerCase() ?? "the selected range";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((p) => {
          const on = preset === p.v;
          return (
            <button
              key={p.v}
              type="button"
              onClick={() => setPreset(p.v)}
              aria-current={on ? "page" : undefined}
              className={`press rounded-full border px-4 py-2 text-[13px] font-semibold ${
                on
                  ? "border-transparent bg-feature text-feature-foreground"
                  : "border-border bg-surface text-muted hover:text-foreground"
              }`}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <Panel
        title="As of today"
        description="Current totals. These ignore the date filter above."
      >
        {isPending || !data ? (
          <Loading rows={2} />
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Total users" value={num(data.asOfToday.users)} />
            <Stat
              label="Passes active today"
              value={num(data.asOfToday.activePassesToday)}
              tone="var(--won-ink)"
            />
            <Stat label="Predictions to date" value={num(data.asOfToday.predictions)} />
            <Stat label="Fixtures tracked" value={num(data.asOfToday.fixtures)} />
            <Stat label="Leagues" value={num(data.asOfToday.leagues)} />
            <Stat label="Teams" value={num(data.asOfToday.teams)} />
            <Stat
              label="Suspended"
              value={num(data.asOfToday.suspended)}
              tone={data.asOfToday.suspended > 0 ? "var(--lost-ink)" : undefined}
            />
          </div>
        )}
      </Panel>

      <Panel title="Money" description={`Gross, for ${rangeLabel}.`}>
        {isPending || !data ? (
          <Loading rows={2} />
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Revenue" value={money(data.inRange.revenue)} tone="var(--won-ink)" />
            <Stat label="Day passes" value={money(data.inRange.passRevenue)} />
            <Stat label="Extra picks" value={money(data.inRange.extraRevenue)} />
            {/* Per PAYING user. Dividing by everyone who signed up measures how
                many have not paid, which the signups tile already answers. */}
            <Stat
              label="Avg per paying user"
              value={data.inRange.arpu === null ? "—" : money(data.inRange.arpu)}
            />
            <Stat label="Passes sold" value={num(data.inRange.passesSold)} />
            <Stat label="Paying users" value={num(data.inRange.payingUsers)} />
            <Stat label="Extra-pick orders" value={num(data.inRange.extraOrders)} />
            <Stat label="Extra games unlocked" value={num(data.inRange.extraGames)} />
          </div>
        )}
      </Panel>

      <Panel
        title="Customers"
        description="Churn is someone who bought in the previous window of the same length and not in this one. Return rate is buyers who bought on more than one day."
      >
        {isPending || !data ? (
          <Loading rows={2} />
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="New sign-ups" value={num(data.inRange.newUsers)} />
            <Stat
              label="Return rate"
              value={pct(data.inRange.returnRate)}
              tone="var(--won-ink)"
            />
            <Stat
              label="Churn rate"
              value={pct(data.inRange.churnRate)}
              tone={
                data.inRange.churnRate && data.inRange.churnRate > 0
                  ? "var(--lost-ink)"
                  : undefined
              }
            />
            <Stat label="Repeat buyers" value={num(data.inRange.returningBuyers)} />
          </div>
        )}
        {data && data.inRange.churnRate === null && (
          <p className="mt-3 text-[12px] text-muted">
            Churn needs a previous window to compare against, so it is blank on
            All time and until there are buyers in the period before this one.
          </p>
        )}
      </Panel>

      <Panel
        title="Performance"
        description={`Settled picks and slips in ${rangeLabel}. Pending ones are excluded: an ungraded pick is not a miss.`}
      >
        {isPending || !data ? (
          <Loading rows={2} />
        ) : (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Hit rate" value={pct(data.inRange.hitRate)} tone="var(--won-ink)" />
            <Stat
              label="Miss rate"
              value={data.inRange.hitRate === null ? "—" : `${(100 - data.inRange.hitRate).toFixed(1)}%`}
              tone="var(--lost-ink)"
            />
            <Stat label="Won" value={num(data.inRange.wins)} />
            <Stat label="Lost" value={num(data.inRange.losses)} />
            <Stat label="Slip win rate" value={pct(data.inRange.slipWinRate)} />
            <Stat label="Slips settled" value={num(data.inRange.slipsSettled)} />
            <Stat label="Slips saved" value={num(data.inRange.slipsTotal)} />
            <Stat label="Picks settled" value={num(data.inRange.settled)} />
          </div>
        )}
      </Panel>
    </div>
  );
}

function ReportsPanel() {
  const [view, setView] = useState<"engine" | "users" | "tuning">("engine");
  const [preset, setPreset] = useState("all");

  const SUBVIEWS = [
    { v: "engine", label: "Accuracy" },
    { v: "users", label: "User picks" },
    { v: "tuning", label: "Tuning" },
  ] as const;

  return (
    <div className="space-y-4">
      <nav className="flex gap-1.5" aria-label="Report type">
        {SUBVIEWS.map((s) => {
          const on = view === s.v;
          return (
            <button
              key={s.v}
              type="button"
              onClick={() => setView(s.v)}
              aria-current={on ? "page" : undefined}
              className={`press rounded-full border px-4 py-2 text-[13px] font-semibold ${
                on
                  ? "border-transparent bg-feature text-feature-foreground"
                  : "border-border bg-surface text-muted hover:text-foreground"
              }`}
            >
              {s.label}
            </button>
          );
        })}
      </nav>

      {view === "engine" && <EngineReportView preset={preset} onPreset={setPreset} />}
      {view === "users" && <UserPicksView />}
      {view === "tuning" && <TuningReportsView />}
    </div>
  );
}

function EngineReportView({
  preset,
  onPreset,
}: {
  preset: string;
  onPreset: (v: string) => void;
}) {
  const range = rangeFor(preset);
  const { data, isPending } = usePredictionReport(range);

  return (
    <Panel
      title="Engine performance"
      description="Settled calls only, pending picks are counted but can't be right or wrong yet."
    >
      <div className="mb-5 flex flex-wrap gap-1.5">
        {PRESETS.map((p) => {
          const on = preset === p.v;
          return (
            <button
              key={p.v}
              type="button"
              onClick={() => onPreset(p.v)}
              aria-pressed={on}
              className="press rounded-full border px-3 py-1.5 text-[12px] font-semibold"
              style={
                on
                  ? { borderColor: "transparent", background: "var(--accent-wash)", color: "var(--accent)" }
                  : { borderColor: "var(--border)", color: "var(--muted)" }
              }
            >
              {p.label}
            </button>
          );
        })}
      </div>

      {isPending ? (
        <Loading rows={4} />
      ) : !data || data.total === 0 ? (
        <Empty>No predictions in that window.</Empty>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              label="Win rate"
              value={data.winRate === null ? "-" : `${Math.round(data.winRate * 100)}%`}
              tone="var(--won-ink)"
            />
            <Stat label="Won" value={String(data.wins)} tone="var(--won-ink)" />
            <Stat label="Lost" value={String(data.losses)} tone="var(--lost-ink)" />
            <Stat label="Pending" value={String(data.pending)} />
          </div>

          {data.leagues.length > 0 && (
            <>
              <h3 className="mt-6 text-[13px] font-semibold">By league</h3>
              <ul className="mt-2 divide-y divide-separator">
                {data.leagues.map((l) => (
                  <li key={l.leagueName} className="flex items-center gap-3 py-3">
                    {l.logo && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={l.logo} alt="" width={18} height={18} className="h-[18px] w-[18px] flex-none object-contain" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13px] font-medium">{l.leagueName}</p>
                      <p className="truncate text-[11px] text-muted">{l.country}</p>
                    </div>
                    <span className="numeral flex-none text-[11px] text-muted">
                      {l.wins}W&ndash;{l.losses}L
                    </span>
                    <span className="numeral w-12 flex-none text-right text-[13px] font-semibold">
                      {l.winRate === null ? "-" : `${Math.round(l.winRate * 100)}%`}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </Panel>
  );
}

function UserPicksView() {
  const { data, isPending } = useUserPicksReport();

  return (
    <Panel
      title="User picks"
      description="Who is following what. Sorted by volume, the accounts most worth knowing about when support writes in."
    >
      {isPending ? (
        <Loading rows={4} />
      ) : !data || data.users.length === 0 ? (
        <Empty>Nobody has saved a slip yet.</Empty>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat
              label="Avg win rate"
              value={data.avgWinRate === null ? "-" : `${Math.round(data.avgWinRate * 100)}%`}
              tone="var(--won-ink)"
            />
            <Stat label="Slips" value={String(data.totalSlips)} />
            <Stat label="Won" value={String(data.totalWins)} tone="var(--won-ink)" />
            <Stat label="Lost" value={String(data.totalLosses)} tone="var(--lost-ink)" />
          </div>

          <ul className="mt-6 divide-y divide-separator">
            {data.users.map((u) => (
              <li key={u.id} className="flex items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-medium">
                    {u.displayName ?? u.email ?? "-"}
                  </p>
                  <p className="truncate text-[11px] text-muted">{u.email}</p>
                </div>
                <span className="numeral flex-none text-[11px] text-muted">
                  {u.totalSlips} slips
                </span>
                <span className="numeral flex-none text-[11px] text-muted">
                  {u.wins}W&ndash;{u.losses}L
                </span>
                <span className="numeral w-12 flex-none text-right text-[13px] font-semibold">
                  {u.winRate === null ? "-" : `${Math.round(u.winRate * 100)}%`}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  );
}

function TuningReportsView() {
  const { data: reports, isPending } = useTuningReports();
  const action = useOfficeAction();

  if (isPending) return <Panel title="Tuning reports"><Loading rows={4} /></Panel>;
  if (!reports?.length)
    return <Panel title="Tuning reports"><Empty>No reports yet. They generate after enough picks settle.</Empty></Panel>;

  return (
    <div className="space-y-4">
      {reports.map((r) => {
        const period = r.review_period as { predictionsReviewed: number; overallWinRate: number };
        const changes = [
          ...((r.proposed_weight_changes ?? []) as Array<Record<string, string | number>>),
          ...((r.proposed_threshold_changes ?? []) as Array<Record<string, string | number>>),
        ];

        return (
          <Panel
            key={r.id}
            title={`${period.predictionsReviewed} picks reviewed`}
            description={`Win rate ${formatPercent(period.overallWinRate)} · ${formatDateShort(r.generated_at)}`}
            action={
              <Tag tone={r.status === "approved" ? "won" : r.status === "rejected" ? "lost" : "accent"}>
                {r.status === "approved" ? <Check className="h-3 w-3" /> : r.status === "rejected" ? <X className="h-3 w-3" /> : <Clock className="h-3 w-3" />}
                {r.status}
              </Tag>
            }
          >
            <div className="space-y-3">
              {changes.map((c) => (
                <div key={String(c.parameter)} className="rounded-2xl bg-surface-secondary p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-[13px] font-semibold">{c.parameter}</span>
                    <span className="numeral text-sm">
                      <span className="text-muted">{c.current_value}</span>
                      <span className="mx-2 text-muted">→</span>
                      <span style={{ color: "var(--accent)" }}>{c.proposed_value}</span>
                    </span>
                  </div>
                  <p className="mt-2 text-[12px] leading-relaxed text-muted">{c.rationale}</p>
                </div>
              ))}
            </div>

            {r.status === "pending" && (
              <div className="mt-5 flex flex-wrap justify-end gap-2">
                <button
                  type="button" disabled={action.isPending}
                  onClick={() => action.mutate({ action: "rejectReport", reportId: r.id })}
                  className="press rounded-full border border-border px-5 py-2.5 text-[13px] font-semibold"
                >
                  Reject
                </button>
                <button
                  type="button" disabled={action.isPending}
                  onClick={() => action.mutate({ action: "approveReport", reportId: r.id })}
                  className="press rounded-full bg-accent px-5 py-2.5 text-[13px] font-semibold text-accent-foreground"
                >
                  Approve &amp; apply
                </button>
              </div>
            )}
          </Panel>
        );
      })}

      {action.error && <Alert status="danger">{action.error.message}</Alert>}
    </div>
  );
}

/* -------------------------------- users -------------------------------- */

function UsersPanel() {
  const { data: users, isPending } = useAdminUsers();
  const action = useOfficeAction();
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Filtering in the browser: the whole account list is already loaded, and a
  // round trip per keystroke would be slower and no more correct.
  const q = query.trim().toLowerCase();
  const visible = (users ?? []).filter(
    (u) =>
      !q ||
      (u.email ?? "").toLowerCase().includes(q) ||
      (u.display_name ?? "").toLowerCase().includes(q),
  );

  return (
    <Panel
      title="Users"
      description={`${users?.length ?? 0} accounts. Comped passes carry no payment, so they don't show up as revenue.`}
    >
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search by name or email…"
        aria-label="Search accounts"
        className={`${FIELD} mb-4 w-full`}
      />

      {isPending ? (
        <Loading rows={6} />
      ) : !visible.length ? (
        <Empty>{q ? "Nobody matches that." : "No accounts."}</Empty>
      ) : (
        <ul className="divide-y divide-separator">
          {visible.map((u) => {
            const passes = (u.daily_passes ?? []) as Array<{ status: string }>;
            const active = passes.filter((p) => p.status === "active").length;
            const open = expanded === u.id;

            return (
              <li key={u.id} className="py-3 first:pt-0">
                <div className="flex flex-wrap items-center gap-3">
                  <span
                    className="flex h-9 w-9 flex-none items-center justify-center rounded-full text-[12px] font-bold"
                    style={{ background: "var(--surface-secondary)", color: "var(--muted)" }}
                  >
                    {(u.display_name ?? u.email ?? "?").slice(0, 2).toUpperCase()}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold">{u.display_name ?? "-"}</p>
                    <p className="truncate text-[11px] text-muted">{u.email}</p>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {u.is_super_admin && <Tag tone="accent">admin</Tag>}
                    {u.is_suspended && <Tag tone="lost">suspended</Tag>}
                    {active > 0 && <Tag tone="won">{active} pass</Tag>}
                  </div>

                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : u.id)}
                    aria-expanded={open}
                    className={PILL}
                  >
                    {open ? "Close" : "Manage"}
                  </button>
                </div>

                {open && (
                  <div className="rise mt-3 space-y-3 rounded-2xl bg-surface-secondary p-4">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        disabled={action.isPending}
                        onClick={() =>
                          action.mutate({ action: "grantPass", userId: u.id, days: 1 })
                        }
                        className={PILL}
                      >
                        Comp 1 day
                      </button>
                      <button
                        type="button"
                        disabled={action.isPending}
                        onClick={() =>
                          action.mutate({ action: "grantPass", userId: u.id, days: 7 })
                        }
                        className={PILL}
                      >
                        Comp 7 days
                      </button>
                      <button
                        type="button"
                        disabled={action.isPending || active === 0}
                        onClick={() => action.mutate({ action: "revokePass", userId: u.id })}
                        className={PILL}
                      >
                        Revoke passes
                      </button>
                      <button
                        type="button"
                        disabled={action.isPending}
                        onClick={() =>
                          action.mutate({
                            action: "setUserFlags",
                            userId: u.id,
                            isSuspended: !u.is_suspended,
                          })
                        }
                        className={PILL}
                      >
                        {u.is_suspended ? "Reinstate" : "Suspend"}
                      </button>
                    </div>

                    <EditUserForm
                      displayName={u.display_name ?? ""}
                      phone={u.phone ?? ""}
                      busy={action.isPending}
                      onSubmit={(f) =>
                        action.mutate({ action: "updateUserProfile", userId: u.id, ...f })
                      }
                    />

                    {/* Deletion is last, visually separated, and two-step. It
                        removes the account and everything hanging off it. */}
                    <div className="flex items-center justify-between gap-3 border-t border-separator pt-3">
                      <p className="text-[11px] leading-snug text-muted">
                        Deleting removes the account, its slips, passes and
                        payment records. There is no undo.
                      </p>
                      {confirmDelete === u.id ? (
                        <span className="flex flex-none gap-2">
                          <button
                            type="button"
                            disabled={action.isPending}
                            onClick={() =>
                              action.mutate(
                                { action: "deleteUser", userId: u.id },
                                { onSuccess: () => { setConfirmDelete(null); setExpanded(null); } },
                              )
                            }
                            className="press rounded-full px-3 py-1.5 text-[11px] font-semibold"
                            style={{ background: "var(--lost-wash)", color: "var(--lost-ink)" }}
                          >
                            Really delete
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmDelete(null)}
                            className={PILL}
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDelete(u.id)}
                          className={`${PILL} flex-none`}
                        >
                          Delete account
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {action.error && <ActionError message={action.error.message} />}
    </Panel>
  );
}

function EditUserForm({
  displayName,
  phone,
  busy,
  onSubmit,
}: {
  displayName: string;
  phone: string;
  busy: boolean;
  onSubmit: (f: { displayName: string; phone: string }) => void;
}) {
  const [name, setName] = useState(displayName);
  const [tel, setTel] = useState(phone);
  const dirty = name !== displayName || tel !== phone;

  return (
    <div className="flex flex-wrap gap-2">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Display name"
        aria-label="Display name"
        className={`${FIELD} min-w-40 flex-1`}
      />
      <input
        value={tel}
        onChange={(e) => setTel(e.target.value)}
        placeholder="Phone"
        aria-label="Phone"
        className={`${FIELD} min-w-32 flex-1`}
      />
      <button
        type="button"
        disabled={!dirty || busy}
        onClick={() => onSubmit({ displayName: name, phone: tel })}
        className="press rounded-full bg-accent px-5 text-[13px] font-semibold text-accent-foreground disabled:opacity-40"
      >
        Save
      </button>
    </div>
  );
}


/**
 * What a different publish floor would have done.
 *
 * Every tuning decision used to be made forward, on live customers, with a
 * feedback loop measured in weeks. This is the cheap half of fixing that.
 *
 * The honest limit is stated in the panel rather than buried: this replays the
 * selection and staking rules over picks the engine actually made. It cannot
 * tell you what the model would have SAID under different weights, because
 * that needs a fresh inference per fixture and a stats feed that no longer
 * serves those dates.
 */
function Backtest({ live }: { live: number }) {
  const [floor, setFloor] = useState(live);
  const [days, setDays] = useState(90);

  const current = useBacktest({ floor: live, days, enabled: true });
  const proposed = useBacktest({ floor, days, enabled: true });

  const a = current.data;
  const b = proposed.data;
  const changed = Math.abs(floor - live) > 0.01;

  const pct = (v: number | null | undefined) =>
    v == null ? "-" : `${Math.round(v * 100)}%`;

  return (
    <Panel
      title="What if we published differently?"
      description="Replays the publish floor and staking bands over calls the engine already made, so a threshold change can be judged before it reaches customers."
    >
      <div className="flex flex-wrap items-end gap-4">
        <label className="space-y-1.5">
          <span className="label">Publish floor</span>
          <input
            type="number" step="0.1" min="0" max="10" value={floor}
            onChange={(e) => setFloor(Number(e.target.value))}
            className="h-11 w-28 rounded-xl border border-field-border bg-field px-3 font-mono text-sm"
          />
        </label>
        <label className="space-y-1.5">
          <span className="label">Window (days)</span>
          <input
            type="number" step="30" min="30" max="400" value={days}
            onChange={(e) => setDays(Number(e.target.value))}
            className="h-11 w-28 rounded-xl border border-field-border bg-field px-3 font-mono text-sm"
          />
        </label>
        <p className="text-[12px] text-muted">
          Live floor is <span className="numeral font-semibold">{live}</span>.
        </p>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        {[
          { label: `Live (${live})`, r: a },
          { label: changed ? `Proposed (${floor})` : "Proposed (same)", r: b },
        ].map((col) => (
          <div key={col.label} className="rounded-2xl bg-surface-secondary p-4">
            <p className="label mb-3">{col.label}</p>
            {!col.r ? (
              <div className="shimmer h-24 rounded-xl bg-surface" />
            ) : (
              <dl className="space-y-1.5 text-[13px]">
                <div className="flex justify-between">
                  <dt className="text-muted">Published</dt>
                  <dd className="numeral">
                    {col.r.published} of {col.r.candidates}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">Win rate</dt>
                  <dd className="numeral font-semibold">{pct(col.r.winRate)}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">95% interval</dt>
                  <dd className="numeral text-[12px] text-muted">
                    {pct(col.r.winRateInterval?.low)} to {pct(col.r.winRateInterval?.high)}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-muted">Return</dt>
                  <dd
                    className="numeral font-semibold"
                    style={{
                      color:
                        col.r.roi == null
                          ? undefined
                          : col.r.roi >= 0
                            ? "var(--success)"
                            : "var(--danger)",
                    }}
                  >
                    {col.r.roi == null ? "-" : `${col.r.roi > 0 ? "+" : ""}${Math.round(col.r.roi * 100)}%`}
                  </dd>
                </div>
              </dl>
            )}
          </div>
        ))}
      </div>

      {changed && b && b.discarded.count > 0 && (
        <Alert status="warning" className="mt-4">
          That floor discards{" "}
          <span className="numeral font-semibold">{b.discarded.count}</span>{" "}
          calls that themselves won{" "}
          <span className="numeral font-semibold">{pct(b.discarded.winRate)}</span>
          . A floor that improves the headline by throwing away profitable picks
          is not an improvement.
        </Alert>
      )}

      <p className="mt-4 text-[11px] leading-relaxed text-muted">
        This replays selection and staking over the picks the engine actually
        made. It cannot tell you what the model would have said under different
        weights: that needs a fresh inference per fixture against a stats feed
        that no longer serves those dates. Treat it as a threshold tool, not a
        model backtest.
      </p>
    </Panel>
  );
}
