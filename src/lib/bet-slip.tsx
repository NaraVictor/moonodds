"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  useSyncExternalStore,
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

/* ---------------------- localStorage as the store ---------------------- */

/**
 * The slip lives in localStorage, and React subscribes to it.
 *
 * It used to be React state mirrored INTO storage by a pair of effects: one to
 * restore on mount, one to write on every change. That needed a `hydrated` flag
 * to stop the write effect clobbering storage before the read had run, and the
 * restore was a setState during an effect — a cascading render, and the thing
 * the lint rule is right to complain about.
 *
 * Inverting it removes all three problems. Storage is the single source of
 * truth, useSyncExternalStore handles the server/client split properly (the
 * server snapshot is empty, so there's no hydration mismatch), and persistence
 * is no longer a separate step that can fall out of sync with the state.
 */

const EMPTY: SlipEntry[] = [];

let cache: SlipEntry[] | null = null;
const listeners = new Set<() => void>();

const today = () => new Date().toISOString().slice(0, 10);

function read(): SlipEntry[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const saved = raw ? (JSON.parse(raw) as { day: string; entries: SlipEntry[] }) : null;
    // Anything from a previous day is stale: those fixtures have kicked off.
    cache = saved?.day === today() ? (saved.entries ?? EMPTY) : EMPTY;
  } catch {
    // Corrupt storage shouldn't break the app; start empty.
    cache = EMPTY;
  }
  return cache;
}

/** No storage on the server, so SSR renders an empty slip. */
function readServer(): SlipEntry[] {
  return EMPTY;
}

function write(next: SlipEntry[]) {
  cache = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ day: today(), entries: next }));
  } catch {
    // Private mode / quota — the slip just won't survive a refresh.
  }
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function BetSlipProvider({ children }: { children: ReactNode }) {
  const entries = useSyncExternalStore(subscribe, read, readServer);
  const [isOpen, setOpen] = useState(false);

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
    const prev = read();
    if (prev.some((e) => e.pick.id === pick.id)) return;
    if (prev.length >= MAX_LEGS) return;
    write([...prev, { pick, odds: legOdds(pick) }]);
  }, []);

  const remove = useCallback((predictionId: string) => {
    write(read().filter((e) => e.pick.id !== predictionId));
  }, []);

  const clear = useCallback(() => write(EMPTY), []);

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
