import { describe, expect, it } from "vitest";
import { gradePrediction, slugify } from "./pipeline";
import type { Market } from "./types";

/**
 * Grading decides whether a customer's pick won.
 *
 * It had no tests, and it is a deliberate deviation from the Convex original
 * rather than a port: that version returned false for markets it could not
 * evaluate, so corners and half-goal picks were written as LOSSES, and a
 * draw-no-bet draw was a loss instead of a void. Those are exactly the branches
 * where being wrong costs someone a result they were owed, so each one is
 * pinned here.
 */

/** Reads as the scoreline it is: grade(market, value, "2-1"). */
function grade(market: Market, value: string, ft: string, ht?: string) {
  const [hg, ag] = ft.split("-").map(Number);
  const [htHg, htAg] = ht ? ht.split("-").map(Number) : [null, null];
  return gradePrediction(market, value, hg, ag, htHg, htAg);
}

describe("1x2", () => {
  it("grades a home win", () => {
    expect(grade("1x2", "1", "2-1")).toBe("won");
    expect(grade("1x2", "X", "2-1")).toBe("lost");
    expect(grade("1x2", "2", "2-1")).toBe("lost");
  });

  it("grades a draw", () => {
    expect(grade("1x2", "X", "1-1")).toBe("won");
    expect(grade("1x2", "1", "1-1")).toBe("lost");
  });

  it("flags a selection it cannot parse rather than calling it a loss", () => {
    expect(grade("1x2", "Home", "2-1")).toBe("review_needed");
  });
});

describe("over/under", () => {
  it("settles on the line, not around it", () => {
    expect(grade("over_under_2_5", "over", "2-1")).toBe("won");
    expect(grade("over_under_2_5", "under", "2-1")).toBe("lost");
    expect(grade("over_under_2_5", "over", "1-1")).toBe("lost");
    expect(grade("over_under_2_5", "under", "1-1")).toBe("won");
  });

  it("handles 1.5 and 3.5", () => {
    expect(grade("over_under_1_5", "over", "1-1")).toBe("won");
    expect(grade("over_under_1_5", "under", "1-0")).toBe("won");
    expect(grade("over_under_3_5", "over", "2-2")).toBe("won");
    expect(grade("over_under_3_5", "under", "2-1")).toBe("won");
  });

  it("treats a 0-0 as under everything", () => {
    expect(grade("over_under_1_5", "under", "0-0")).toBe("won");
    expect(grade("over_under_2_5", "over", "0-0")).toBe("lost");
  });
});

describe("both teams to score", () => {
  it("needs a goal at each end", () => {
    expect(grade("btts", "yes", "1-1")).toBe("won");
    expect(grade("btts", "yes", "3-0")).toBe("lost");
    expect(grade("btts", "no", "3-0")).toBe("won");
    expect(grade("btts", "no", "0-0")).toBe("won");
  });
});

describe("double chance", () => {
  it("covers two of the three outcomes", () => {
    expect(grade("double_chance", "1X", "2-1")).toBe("won");
    expect(grade("double_chance", "1X", "1-1")).toBe("won");
    expect(grade("double_chance", "1X", "0-1")).toBe("lost");

    expect(grade("double_chance", "X2", "1-1")).toBe("won");
    expect(grade("double_chance", "X2", "0-1")).toBe("won");
    expect(grade("double_chance", "X2", "2-1")).toBe("lost");

    expect(grade("double_chance", "12", "2-1")).toBe("won");
    expect(grade("double_chance", "12", "0-1")).toBe("won");
    expect(grade("double_chance", "12", "1-1")).toBe("lost");
  });
});

