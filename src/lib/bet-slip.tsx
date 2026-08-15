"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Pick } from "./types";

/**
 * The bet slip.
 *
 * Lives client-side until confirmed — a slip in progress isn't worth a round
 * trip, and losing it on a refresh is worse than the storage cost, so it
 * persists to localStorage keyed per day.
 *
 * On confirm it goes through /api/slips, which wraps the slip and its legs in
 * one transaction.
 */

export type SlipEntry = {
  pick: Pick;
  odds: number;
};

type BetSlipContext = {
  entries: SlipEntry[];
  add: (pick: Pick) => void;
  remove: (predictionId: string) => void;
  clear: () => void;
  has: (predictionId: string) => boolean;
  combinedOdds: number;
  isOpen: boolean;
  setOpen: (v: boolean) => void;
};

const Ctx = createContext<BetSlipContext | null>(null);

const STORAGE_KEY = "moonodds.slip";
const MAX_LEGS = 12;

/**
 * The price for a leg.
 *
 * Comes from the pick payload, which reads odds_snapshots server-side. An
 * earlier version derived this as 1/confidence — that was wrong: model
 * confidence is not market probability, so a 97% call priced at 1.03 and an
 * accumulator of strong picks never cleared 1.10. The gap between our
 * confidence and the book's price is the edge; collapsing it erased the point.
 */
export function legOdds(pick: Pick): number {
  return pick.odds && pick.odds > 1 ? pick.odds : 1.9;
}

export function BetSlipProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<SlipEntry[]>([]);
  const [isOpen, setOpen] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  // Restore, discarding anything from a previous day.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { day: string; entries: SlipEntry[] };
        if (saved.day === new Date().toISOString().slice(0, 10)) {
          setEntries(saved.entries ?? []);
        }
      }
    } catch {
      // Corrupt storage shouldn't break the app; start empty.
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ day: new Date().toISOString().slice(0, 10), entries }),
      );
    } catch {
      // Private mode / quota — the slip just won't survive a refresh.
    }
  }, [entries, hydrated]);

  /**
   * Adding does NOT open the sheet.
   *
   * It used to, and that was the bug behind "the slip button never appears":
   * the sheet covered the screen the instant you added anything, and the FAB
   * hides itself while the sheet is open — so the affordance was never seen.
   * Worse, it interrupted the browsing you were in the middle of. Feedback for
   * an add belongs on the counter, not in a takeover.
   */
  const add = useCallback((pick: Pick) => {
    setEntries((prev) => {
      if (prev.some((e) => e.pick.id === pick.id)) return prev;
      if (prev.length >= MAX_LEGS) return prev;
      return [...prev, { pick, odds: legOdds(pick) }];
    });
  }, []);

  const remove = useCallback((predictionId: string) => {
    setEntries((prev) => prev.filter((e) => e.pick.id !== predictionId));
  }, []);

  const clear = useCallback(() => setEntries([]), []);

  const has = useCallback(
    (predictionId: string) => entries.some((e) => e.pick.id === predictionId),
    [entries],
  );

  const combinedOdds = useMemo(
    () =>
      entries.length
        ? Math.round(entries.reduce((acc, e) => acc * e.odds, 1) * 100) / 100
        : 0,
    [entries],
  );

  const value = useMemo(
    () => ({ entries, add, remove, clear, has, combinedOdds, isOpen, setOpen }),
    [entries, add, remove, clear, has, combinedOdds, isOpen],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useBetSlip() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useBetSlip must be used inside BetSlipProvider");
  return ctx;
}
