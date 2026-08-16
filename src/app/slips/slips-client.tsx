"use client";

import { useState } from "react";
import Link from "next/link";
import { Receipt, Check, X, Clock, Trash2, ChevronRight } from "@/components/ui/icons";
import { TeamCrest } from "@/components/predictions/team-crest";
import {
  useSlips,
  useSlipStats,
  useDeleteSlip,
  useRemoveSlipLeg,
  type SavedSlipLeg,
  type SlipRecord,
} from "@/lib/queries";
import { LinkButton } from "@/components/ui/link-button";
import { formatMarketShort, formatPercent, formatSigned, teamShort } from "@/lib/format";
import type { Market } from "@/lib/types";

/** Same outcome vocabulary as the prediction card, colour means one thing. */
const SLIP_STATE = {
  won: { cls: "state-won", ink: "var(--won-ink)", Icon: Check, label: "Won" },
  lost: { cls: "state-lost", ink: "var(--lost-ink)", Icon: X, label: "Lost" },
  partial: { cls: "state-pending", ink: "var(--warning)", Icon: Clock, label: "Partial" },
  void: { cls: "state-pending", ink: "var(--pending-ink)", Icon: Clock, label: "Void" },
  confirmed: { cls: "state-pending", ink: "var(--pending-ink)", Icon: Clock, label: "Open" },
  open: { cls: "state-pending", ink: "var(--pending-ink)", Icon: Clock, label: "Open" },
} as const;

const LEG_INK: Record<SavedSlipLeg["status"], string> = {
  won: "var(--success)",
  lost: "var(--danger)",
  void: "var(--muted)",
  pending: "var(--muted)",
};

