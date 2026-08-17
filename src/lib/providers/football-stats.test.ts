import { describe, expect, it } from "vitest";
import { tallyH2H } from "./live";

/**
 * Head-to-head attribution.
 *
 * API-Football returns each meeting with its own home side, which for a reverse
 * fixture is the opposite of the side we are pricing. Crediting by position
 * rather than by team id inverts the split on half the meetings while leaving
 * the totals looking entirely plausible, which is why this has tests and the
 * rest of the transport does not.
 */

const HOME = 100;
const AWAY = 200;

const meeting = (
  homeTeam: number,
  awayTeam: number,
  hg: number | null,
  ag: number | null,
  status = "FT",
) => ({
  teams: { home: { id: homeTeam }, away: { id: awayTeam } },
  goals: { home: hg, away: ag },
  fixture: { status: { short: status } },
});

describe("tallyH2H", () => {
  it("credits a win at home to the right side", () => {
    const t = tallyH2H([meeting(HOME, AWAY, 2, 1)], HOME);
    expect(t).toMatchObject({ homeWins: 1, awayWins: 0, draws: 0 });
  });

  it("credits a win in the REVERSE fixture to the same side", () => {
    // Our team played away and won 1-2. Read by position this is an "away win"
    // and would be credited to the opponent.
    const t = tallyH2H([meeting(AWAY, HOME, 1, 2)], HOME);
    expect(t).toMatchObject({ homeWins: 1, awayWins: 0, draws: 0 });
  });

  it("credits a reverse-fixture loss to the opponent", () => {
    const t = tallyH2H([meeting(AWAY, HOME, 3, 0)], HOME);
    expect(t).toMatchObject({ homeWins: 0, awayWins: 1, draws: 0 });
  });

  it("counts draws from either direction", () => {
    const t = tallyH2H([meeting(HOME, AWAY, 1, 1), meeting(AWAY, HOME, 2, 2)], HOME);
    expect(t).toMatchObject({ homeWins: 0, awayWins: 0, draws: 2 });
  });

  it("averages goals and both-scored across the meetings", () => {
    const t = tallyH2H(
      [
        meeting(HOME, AWAY, 2, 1), // 3 goals, btts
        meeting(AWAY, HOME, 0, 0), // 0 goals, no btts
        meeting(HOME, AWAY, 3, 0), // 3 goals, no btts
      ],
      HOME,
    );
    expect(t.avgGoals).toBe(2);
    expect(t.bttsRate).toBe(0.333);
  });

  it("ignores matches that never finished", () => {
    // An abandoned game carries null goals. Folding it in as 0-0 would invent
    // a draw that never happened.
    const t = tallyH2H(
      [meeting(HOME, AWAY, 2, 1), meeting(HOME, AWAY, null, null, "PST")],
      HOME,
    );
    expect(t).toMatchObject({ homeWins: 1, draws: 0 });
    expect(t.avgGoals).toBe(3);
  });

  it("reports how many it actually counted", () => {
    // `played` is what lets the caller tell "no history" from "0-0-0", which
    // are very different claims to put in front of the engine.
    expect(tallyH2H([], HOME).played).toBe(0);
    expect(tallyH2H([meeting(HOME, AWAY, null, null, "PST")], HOME).played).toBe(0);
    expect(tallyH2H([meeting(HOME, AWAY, 2, 1)], HOME).played).toBe(1);
  });

  it("returns zeroes rather than dividing by nothing", () => {
    expect(tallyH2H([], HOME)).toEqual({
      homeWins: 0, awayWins: 0, draws: 0, avgGoals: 0, bttsRate: 0, played: 0,
    });
    expect(tallyH2H([meeting(HOME, AWAY, null, null, "PST")], HOME).avgGoals).toBe(0);
  });
});
