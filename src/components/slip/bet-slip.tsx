"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Receipt, X, Trash2, Check, Info } from "@/components/ui/icons";
import { useBetSlip } from "@/lib/bet-slip";
import { Alert } from "@/components/ui/alert";
import { useConfirmSlip, useLivePredictionIds } from "@/lib/queries";
import { formatMarket, teamShort } from "@/lib/format";

/**
 * Floating slip button + sheet.
 *
 * The FAB only appears once there's something in the slip, an empty affordance
 * following you around the page is noise. It sits above the mobile bottom nav.
 *
 * The counter re-keys on every change so it replays the bump animation. That
 * is the entire feedback for an add: enough to confirm the click landed,
 * without the sheet takeover that used to hide this button the moment it
 * became relevant.
 */
export function BetSlipFab() {
  const { entries, setOpen, isOpen } = useBetSlip();
  const pathname = usePathname();

  // The Office is an internal tool; a punter's slip has no business floating
  // over it.
  if (pathname.startsWith("/office")) return null;
  if (!entries.length || isOpen) return null;

  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label={`Open slip, ${entries.length} ${entries.length === 1 ? "selection" : "selections"}`}
      className="press rise fixed bottom-24 right-5 z-40 flex items-center gap-2.5 rounded-full bg-feature px-5 py-3.5 text-feature-foreground md:bottom-6"
      style={{ boxShadow: "var(--shadow-lift)" }}
    >
      <Receipt className="h-4 w-4" />
      <span className="text-sm font-semibold">Slip</span>
      <span
        key={entries.length}
        className="numeral bump flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs"
        style={{ background: "var(--accent)", color: "var(--accent-foreground)" }}
      >
        {entries.length}
      </span>
    </button>
  );
}

/**
 * Gate and body are separate components on purpose.
 *
 * The body used to live here behind an `if (!isOpen) return null`, which meant
 * it stayed mounted across opens and needed an effect to clear the "saved"
 * confirmation each time the sheet closed, a setState during an effect, and a
 * cascading render to undo the previous one.
 *
 * Splitting it means the body mounts fresh on every open, so that state starts
 * false because it is new rather than because something reset it. The
 * escape-key and scroll-lock effects come along for the ride and no longer need
 * to test `isOpen` themselves.
 */
export function BetSlipSheet() {
  const { isOpen } = useBetSlip();
  if (!isOpen) return null;
  return <SlipSheetBody />;
}

