"use client";

import { useCallback, useSyncExternalStore } from "react";

export type ThemePref = "light" | "dark" | "system";

const STORAGE_KEY = "moonodds.theme";

/**
 * Light, dark or follow the system.
 *
 * The dark palette has existed in globals.css since the reskin but was
 * unreachable — layout.tsx hard-coded data-theme="light". This is the control
 * that was missing, not new styling.
 *
 * Preference is per-device rather than on the profile: it's a property of the
 * screen you're looking at, not of who you are, and a phone in bed and a desk
 * monitor at noon reasonably want different answers.
 *
 * The applied theme is written to <html data-theme> because that is the
 * selector the stylesheet keys on; "system" removes the attribute entirely so
 * the prefers-color-scheme media query takes over on its own.
 */

let cache: ThemePref | null = null;
const listeners = new Set<() => void>();

function read(): ThemePref {
  if (cache) return cache;
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    cache = v === "light" || v === "dark" || v === "system" ? v : "system";
  } catch {
    cache = "system";
  }
  return cache;
}

/** Server renders the light default; the inline script corrects it pre-paint. */
function readServer(): ThemePref {
  return "system";
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Applies the preference to the document root. */
export function applyTheme(pref: ThemePref) {
  const root = document.documentElement;
  if (pref === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", pref);
}

export function useTheme() {
  const theme = useSyncExternalStore(subscribe, read, readServer);

  const choose = useCallback((next: ThemePref) => {
    cache = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Private mode — the choice just won't survive the session.
    }
    applyTheme(next);
    for (const fn of listeners) fn();
  }, []);

  return { theme, choose };
}

/**
 * Runs before first paint, from a blocking inline script in <head>.
 *
 * Without this a dark-mode visitor gets a white flash on every navigation while
 * React hydrates and works out what they picked. Stringified deliberately: it
 * has to execute before the bundle exists.
 */
export const THEME_INIT_SCRIPT = `
(function(){
  try {
    var p = localStorage.getItem("${STORAGE_KEY}");
    if (p === "light" || p === "dark") {
      document.documentElement.setAttribute("data-theme", p);
    } else {
      document.documentElement.removeAttribute("data-theme");
    }
  } catch (e) {}
})();
`.trim();
