"use client";

import { useSyncExternalStore } from "react";
import { GoogleAnalytics } from "@next/third-parties/google";
import { CONSENT_KEY } from "@/lib/consent";

/**
 * Google Analytics, loaded only once someone has said yes.
 *
 * Consent Mode alone would have been defensible: with analytics_storage denied
 * the tag sets no cookie and sends a "cookieless ping" flagged gcs=G100, which
 * is the documented compliant behaviour. Verified that it does exactly that.
 *
 * This is stricter, because the ping still carries a temporary identifier and
 * still tells Google someone visited, and nothing in the product depends on
 * sending it. Not requesting the script at all is easier to defend than
 * explaining what a cookieless ping is, and it costs a tag load that only
 * happens for people who agreed to it anyway.
 *
 * The Consent Mode defaults in <head> stay regardless. They are the belt to
 * this braces: if the tag ever loads by another route, it loads denied.
 */

let cache: boolean | undefined;
const listeners = new Set<() => void>();

function subscribe(fn: () => void) {
  listeners.add(fn);
  const onChange = () => {
    cache = undefined;
    fn();
  };
  window.addEventListener("storage", onChange);
  window.addEventListener("kicka:consent", onChange);
  return () => {
    listeners.delete(fn);
    window.removeEventListener("storage", onChange);
    window.removeEventListener("kicka:consent", onChange);
  };
}

function granted(): boolean {
  if (cache === undefined) {
    try {
      cache = localStorage.getItem(CONSENT_KEY) === "granted";
    } catch {
      cache = false;
    }
  }
  return cache;
}

/** Never on the server: consent lives in storage the server cannot read. */
function grantedServer(): boolean {
  return false;
}

export function AnalyticsGate({ gaId }: { gaId: string }) {
  const ok = useSyncExternalStore(subscribe, granted, grantedServer);
  if (!ok || !gaId) return null;
  return <GoogleAnalytics gaId={gaId} />;
}
