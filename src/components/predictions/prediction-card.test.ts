import { describe, expect, it } from "vitest";
import { timing } from "./prediction-card";
import type { Pick } from "@/lib/types";

/**
 * The card must not make a claim the reader can disprove with their own clock.
 *
 * A fixture whose status never moved off `scheduled` — because nothing fetched
 * the result — rendered "Starts 6:45 pm" three hours after 6:45 pm. The feed
 * being stale is a separate problem; the card reading the feed INSTEAD OF the
 * clock is this one, and it is the half that shows up in front of a customer.
 */

const KICKOFF = "2026-08-24T18:45:00+00:00";
const at = (iso: string) => new Date(iso).getTime();

function pick(status: Pick["fixture"]["status"]): Pick {
  return {
    id: "p1",
    status: "pending",
    fixture: {
      id: "f1",
      date: KICKOFF,
      status,
      venue: null,
      round: null,
      homeGoals: null,
      awayGoals: null,
    },
    homeTeam: { name: "AS Roma", shortName: "ROM", logo: null },
    awayTeam: { name: "Fiorentina", shortName: "FIO", logo: null },
    league: { name: "Serie A", country: "Italy", logo: null },
  } as Pick;
}

describe("prediction card timing", () => {
  it("says Starts only while kickoff is genuinely ahead", () => {
    expect(timing(pick("scheduled"), at("2026-08-24T17:00:00+00:00"))).toMatch(/^Starts /);
  });

  it("stops saying Starts the moment kickoff passes", () => {
    const label = timing(pick("scheduled"), at("2026-08-24T18:50:00+00:00"));
    expect(label).not.toMatch(/Starts/);
    expect(label).toMatch(/^Kicked off /);
  });

  it("reads Awaiting result once the match must be over", () => {
    // The exact case reported: 21:54, kickoff 18:45, status still scheduled
    // because nothing has graded it.
    expect(timing(pick("scheduled"), at("2026-08-24T21:54:00+00:00"))).toBe(
      "Awaiting result",
    );
  });

  it("still trusts the feed where the feed is informative", () => {
    expect(timing(pick("finished"), at("2026-08-24T21:54:00+00:00"))).toBe("Full time");
    expect(timing(pick("live"), at("2026-08-24T19:00:00+00:00"))).toMatch(/^Kicked off /);
  });
});
