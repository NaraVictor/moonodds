"use client";

import { useCallback, useSyncExternalStore } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createClient } from "./supabase/client";
import { keys, useProfile } from "./queries";

export type BoardView = "cards" | "table";

const STORAGE_KEY = "kicka.board-view";

/* ------------------------- localStorage as a store ------------------------ */

let cache: BoardView | null | undefined;
const listeners = new Set<() => void>();

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** null means "no local choice", which lets the profile value win. */
function getSnapshot(): BoardView | null {
  if (cache === undefined) {
    try {
      const v = localStorage.getItem(STORAGE_KEY);
      cache = v === "cards" || v === "table" ? v : null;
    } catch {
      cache = null;
    }
  }
  return cache;
}

/** No storage on the server, so SSR renders the profile/default view. */
function getServerSnapshot(): BoardView | null {
  return null;
}

function writeLocal(next: BoardView) {
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Private mode, the profile write is the durable copy.
  }
  cache = next;
  for (const fn of listeners) fn();
}

/* -------------------------------- the hook ------------------------------- */

/**
 * Card or table, remembered.
 *
 * Two stores, because there are two kinds of visitor. A signed-in user's choice
 * belongs on their profile so it follows them between devices; a signed-out one
 * has nowhere to put it but localStorage. Both are written either way, so the
 * preference survives signing in rather than resetting at the moment someone
 * commits to an account.
 *
 * Local wins when present. That ordering matters: a toggle has to feel
 * instant, and waiting for a round trip to redraw a list you are already
 * looking at would be absurd. The server write follows in the background and
 * only decides what a *fresh* device sees.
 *
 * Storage is read through useSyncExternalStore rather than an effect, it is
 * genuinely an external store, and the effect version both tripped the
 * cascading-render rule and risked a hydration mismatch.
 */
export function useBoardView() {
  const { data: profile } = useProfile();
  const qc = useQueryClient();

  const local = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const fromProfile = profile?.view_preference;
  const view: BoardView =
    local ?? (fromProfile === "table" || fromProfile === "cards" ? fromProfile : "cards");

  const persist = useMutation({
    mutationFn: async (next: BoardView) => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return; // Signed out: localStorage already has it.
      const { error } = await supabase
        .from("profiles")
        .update({ view_preference: next })
        .eq("id", user.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.profile }),
  });

  const choose = useCallback(
    (next: BoardView) => {
      writeLocal(next);
      persist.mutate(next);
    },
    [persist],
  );

  return { view, choose };
}
