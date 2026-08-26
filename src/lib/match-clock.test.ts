import { describe, expect, it } from "vitest";
import { matchClock } from "./format";
import type { Pick } from "./types";

/**
 * The clock is the one thing on a live card a viewer can check against a
 * television. Every case below is one where showing a plain minute would be
 * wrong: a break has no running minute, stoppage is not a 47th minute, and a
 * fixture the poller has not reached has no minute at all.
 */

const fx = (over: Partial<Pick["fixture"]>): Pick["fixture"] =>
  ({
    id: "f1",
    date: "2026-08-25T18:45:00+00:00",
    status: "live",
    venue: null,
    round: null,
    homeGoals: 1,
    awayGoals: 0,
    ...over,
  }) as Pick["fixture"];

describe("matchClock", () => {
  it("shows the minute in normal play", () => {
    expect(matchClock(fx({ statusShort: "1H", elapsed: 31 }))).toBe("31'");
    expect(matchClock(fx({ statusShort: "2H", elapsed: 67 }))).toBe("67'");
  });

  it("shows stoppage as an addition, not as a later minute", () => {
    // 45+2 is not the 47th minute, and a viewer reading "47'" against a
    // broadcast showing 45+2 would think the card was wrong.
    expect(matchClock(fx({ statusShort: "1H", elapsed: 45, elapsedExtra: 2 }))).toBe("45+2'");
    expect(matchClock(fx({ statusShort: "2H", elapsed: 90, elapsedExtra: 4 }))).toBe("90+4'");
  });

  it("names the breaks rather than freezing on the minute they paused at", () => {
    // The feed keeps reporting elapsed 45 through half time. Rendering it
    // claims the game is running when it is not.
    expect(matchClock(fx({ statusShort: "HT", elapsed: 45 }))).toBe("HT");
    expect(matchClock(fx({ statusShort: "BT", elapsed: 90 }))).toBe("BT");
    expect(matchClock(fx({ statusShort: "P", elapsed: 120 }))).toBe("PENS");
    expect(matchClock(fx({ statusShort: "SUSP", elapsed: 60 }))).toBe("SUSP");
  });

  it("returns null when there is no clock, so the caller can fall back", () => {
    // A live fixture the poller has not reached yet. An empty space where a
    // minute belongs reads as a broken card; the kickoff line takes over.
    expect(matchClock(fx({ statusShort: "1H", elapsed: null }))).toBeNull();
    expect(matchClock(fx({}))).toBeNull();
  });

  it("treats zero extra as no stoppage", () => {
    expect(matchClock(fx({ statusShort: "1H", elapsed: 45, elapsedExtra: 0 }))).toBe("45'");
  });

  it("reads the status code whatever case it arrives in", () => {
    expect(matchClock(fx({ statusShort: "ht", elapsed: 45 }))).toBe("HT");
  });
});
