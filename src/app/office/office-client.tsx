"use client";

import { useState } from "react";
import {
  Zap,
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
  ShieldOff,
} from "lucide-react";
import {
  useAdminPredictions,
  useAdminUsers,
  useCatalog,
  useEngineConfig,
  useJobQueue,
  useOfficeAction,
  usePredictionRuns,
  useTuningReports,
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

/**
 * The Office.
 *
 * An admin panel, but part of the same product — so it uses the MoonOdds
 * language rather than dashboard conventions: light ground, generous spacing,
 * rounded surfaces, and the SAME outcome vocabulary as the prediction card, so
 * green/red/amber mean exactly what they mean everywhere else.
 *
 * Density is earned, not assumed: the operator wants to know what ran, what's
 * queued, and what needs a decision — those come first on every tab.
 */

const TABS = [
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
  anonymousBypass = false,
}: {
  adminName: string;
  anonymousBypass?: boolean;
}) {
  const [tab, setTab] = useState<TabKey>("pipeline");

  return (
    <main className="mx-auto w-full max-w-5xl px-5 py-8">
      <header className="mb-6">
        <span className="label">Signed in as {adminName}</span>
        <h1 className="display mt-1.5 text-[2rem] sm:text-4xl">Office</h1>
        <p className="mt-2 max-w-lg text-sm leading-relaxed text-muted">
          Run the pipeline, review what the engine proposes, and manage access.
        </p>
      </header>

      {anonymousBypass && (
        <Alert
          status="warning"
          title="Reachable, but reading nothing"
          icon={<ShieldOff className="h-4 w-4" />}
          className="mb-6"
        >
          The bypass gets you to this page but doesn&rsquo;t fake an identity —
          admin tables are protected by row-level security, not the route guard.
          With no session every panel reads back empty. Actions still run. Sign
          in as <code className="font-mono text-[0.9em]">admin@moonodds.test</code>{" "}
          via the flask button and the data appears.
        </Alert>
      )}

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

const STAGES = [
  { action: "fetchFixtures", label: "Fetch fixtures", hint: "Pull today's matches from the feed" },
  { action: "fetchStats", label: "Fetch stats", hint: "Form, H2H and season numbers the engine reads" },
  { action: "generatePicks", label: "Generate picks", hint: "Run the engine over today's board" },
  { action: "gradeResults", label: "Grade results", hint: "Settle anything that has finished" },
  { action: "clvCheck", label: "CLV check", hint: "Flag lines that moved against us" },
  { action: "recalibrate", label: "Recalibrate", hint: "Propose weight changes from results" },
];

function PipelinePanel() {
  const action = useOfficeAction();
  const runs = usePredictionRuns();
  const jobs = useJobQueue();
  const [last, setLast] = useState<{ stage: string; result: unknown } | null>(null);

  async function run(stage: string) {
    setLast(null);
    const result = await action.mutateAsync({ action: stage });
    setLast({ stage, result });
  }

  return (
    <div className="space-y-4">
      <Panel
        title="Run a stage"
        description="These are the same functions pg_cron calls on schedule. Running one here does exactly what the scheduled job does."
      >
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {STAGES.map((s) => (
            <button
              key={s.action}
              type="button"
              disabled={action.isPending}
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

        {last && (
          <div className="mt-4 rounded-2xl border border-won-edge bg-won-wash p-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: "var(--won-ink)" }}>
              {last.stage} finished
            </p>
            <pre className="mt-2 overflow-x-auto font-mono text-[11px] leading-relaxed text-muted">
              {JSON.stringify(last.result, null, 2)}
            </pre>
          </div>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Recent runs" description="Each engine pass and what it produced.">
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
                  <span className="numeral flex-none text-lg">{r.num_picks}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel
          title="Job queue"
          description="Replaces Convex's scheduler — with retries and a dead-letter state it never had."
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

  const rows = (data?.rows ?? []) as Pick[];
  const pages = Math.ceil((data?.total ?? 0) / (data?.pageSize ?? 25));

  return (
    <Panel title="All predictions" description={`${data?.total ?? 0} on record.`}>
      {isPending ? (
        <Loading rows={6} />
      ) : !rows.length ? (
        <Empty>Nothing to show.</Empty>
      ) : (
        <>
          <ul className="divide-y divide-separator">
            {rows.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0">
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
              </li>
            ))}
          </ul>

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
                  {teamShort(p.homeTeam)} v {teamShort(p.awayTeam)} — {p.league.name}
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
        description="Markets the grader can't settle on its own — corners need a data feed we don't call."
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
      <CoveragePanel />
      <div className="grid gap-4 lg:grid-cols-2">
        <LeaguesPanel />
        <TeamsPanel />
      </div>
      <ImportPanel />
    </div>
  );
}

/**
 * Which leagues the daily fetch covers.
 *
 * This is the single most consequential setting in the Office: it decides what
 * the engine ever sees. It reads and writes API-Football's league ids, so only
 * leagues that carry an external id can be selected — a hand-created league has
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
              Nothing selected — the fetch falls back to its six built-in leagues.
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
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-semibold">{l.name}</p>
                  <p className="truncate text-[11px] text-muted">
                    {l.country} · season {l.season ?? "—"} · id {l.external_id ?? "—"}
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
};
type TeamHit = { externalId: number; name: string; shortName: string | null };

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
      description="Search the upstream catalogue for competitions and clubs you don't track yet. Importing a league only adds the league — pull its squad list separately."
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
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-semibold">{l.name}</p>
              <p className="truncate text-[11px] text-muted">
                {l.country} · season {l.currentSeason ?? "—"} · id {l.externalId}
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
                Import
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
                <span className="min-w-0 flex-1 truncate text-[13px]">{t.name}</span>
                <span className="numeral flex-none text-[11px] text-muted">
                  {t.shortName ?? "—"}
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
      <Panel
        title={`${config.name} · v${config.version}`}
        description={`Last updated ${new Date(config.last_updated_at).toLocaleString()}${config.approved_by ? ` by ${config.approved_by}` : ""}.`}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            ["Primary floor", config.confidence_thresholds?.primarySlipFloor],
            ["Absolute min", config.confidence_thresholds?.absoluteMinimumFloor],
            ["Batch size", config.self_tuning?.batchSize],
          ].map(([k, v]) => (
            <div key={String(k)} className="rounded-2xl bg-surface-secondary p-4">
              <p className="label">{k}</p>
              <p className="numeral mt-1.5 text-xl">{String(v ?? "—")}</p>
            </div>
          ))}
        </div>
      </Panel>

      <Panel
        title="Ranking weights"
        description="Must sum to exactly 1.0 — the server rejects anything else."
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

      <Panel
        title="System prompt"
        description="The instructions the engine runs against every fixture. Changing it needs an emailed confirmation code — a bad edit degrades every call silently."
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

function ReportsPanel() {
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

  return (
    <Panel title="Users" description={`${users?.length ?? 0} accounts.`}>
      {isPending ? (
        <Loading rows={6} />
      ) : !users?.length ? (
        <Empty>No accounts.</Empty>
      ) : (
        <ul className="divide-y divide-separator">
          {users.map((u) => {
            const passes = (u.daily_passes ?? []) as Array<{ status: string }>;
            const active = passes.filter((p) => p.status === "active").length;

            return (
              <li key={u.id} className="flex flex-wrap items-center gap-3 py-3 first:pt-0">
                <span
                  className="flex h-9 w-9 flex-none items-center justify-center rounded-full text-[12px] font-bold"
                  style={{ background: "var(--surface-secondary)", color: "var(--muted)" }}
                >
                  {(u.display_name ?? u.email ?? "?").slice(0, 2).toUpperCase()}
                </span>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-[13px] font-semibold">{u.display_name ?? "—"}</p>
                  <p className="truncate text-[11px] text-muted">{u.email}</p>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {u.is_super_admin && <Tag tone="accent">admin</Tag>}
                  {u.is_suspended && <Tag tone="lost">suspended</Tag>}
                  {active > 0 && <Tag tone="won">{active} pass</Tag>}
                </div>

                <button
                  type="button"
                  disabled={action.isPending}
                  onClick={() => action.mutate({ action: "setUserFlags", userId: u.id, isSuspended: !u.is_suspended })}
                  className="press flex-none rounded-full border border-border px-4 py-2 text-[12px] font-semibold disabled:opacity-40"
                >
                  {u.is_suspended ? "Reinstate" : "Suspend"}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {action.error && <ActionError message={action.error.message} />}
    </Panel>
  );
}
