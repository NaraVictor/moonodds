"use client";

import { useSyncExternalStore } from "react";
import { CONSENT_KEY, updateConsent, type ConsentChoice } from "@/lib/consent";

/**
 * The consent bar.
 *
 * Deliberately not a modal and deliberately not centred: it sits at the bottom,
 * out of the way of the board, and blocks nothing. Someone who never touches it
 * keeps the denied default and loses no functionality, which is what makes
 * "Not now" an honest option rather than a way of nagging.
 *
 * Shown only after the age gate has been answered, so a first-time visitor
 * meets one thing at a time.
 */

const AGE_KEY = "kicka.age-confirmed";

let cache: string | null | undefined;
const listeners = new Set<() => void>();

function subscribe(fn: () => void) {
  listeners.add(fn);
  const onStorage = () => {
    cache = undefined;
    fn();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onStorage);
  };
}

function read(): string | null {
  if (cache === undefined) {
    try {
      // "pending" is not a stored value; it is what an unanswered visitor looks
      // like, and it is distinct from an explicit "denied".
      const consent = localStorage.getItem(CONSENT_KEY);
      const age = localStorage.getItem(AGE_KEY) === "true";
      cache = consent ? consent : age ? "pending" : "waiting-on-age";
    } catch {
      // No storage, no way to remember an answer, so do not ask for one.
      cache = "denied";
    }
  }
  return cache;
}

/** Server renders nothing: storage is the only thing that decides this. */
function readServer(): string | null {
  return "denied";
}

function choose(choice: ConsentChoice) {
  try {
    localStorage.setItem(CONSENT_KEY, choice);
  } catch {
    // Cannot persist; the update below still applies for this page view.
  }
  cache = choice;
  updateConsent(choice);
  // `storage` only fires in OTHER tabs, so the gate in this one is told
  // directly. Without this, allowing analytics does nothing until a reload.
  window.dispatchEvent(new Event("kicka:consent"));
  for (const l of listeners) l();
}

export function ConsentBar() {
  const state = useSyncExternalStore(subscribe, read, readServer);

  if (state !== "pending") return null;

  return (
    <div
      role="region"
      aria-label="Analytics cookies"
      className="fixed inset-x-0 bottom-0 z-[90] flex justify-center p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:justify-start sm:p-4"
    >
      <div className="pointer-events-auto flex w-full max-w-md flex-col gap-3 rounded-2xl border border-border bg-surface p-4 shadow-lg sm:flex-row sm:items-center sm:gap-4">
        <p className="text-[13px] leading-relaxed text-muted">
          We&rsquo;d like to measure which pages get used, with Google
          Analytics. It sets a cookie.{" "}
          <a href="/policy" className="underline underline-offset-2">
            What we collect
          </a>
          .
        </p>
        <div className="flex flex-none gap-2">
          <button
            type="button"
            onClick={() => choose("denied")}
            className="press h-9 flex-1 rounded-full border border-border px-4 text-[13px] font-semibold sm:flex-none"
          >
            No thanks
          </button>
          <button
            type="button"
            onClick={() => choose("granted")}
            className="press h-9 flex-1 rounded-full bg-accent px-4 text-[13px] font-semibold text-accent-foreground sm:flex-none"
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}
