"use client";

import { Receipt, Check, X, Clock } from "@/components/ui/icons";
import { useSlips } from "@/lib/queries";
import { LinkButton } from "@/components/ui/link-button";

type Leg = {
  id: string;
  prediction_id: string;
  odds: number;
  status: "pending" | "won" | "lost" | "void";
};

type Slip = {
  id: string;
  slip_type: "single" | "accumulator";
  status: "open" | "confirmed" | "won" | "lost" | "partial" | "void";
  combined_odds: number;
  leg_count: number;
  confirmed_at: string;
  slip_legs: Leg[];
};

/** Same outcome vocabulary as the prediction card — colour means one thing. */
const SLIP_STATE = {
  won: { cls: "state-won", ink: "var(--won-ink)", Icon: Check, label: "Won" },
  lost: { cls: "state-lost", ink: "var(--lost-ink)", Icon: X, label: "Lost" },
  partial: { cls: "state-pending", ink: "var(--warning)", Icon: Clock, label: "Partial" },
  void: { cls: "state-pending", ink: "var(--pending-ink)", Icon: Clock, label: "Void" },
  confirmed: { cls: "state-pending", ink: "var(--pending-ink)", Icon: Clock, label: "Open" },
  open: { cls: "state-pending", ink: "var(--pending-ink)", Icon: Clock, label: "Open" },
} as const;

export function SlipsClient() {
  const { data, isPending } = useSlips();
  const slips = (data ?? []) as unknown as Slip[];

  const settled = slips.filter((s) => s.status === "won" || s.status === "lost");
  const won = settled.filter((s) => s.status === "won").length;

  return (
    <main className="mx-auto w-full max-w-3xl px-5 py-8">
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <span className="label">Your record</span>
          <h1 className="display mt-1.5 text-[2rem] sm:text-4xl">My slips</h1>
        </div>

        {settled.length > 0 && (
          <dl className="flex items-center divide-x divide-border">
            <div className="pr-5">
              <dd className="numeral text-xl" style={{ color: "var(--success)" }}>
                {won}
              </dd>
              <dt className="label mt-0.5">Won</dt>
            </div>
            <div className="px-5">
              <dd className="numeral text-xl">{settled.length}</dd>
              <dt className="label mt-0.5">Settled</dt>
            </div>
          </dl>
        )}
      </header>

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
        <div className="stagger space-y-4">
          {slips.map((slip) => {
            const st = SLIP_STATE[slip.status];
            const legs = slip.slip_legs ?? [];
            const wonLegs = legs.filter((l) => l.status === "won").length;

            return (
              <article
                key={slip.id}
                className={`lift overflow-hidden rounded-[1.75rem] border ${st.cls}`}
              >
                <div className="flex items-start justify-between gap-4 px-6 pt-6">
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
                    <p className="mt-2 text-[15px] font-semibold capitalize">
                      {slip.slip_type}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted">
                      {slip.leg_count} legs ·{" "}
                      {new Date(slip.confirmed_at).toLocaleDateString(undefined, {
                        day: "numeric",
                        month: "short",
                      })}
                    </p>
                  </div>

                  <div className="text-right">
                    <p className="numeral text-3xl">
                      {Number(slip.combined_odds).toFixed(2)}
                    </p>
                    <p className="label mt-1">Combined</p>
                  </div>
                </div>

                {/* Legs as a progress strip — you read the shape before the rows. */}
                <div className="mt-5 flex gap-1 px-6">
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
                    <div
                      key={l.id}
                      className="flex items-center justify-between gap-3 px-6 py-3"
                    >
                      <span className="truncate font-mono text-[11px] text-muted">
                        {l.prediction_id.slice(0, 8)}
                      </span>
                      <div className="flex items-center gap-3">
                        <span className="numeral text-sm">
                          {Number(l.odds).toFixed(2)}
                        </span>
                        <span
                          className="w-14 text-right text-[11px] font-semibold capitalize"
                          style={{
                            color:
                              l.status === "won"
                                ? "var(--success)"
                                : l.status === "lost"
                                  ? "var(--danger)"
                                  : "var(--muted)",
                          }}
                        >
                          {l.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {legs.length > 0 && (
                  <p className="px-6 py-3 text-[11px] text-muted">
                    {wonLegs} of {legs.length} legs landed
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </main>
  );
}