function kickoffLabel(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

/**
 * One leg, as the match it is about.
 *
 * This row used to read "View prediction" and nothing else, which told you
 * neither which game you had backed nor when it kicked off, on a page whose
 * entire job is to show you what you followed. The whole row is the link now:
 * a four-word target inside a wide row was a small hit area for the one action
 * the row supports.
 */
function LegRow({
  leg,
  editable,
  onRemove,
  removing,
}: {
  leg: SavedSlipLeg;
  editable: boolean;
  onRemove: (id: string) => void;
  removing: boolean;
}) {
  const settled = leg.status === "won" || leg.status === "lost";

  return (
    <div className="group relative flex items-center gap-3 px-4 py-3.5 transition-colors hover:bg-surface-secondary sm:px-6">
      <Link
        href={`/predictions/${leg.predictionId}`}
        className="flex min-w-0 flex-1 items-center gap-3 outline-none"
        // Stretched link: the anchor covers the row so the whole thing is
        // clickable, while the remove button sits above it on the z-axis.
      >
        <span className="absolute inset-0 z-0" aria-hidden />
        <span className="flex flex-none items-center -space-x-1.5">
          <TeamCrest name={teamShort(leg.homeTeam)} logo={leg.homeTeam?.logo} size={24} />
          <TeamCrest name={teamShort(leg.awayTeam)} logo={leg.awayTeam?.logo} size={24} />
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-semibold leading-tight">
            {teamShort(leg.homeTeam)} v {teamShort(leg.awayTeam)}
          </span>
          <span className="mt-1 block truncate text-[11px] leading-tight text-muted">
            {kickoffLabel(leg.kickoff)} ·{" "}
            {formatMarketShort(leg.market as Market, leg.predictedValue)}
            {settled && leg.homeGoals != null && leg.awayGoals != null && (
              <>
                {" · "}
                <span className="numeral">
                  {leg.homeGoals}&ndash;{leg.awayGoals}
                </span>
              </>
            )}
          </span>
        </span>
      </Link>

      <div className="relative z-10 flex flex-none items-center gap-3">
        <span className="numeral text-sm">{Number(leg.odds).toFixed(2)}</span>
        <span
          className="w-14 text-right text-[11px] font-semibold capitalize"
          style={{ color: LEG_INK[leg.status] }}
        >
          {leg.status}
        </span>

        {/* Legs can only be dropped while nothing has settled: editing a slip
            after a result would rewrite your own history. The server enforces
            it; this just hides a control that would always fail. */}
        {editable ? (
          <button
            type="button"
            disabled={removing}
            onClick={() => onRemove(leg.id)}
            aria-label={`Remove ${teamShort(leg.homeTeam)} v ${teamShort(leg.awayTeam)}`}
            className="press flex h-6 w-6 flex-none items-center justify-center rounded-full text-muted hover:bg-surface-tertiary hover:text-foreground disabled:opacity-40"
          >
            <X className="h-3 w-3" />
          </button>
        ) : (
          <ChevronRight className="h-4 w-4 flex-none text-muted opacity-0 transition-opacity group-hover:opacity-100" />
        )}
      </div>
    </div>
  );
}

function SlipCard({
  slip,
  confirmingDelete,
  setConfirmingDelete,
  onDelete,
  onRemoveLeg,
  deleting,
  removing,
}: {
  slip: SlipRecord;
  confirmingDelete: string | null;
  setConfirmingDelete: (id: string | null) => void;
  onDelete: (id: string) => void;
  onRemoveLeg: (id: string) => void;
  deleting: boolean;
  removing: boolean;
}) {
  const st = SLIP_STATE[slip.status];
  const legs = slip.legs ?? [];
  const wonLegs = legs.filter((l) => l.status === "won").length;
  const editable =
    (slip.status === "open" || slip.status === "confirmed") &&
    legs.every((l) => l.status === "pending");

  const stamp = slip.settledAt ?? slip.confirmedAt;

  return (
    <article className={`lift overflow-hidden rounded-[1.75rem] border ${st.cls}`}>
      <div className="flex items-start justify-between gap-4 px-4 pt-6 sm:px-6">
        <div>
          <span
            className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]"
            style={{
              color: st.ink,
              background: "color-mix(in oklab, currentColor 10%, transparent)",
            }}
          >
            <st.Icon className="h-3 w-3" strokeWidth={3} />
            {st.label}
          </span>
          <p className="mt-2 text-[15px] font-semibold capitalize">{slip.slipType}</p>
          <p className="mt-0.5 text-[11px] text-muted">
            {slip.legCount} {slip.legCount === 1 ? "leg" : "legs"} ·{" "}
            {new Date(stamp).toLocaleDateString(undefined, {
              day: "numeric",
              month: "short",
            })}
          </p>
        </div>

        <div className="text-right">
          <p className="numeral text-3xl">{Number(slip.combinedOdds).toFixed(2)}</p>
          <p className="label mt-1">Combined</p>
        </div>
      </div>

      {/* Legs as a progress strip: you read the shape before the rows. */}
      <div className="mt-5 flex gap-1 px-4 sm:px-6">
        {legs.map((l) => (
          <span
            key={l.id}
            className="h-1.5 flex-1 rounded-full"
            style={{
              background:
                l.status === "won"
                  ? "var(--success)"
                  : l.status === "lost"
                    ? "var(--danger)"
                    : "var(--surface-tertiary)",
            }}
          />
        ))}
      </div>

      <div className="mt-4 divide-y divide-separator border-t border-separator">
        {legs.map((l) => (
          <LegRow
            key={l.id}
            leg={l}
            editable={editable}
            onRemove={onRemoveLeg}
            removing={removing}
          />
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-6">
        {legs.length > 0 ? (
          <p className="text-[11px] text-muted">
            {wonLegs} of {legs.length} legs landed
          </p>
        ) : (
          <span />
        )}

        {confirmingDelete === slip.id ? (
          <span className="flex items-center gap-2">
            <button
              type="button"
              disabled={deleting}
              onClick={() => onDelete(slip.id)}
              className="press rounded-full px-3 py-1.5 text-[11px] font-semibold disabled:opacity-40"
              style={{ background: "var(--lost-wash)", color: "var(--lost-ink)" }}
            >
              Really delete
            </button>
            <button
              type="button"
              onClick={() => setConfirmingDelete(null)}
              className="press rounded-full px-3 py-1.5 text-[11px] font-semibold text-muted"
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmingDelete(slip.id)}
            className="press inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[11px] font-semibold text-muted hover:text-foreground"
          >
            <Trash2 className="h-3 w-3" />
            Delete slip
          </button>
        )}
      </div>
    </article>
  );
}

/**
 * Settled-slip performance.
 *
 * Settled only, and it says so. Counting open slips would move the win rate
 * every time someone built one, which would make the number describe activity
 * rather than results.
 */
function SlipStatsBar() {
  const { data: stats } = useSlipStats();
  if (!stats || stats.settled === 0) return null;

  const tiles: { label: string; value: string; ink?: string }[] = [
    {
      label: "Win rate",
      value: stats.winRate == null ? "-" : formatPercent(stats.winRate),
      ink: stats.winRate != null && stats.winRate >= 0.5 ? "var(--success)" : undefined,
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
    { label: "Settled", value: String(stats.settled) },
    { label: "Best win", value: stats.bestWin == null ? "-" : stats.bestWin.toFixed(2) },
  ];

  return (
    <section
      aria-label="Settled slip performance"
      className="mb-6 rounded-[1.5rem] border border-border bg-surface p-5"
    >
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-[13px] font-semibold">Your record</h2>
        <p className="text-[11px] text-muted">
          {stats.won}W · {stats.lost}L
          {stats.void > 0 && ` · ${stats.void} void`}
          {stats.open > 0 && ` · ${stats.open} open`}
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-2xl bg-surface-secondary p-4">
            <dd className="numeral text-xl" style={t.ink ? { color: t.ink } : undefined}>
              {t.value}
            </dd>
            <dt className="label mt-1">{t.label}</dt>
          </div>
        ))}
      </dl>

      <p className="mt-3 text-[11px] leading-relaxed text-muted">
        Return assumes one flat unit staked per settled slip. We never see what
        you actually staked, so a variable stake would look precise and mean
        less.
      </p>
    </section>
  );
}

