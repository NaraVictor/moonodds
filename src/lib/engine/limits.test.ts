import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_FIXTURES_PER_SESSION,
  ENGINE_CALL_BUDGET_MS,
  MAX_FIXTURES_OVERRIDE,
  sessionCap,
} from "./limits";

/**
 * The session cap decides how much work one model call is asked to do, and the
 * model call is what a 240s timeout kills. A cap that silently exceeded the
 * ceiling would not fail loudly; it would abort a run mid-write, having already
 * paid for every fixture it analysed.
 */

describe("sessionCap", () => {
  it("takes the config's cap when no override is given", () => {
    expect(sessionCap({ maxFixturesPerSession: 15 })).toBe(15);
  });

  it("falls back to one shared default, not a per-call literal", () => {
    expect(sessionCap(null)).toBe(DEFAULT_MAX_FIXTURES_PER_SESSION);
    expect(sessionCap(undefined)).toBe(DEFAULT_MAX_FIXTURES_PER_SESSION);
    expect(sessionCap({})).toBe(DEFAULT_MAX_FIXTURES_PER_SESSION);
  });

  it("lets an override beat the config in both directions", () => {
    expect(sessionCap({ maxFixturesPerSession: 20 }, 3)).toBe(3);
    expect(sessionCap({ maxFixturesPerSession: 5 }, 25)).toBe(25);
  });

  it("clamps rather than trusting the number it was handed", () => {
    expect(sessionCap({}, 999)).toBe(MAX_FIXTURES_OVERRIDE);
    expect(sessionCap({}, 0)).toBe(1);
    expect(sessionCap({}, -4)).toBe(1);
    expect(sessionCap({}, 7.9)).toBe(7);
  });

  it("treats a non-number as no override, not as zero fixtures", () => {
    expect(sessionCap({ maxFixturesPerSession: 12 }, Number.NaN)).toBe(12);
    expect(sessionCap({ maxFixturesPerSession: 12 }, undefined)).toBe(12);
  });

  it("holds the relationships the ceiling depends on", () => {
    // The route dies at 300s. The client must fail first, or an overrun is a
    // vanished function rather than an error anyone can read.
    expect(ENGINE_CALL_BUDGET_MS).toBeLessThan(300_000);
    // An override is allowed to raise the default, never to sit below it — a
    // ceiling under the floor would make the field reject the config's own cap.
    expect(MAX_FIXTURES_OVERRIDE).toBeGreaterThanOrEqual(
      DEFAULT_MAX_FIXTURES_PER_SESSION,
    );
  });

  /*
   * WHAT THE ONE MEASUREMENT ACTUALLY SAYS, written down because it is
   * uncomfortable and would otherwise be forgotten.
   *
   * Seven fixtures took 152 seconds: 21.7 seconds each if the cost is linear.
   * At that rate the default of 20 needs roughly 434 seconds, which is past the
   * 240s client timeout AND past the 300s route ceiling.
   *
   * The rate is very unlikely to be linear — a large share of 152s is fixed
   * setup and reasoning that does not repeat per fixture — so 20 may well be
   * fine. But "may well be" is the whole problem, and nobody has watched a
   * twenty-fixture run finish.
   *
   * This test does not fail on that, because the default is a deliberate
   * operational choice and a test is not the place to overrule it. It asserts
   * only that the gap between the linear reading and the budget is real, so
   * that whoever deletes this comment has to look at the numbers first.
   */
  it("records that the default is an extrapolation, not a measurement", () => {
    const linearMs = DEFAULT_MAX_FIXTURES_PER_SESSION * (152_000 / 7);
    expect(linearMs).toBeGreaterThan(ENGINE_CALL_BUDGET_MS);
  });
});
