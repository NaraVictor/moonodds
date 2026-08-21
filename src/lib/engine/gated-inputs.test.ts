import { describe, expect, it } from "vitest";
import { batchAbsentFeeds, statsBlock } from "@/lib/pipeline";
import { toMeetings } from "@/lib/providers/live";

/**
 * The inputs that gate Steps 1D, 1E and the rest overlay.
 *
 * These steps fail silently by design: an absent feed means "skip, apply no
 * penalty, say nothing", which is indistinguishable in the output from a feed
 * that arrived and was mislabelled as absent. Nothing downstream errors, so
 * the tests are the only place that difference is visible.
 */

const meeting = (
  homeTeam: number,
  awayTeam: number,
  hg: number | null,
  ag: number | null,
  date = "2025-03-02T15:00:00+00:00",
  status = "FT",
) => ({
  teams: { home: { id: homeTeam }, away: { id: awayTeam } },
  goals: { home: hg, away: ag },
  fixture: { status: { short: status }, date },
});

describe("toMeetings", () => {
  it("keeps each meeting's own host rather than the coming fixture's", () => {
    const rows = [meeting(100, 200, 2, 1), meeting(200, 100, 0, 3)];
    expect(toMeetings(rows)).toEqual([
      { date: "2025-03-02T15:00:00+00:00", homeExternalId: 100, awayExternalId: 200, homeGoals: 2, awayGoals: 1 },
      { date: "2025-03-02T15:00:00+00:00", homeExternalId: 200, awayExternalId: 100, homeGoals: 0, awayGoals: 3 },
    ]);
  });

  it("drops abandoned meetings rather than reading them as goalless", () => {
    expect(toMeetings([meeting(100, 200, null, null, "2025-03-02T15:00:00+00:00", "PST")])).toEqual([]);
  });

  it("drops a meeting with no date, which cannot be weighted by recency", () => {
    const undated = { ...meeting(100, 200, 1, 0), fixture: { status: { short: "FT" } } };
    expect(toMeetings([undated as never])).toEqual([]);
  });

  it("agrees with the tally about which meetings count", () => {
    // Both filter on finished-with-scores. If they ever disagree, the engine
    // gets a meeting list and a set of totals describing different histories.
    const rows = [
      meeting(100, 200, 2, 1),
      meeting(100, 200, null, null, "2025-01-01T00:00:00+00:00", "PST"),
      meeting(200, 100, 1, 1),
    ];
    expect(toMeetings(rows)).toHaveLength(2);
  });
});

describe("batchAbsentFeeds", () => {
  it("declares a feed absent when no fixture in the batch carries it", () => {
    const sentence = batchAbsentFeeds([{ h2h_matches: [], home_split: {}, home_recent_matches: [] }]);
    expect(sentence).toContain("individual head-to-head meetings");
    expect(sentence).toContain("venue-separated form");
    expect(sentence).toContain("fixture congestion");
  });

  it("stops declaring a feed absent as soon as one fixture carries it", () => {
    const sentence = batchAbsentFeeds([
      { h2h_matches: [], home_split: {}, home_recent_matches: [] },
      { h2h_matches: [{ date: "x" }], home_split: { home: {}, away: {} }, home_recent_matches: [{ date: "y" }] },
    ]);
    expect(sentence).not.toContain("individual head-to-head meetings");
    expect(sentence).not.toContain("venue-separated form");
    expect(sentence).not.toContain("fixture congestion");
  });

  it("always names the feeds nothing in this build fetches", () => {
    const sentence = batchAbsentFeeds([
      { h2h_matches: [{ date: "x" }], home_split: { home: {}, away: {} }, home_recent_matches: [{ date: "y" }] },
    ]);
    for (const feed of ["lineups", "injuries", "odds", "standings", "weather", "referee history"]) {
      expect(sentence).toContain(feed);
    }
  });

  it("handles an empty batch without claiming everything is present", () => {
    const sentence = batchAbsentFeeds([]);
    expect(sentence).toContain("individual head-to-head meetings");
  });
});

describe("statsBlock", () => {
  const base = {
    home_form: "WWDLW",
    away_form: "LDWLL",
    h2h_home_wins: 2,
    h2h_away_wins: 1,
    h2h_draws: 1,
    home_season: { avgGoalsScored: 1.9 },
    away_season: { avgGoalsScored: 1.1 },
  };

  it("writes every meeting home-side-first, whoever actually hosted", () => {
    // Second meeting is the reverse fixture: our home side played away and
    // won 1-3. Printed as the API reports it, that reads as a 1-3 defeat.
    const block = statsBlock(
      {
        ...base,
        h2h_matches: [
          { date: "2025-03-02T15:00:00Z", homeExternalId: 100, awayExternalId: 200, homeGoals: 2, awayGoals: 1 },
          { date: "2024-09-14T15:00:00Z", homeExternalId: 200, awayExternalId: 100, homeGoals: 1, awayGoals: 3 },
        ],
      },
      100,
    );
    expect(block).toContain("2025-03-02 H 2-1");
    expect(block).toContain("2024-09-14 A 3-1");
  });

  it("omits the meeting line when the home side's id is unknown", () => {
    // Without it the meetings cannot be attributed, and an unattributed list
    // is worse than none: half the scores would be silently inverted.
    const block = statsBlock(
      { ...base, h2h_matches: [{ date: "2025-03-02T15:00:00Z", homeExternalId: 100, awayExternalId: 200, homeGoals: 2, awayGoals: 1 }] },
      null,
    );
    expect(block).not.toContain("H2H meetings");
  });

  it("omits a venue split that carries no games", () => {
    const block = statsBlock(
      { ...base, home_split: { home: { gamesPlayed: 0 }, away: { gamesPlayed: 0 } } },
      100,
    );
    expect(block).not.toContain("by venue");
  });

  it("labels the recent schedule as league-only", () => {
    const block = statsBlock(
      { ...base, home_recent_matches: [{ date: "2026-08-18T15:00:00Z", opponent: "Chelsea", venue: "home" }] },
      100,
    );
    expect(block).toContain("2026-08-18 vs Chelsea");
    expect(block).toContain("league matches only");
  });

  it("still reports absent H2H as absent rather than as zeros", () => {
    const block = statsBlock({ ...base, h2h_home_wins: null }, 100);
    expect(block).toContain("none available");
  });
});