export function SlipsClient() {
  const { data, isPending } = useSlips();
  const deleteSlip = useDeleteSlip();
  const removeLeg = useRemoveSlipLeg();
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [tab, setTab] = useState<"open" | "settled" | null>(null);

  const slips = data ?? [];
  const open = slips.filter((s) => s.status === "open" || s.status === "confirmed");
  const settled = slips.filter(
    (s) => s.status === "won" || s.status === "lost" || s.status === "void" || s.status === "partial",
  );

  // Open first when there is anything open, because that is the tab you can
  // still act on. Someone whose slips have all finished should land on their
  // results rather than on an empty panel telling them so.
  const active = tab ?? (open.length > 0 ? "open" : "settled");
  const shown = active === "open" ? open : settled;

  const TABS = [
    { id: "open" as const, label: "Open", count: open.length },
    { id: "settled" as const, label: "Settled", count: settled.length },
  ];

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-8">
      <header className="mb-6">
        <span className="label">Your record</span>
        <h1 className="display mt-1.5 text-[2rem] sm:text-4xl">My slips</h1>
      </header>

      <SlipStatsBar />

      {isPending ? (
        <div className="space-y-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="shimmer h-44 rounded-[1.75rem] bg-surface" />
          ))}
        </div>
      ) : !slips.length ? (
        <div className="rounded-[1.75rem] border border-border bg-surface p-14 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-surface-secondary">
            <Receipt className="h-5 w-5 text-muted" strokeWidth={1.75} />
          </span>
          <p className="mt-4 font-semibold">No slips yet</p>
          <p className="mx-auto mt-1.5 max-w-xs text-sm leading-relaxed text-muted">
            Build a slip from today&rsquo;s board and it&rsquo;ll appear here
            with each leg&rsquo;s outcome tracked.
          </p>
          <LinkButton href="/" variant="secondary" size="md" className="mt-5">
            Browse predictions
          </LinkButton>
        </div>
      ) : (
        <>
          <div
            role="tablist"
            aria-label="Slip status"
            className="mb-5 flex gap-1 rounded-full border border-border bg-surface p-1"
          >
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                type="button"
                aria-selected={active === t.id}
                onClick={() => setTab(t.id)}
                className={`press flex-1 rounded-full px-4 py-2 text-[13px] font-semibold transition-colors ${
                  active === t.id
                    ? "bg-surface-secondary text-foreground"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {t.label}
                <span className="numeral ml-1.5 text-[11px] text-muted">{t.count}</span>
              </button>
            ))}
          </div>

          {shown.length === 0 ? (
            <div className="rounded-[1.75rem] border border-border bg-surface p-12 text-center">
              <p className="font-semibold">
                {active === "open" ? "Nothing open" : "Nothing settled yet"}
              </p>
              <p className="mx-auto mt-1.5 max-w-xs text-sm leading-relaxed text-muted">
                {active === "open"
                  ? "Every slip you've built has finished. Its outcome is under Settled."
                  : "Your open slips will move here once their matches finish."}
              </p>
              {active === "open" && (
                <LinkButton href="/" variant="secondary" size="md" className="mt-5">
                  Build another
                </LinkButton>
              )}
            </div>
          ) : (
            <div className="stagger space-y-4">
              {shown.map((slip) => (
                <SlipCard
                  key={slip.id}
                  slip={slip}
                  confirmingDelete={confirmingDelete}
                  setConfirmingDelete={setConfirmingDelete}
                  onDelete={(id) => deleteSlip.mutate(id)}
                  onRemoveLeg={(id) => removeLeg.mutate(id)}
                  deleting={deleteSlip.isPending}
                  removing={removeLeg.isPending}
                />
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}