describe("draw no bet", () => {
  // The headline deviation from the Convex original, which graded these as
  // losses. A draw returns the stake; calling it a loss takes money from
  // someone who was owed it back.
  it("voids on a draw rather than losing", () => {
    expect(grade("draw_no_bet", "1", "1-1")).toBe("void");
    expect(grade("draw_no_bet", "2", "0-0")).toBe("void");
  });

  it("otherwise grades as a straight win or loss", () => {
    expect(grade("draw_no_bet", "1", "2-1")).toBe("won");
    expect(grade("draw_no_bet", "1", "0-1")).toBe("lost");
    expect(grade("draw_no_bet", "2", "0-1")).toBe("won");
  });
});

describe("handicap", () => {
  it("applies the line to the margin", () => {
    expect(grade("handicap", "home -1.5", "3-1")).toBe("won");
    expect(grade("handicap", "home -1.5", "2-1")).toBe("lost");
    expect(grade("handicap", "away +0.5", "1-1")).toBe("won");
    expect(grade("handicap", "away +1.5", "2-1")).toBe("won");
  });

  it("voids an exact push", () => {
    // Home -1 on a one-goal win: the margin exactly cancels the line.
    expect(grade("handicap", "home -1", "2-1")).toBe("void");
    // Away +1 pushes when the away side loses by exactly one, not when it wins.
    expect(grade("handicap", "away +1", "2-1")).toBe("void");
  });

  it("does not confuse a push with a win on the same line", () => {
    // Away +1 while actually winning is a win by two, not a push.
    expect(grade("handicap", "away +1", "1-2")).toBe("won");
    // Home -1 on a two-goal win clears the line.
    expect(grade("handicap", "home -1", "3-1")).toBe("won");
  });

  it("flags an unparseable line", () => {
    expect(grade("handicap", "home", "2-1")).toBe("review_needed");
    expect(grade("handicap", "home -x", "2-1")).toBe("review_needed");
  });
});

describe("correct score", () => {
  it("needs both numbers, the right way round", () => {
    expect(grade("correct_score", "2-1", "2-1")).toBe("won");
    expect(grade("correct_score", "1-2", "2-1")).toBe("lost");
    expect(grade("correct_score", "2-1", "3-1")).toBe("lost");
  });
});

describe("half-time markets", () => {
  it("grades the first half off the stored half-time score", () => {
    expect(grade("first_half_goals", "over", "3-1", "1-0")).toBe("won");
    expect(grade("first_half_goals", "under", "3-1", "0-0")).toBe("won");
    expect(grade("first_half_goals", "over", "3-1", "0-0")).toBe("lost");
  });

  it("derives the second half by subtraction", () => {
    // 3-1 full time from 0-0 at the break: four goals after it.
    expect(grade("second_half_goals", "over", "3-1", "0-0")).toBe("won");
    // 1-0 full time from 1-0 at the break: none after it.
    expect(grade("second_half_goals", "under", "1-0", "1-0")).toBe("won");
    expect(grade("second_half_goals", "over", "1-0", "1-0")).toBe("lost");
  });

  it("asks for review when there is no half-time score to work from", () => {
    expect(grade("first_half_goals", "over", "3-1")).toBe("review_needed");
    expect(grade("second_half_goals", "over", "3-1")).toBe("review_needed");
  });
});

describe("corners", () => {
  // We do not fetch corner counts, so this can never settle. It returns
  // review_needed rather than guessing, which is why the engine prompt bars it
  // as a primary market.
  it("always asks for review", () => {
    expect(grade("corners_over_under", "over", "2-1")).toBe("review_needed");
    expect(grade("corners_over_under", "under", "0-0")).toBe("review_needed");
  });
});

describe("slugify", () => {
  it("makes a url-safe slug", () => {
    expect(slugify("Bayern Munich")).toBe("bayern-munich");
    expect(slugify("  Real   Madrid  ")).toBe("real-madrid");
  });

  it("strips accents rather than dropping the letters", () => {
    expect(slugify("Atlético Madrid")).toBe("atletico-madrid");
    expect(slugify("Beşiktaş")).toBe("besiktas");
  });
});