function SlipSheetBody() {
  const { entries, remove, clear, combinedOdds, setOpen } = useBetSlip();
  const confirm = useConfirmSlip();
  const router = useRouter();
  const [done, setDone] = useState(false);

  /**
   * Legs whose prediction no longer exists.
   *
   * Checked when the sheet opens rather than on save, so a stale slip announces
   * itself before someone commits to the button and gets an error naming none
   * of the offenders. While the check is in flight nothing is marked, assuming
   * everything is dead until proven otherwise would flash the whole slip red.
   */
  const { data: liveIds } = useLivePredictionIds(entries.map((e) => e.pick.id));
  const staleIds = new Set(
    liveIds ? entries.map((e) => e.pick.id).filter((id) => !liveIds.has(id)) : [],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [setOpen]);

  async function save() {
    await confirm.mutateAsync({
      slipType: entries.length === 1 ? "single" : "accumulator",
      legs: entries.map((e) => ({ predictionId: e.pick.id, odds: e.odds })),
    });
    clear();
    setDone(true);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button"
        aria-label="Close slip"
        onClick={() => setOpen(false)}
        className="absolute inset-0"
        style={{ background: "var(--backdrop)" }}
      />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Bet slip"
        className="rise relative flex max-h-[88vh] w-full flex-col overflow-hidden rounded-t-[2rem] bg-surface sm:max-w-md sm:rounded-[2rem]"
        style={{ boxShadow: "var(--shadow-lift)" }}
      >
        {done ? (
          <div className="flex flex-col items-center gap-4 p-10 text-center">
            <span
              className="flex h-12 w-12 items-center justify-center rounded-full"
              style={{ background: "var(--won-wash)" }}
            >
              <Check className="h-5 w-5" style={{ color: "var(--won-ink)" }} strokeWidth={3} />
            </span>
            <div>
              <h2 className="display text-xl">Slip saved</h2>
              <p className="mt-1.5 text-sm text-muted">
                We&rsquo;ll track each leg and mark it as results land.
              </p>
            </div>
            <div className="flex w-full flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  router.push("/slips");
                  router.refresh();
                }}
                className="press h-12 rounded-full bg-accent text-sm font-semibold text-accent-foreground"
              >
                View my slips
              </button>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="press h-12 rounded-full border border-border text-sm font-semibold"
              >
                Keep browsing
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-3 border-b border-separator px-6 py-5">
              <div>
                <span className="label">Your slip</span>
                <p className="mt-1 text-[15px] font-semibold">
                  {entries.length} {entries.length === 1 ? "selection" : "selections"}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {entries.length > 0 && (
                  <button
                    type="button"
                    onClick={clear}
                    aria-label="Clear slip"
                    className="press flex h-8 w-8 items-center justify-center rounded-full bg-surface-secondary text-muted hover:text-foreground"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close slip"
                  className="press flex h-8 w-8 items-center justify-center rounded-full bg-surface-secondary text-muted hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {!entries.length ? (
                <div className="p-12 text-center">
                  <Receipt className="mx-auto h-8 w-8 text-muted" strokeWidth={1.5} />
                  <p className="mt-3 font-semibold">Nothing here yet</p>
                  <p className="mx-auto mt-1.5 max-w-[16rem] text-sm leading-relaxed text-muted">
                    Add predictions from the board and they&rsquo;ll collect here.
                  </p>
                </div>
              ) : (
                <ul className="divide-y divide-separator">
                  {entries.map(({ pick, odds }) => {
                    const dead = staleIds.has(pick.id);
                    return (
                      <li
                        key={pick.id}
                        className="flex items-start gap-3 px-6 py-4"
                        style={dead ? { background: "var(--lost-wash)" } : undefined}
                      >
                        <div className="min-w-0 flex-1">
                          <p
                            className="truncate text-[13px] font-semibold"
                            style={dead ? { textDecoration: "line-through" } : undefined}
                          >
                            {teamShort(pick.homeTeam)} v {teamShort(pick.awayTeam)}
                          </p>
                          <p className="mt-0.5 truncate text-[12px] text-muted">
                            {formatMarket(pick.predictionType, pick.predictedValue)}
                          </p>
                          {dead ? (
                            <p
                              className="mt-0.5 truncate text-[11px] font-semibold"
                              style={{ color: "var(--lost-ink)" }}
                            >
                              No longer available
                            </p>
                          ) : (
                            <p className="mt-0.5 truncate text-[11px] text-muted">
                              {pick.league.name}
                            </p>
                          )}
                        </div>

                        <span
                          className="numeral flex-none text-sm"
                          style={dead ? { opacity: 0.4 } : undefined}
                        >
                          {odds.toFixed(2)}
                        </span>

                        <button
                          type="button"
                          onClick={() => remove(pick.id)}
                          aria-label={`Remove ${teamShort(pick.homeTeam)} v ${teamShort(pick.awayTeam)}`}
                          className="press flex h-7 w-7 flex-none items-center justify-center rounded-full text-muted hover:bg-surface-secondary hover:text-foreground"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {entries.length > 0 && (
              <div className="border-t border-separator px-6 py-5">
                <div className="flex items-end justify-between">
                  <div>
                    <span className="label">Combined</span>
                    <p className="numeral mt-1 text-3xl">{combinedOdds.toFixed(2)}</p>
                  </div>
                  <p className="max-w-[11rem] text-right text-[11px] leading-snug text-muted">
                    Indicative prices. MoonOdds doesn&rsquo;t take bets.
                  </p>
                </div>

                {confirm.error && (
                  <Alert status="danger" className="mt-4">
                    {confirm.error.message}
                  </Alert>
                )}

                {staleIds.size > 0 ? (
                  <button
                    type="button"
                    onClick={() => staleIds.forEach((id) => remove(id))}
                    className="press mt-4 h-12 w-full rounded-full text-sm font-semibold"
                    style={{ background: "var(--lost-wash)", color: "var(--lost-ink)" }}
                  >
                    Remove {staleIds.size} unavailable{" "}
                    {staleIds.size === 1 ? "pick" : "picks"}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={confirm.isPending}
                    onClick={save}
                    className="press mt-4 h-12 w-full rounded-full bg-accent text-sm font-semibold text-accent-foreground disabled:opacity-50"
                  >
                    {confirm.isPending ? "Saving…" : "Save slip"}
                  </button>
                )}

                <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-snug text-muted">
                  <Info className="mt-0.5 h-3 w-3 flex-none" />
                  Saving records your selections so we can track them. MoonOdds
                  doesn&rsquo;t take bets or hold funds.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
