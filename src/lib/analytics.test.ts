import { afterEach, describe, expect, it } from "vitest";
import { analyticsEnabled } from "./analytics";

/**
 * Analytics gating.
 *
 * Wrong in either direction is quiet. Left on in development and preview, it
 * inflates every number without saying so; left off in production, the
 * dashboard reads as no traffic. Neither shows up as an error.
 */

const NODE_ENV = process.env.NODE_ENV;
const VERCEL_ENV = process.env.NEXT_PUBLIC_VERCEL_ENV;

const set = (nodeEnv?: string, vercelEnv?: string) => {
  // process.env rejects a defineProperty descriptor, so assign through a cast.
  const env = process.env as Record<string, string | undefined>;
  if (nodeEnv === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = nodeEnv;
  if (vercelEnv === undefined) delete env.NEXT_PUBLIC_VERCEL_ENV;
  else env.NEXT_PUBLIC_VERCEL_ENV = vercelEnv;
};

afterEach(() => set(NODE_ENV, VERCEL_ENV));

describe("analyticsEnabled", () => {
  it("is off in local development", () => {
    set("development", undefined);
    expect(analyticsEnabled()).toBe(false);
  });

  it("is off in test runs", () => {
    set("test", undefined);
    expect(analyticsEnabled()).toBe(false);
  });

  it("is off on a Vercel preview deployment", () => {
    // A preview is a production BUILD, so NODE_ENV alone would let it through.
    set("production", "preview");
    expect(analyticsEnabled()).toBe(false);
  });

  it("is off on a Vercel development deployment", () => {
    set("production", "development");
    expect(analyticsEnabled()).toBe(false);
  });

  it("is on for a Vercel production deployment", () => {
    set("production", "production");
    expect(analyticsEnabled()).toBe(true);
  });

  it("is on for a production build with no Vercel env exposed", () => {
    // The system-variables checkbox can be off. Falling closed here would
    // silently disable analytics on the real site; the measurement ID being
    // scoped to Production is what keeps previews out in that case.
    set("production", undefined);
    expect(analyticsEnabled()).toBe(true);
  });
});
