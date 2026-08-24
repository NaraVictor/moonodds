import { describe, expect, it } from "vitest";
import { gradePrediction, replaceVerdict, slugify, statsBlock } from "./pipeline";
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

/**
 * One pick per fixture.
 *
 * Before this, every run over the same board wrote another row: three runs on a
 * seven-fixture Monday left three live, competing calls per match, and nothing
 * downstream chose between them. The rule that replaced it can fail two ways
 * that no error surfaces — rewriting a pick a customer is holding, or keeping
 * the weaker of two calls — so each branch is pinned.
 */
describe("replaceVerdict", () => {
  const none = new Set<string>();
  const pending = (confidence: number, id = "p1") => ({
    id,
    status: "pending",
    confidence_score: confidence,
  });

  it("writes when the fixture has nothing on it", () => {
    expect(replaceVerdict(null, 7.5, none)).toBe("write");
  });

  it("replaces a weaker pending pick", () => {
    expect(replaceVerdict(pending(7.2), 8.1, none)).toBe("write");
  });

  it("keeps the incumbent when the new pick is weaker", () => {
    expect(replaceVerdict(pending(8.1), 7.2, none)).toBe("weaker");
  });

  it("keeps the incumbent on a tie, so a rerun does not churn the board", () => {
    expect(replaceVerdict(pending(7.5), 7.5, none)).toBe("weaker");
  });

  it("never rewrites a pick a customer is holding, however much better", () => {
    expect(replaceVerdict(pending(5, "held"), 9.8, new Set(["held"]))).toBe("slipped");
  });

  it("never overwrites a pick that has been ruled on", () => {
    for (const status of ["won", "lost", "void", "review_needed"]) {
      expect(
        replaceVerdict({ id: "p1", status, confidence_score: 4 }, 9.9, none),
        `status ${status} must not be overwritten`,
      ).toBe("settled");
    }
  });

  it("compares numerically, not as text", () => {
    // confidence_score arrives from PostgREST as a string on a numeric column,
    // and "9.5" > "10" is true under string comparison.
    expect(replaceVerdict(pending("9.5" as unknown as number), 10, none)).toBe("write");
  });
});

/**
 * The season block the engine reads.
 *
 * Two silent failures live here. An average printed without its sample reads
 * identically at matchday 2 and matchday 38, and Step 1 calls it the primary
 * quantitative signal in both cases. And a prior-season line left on show once
 * the current season stands up invites the model to average a live number with
 * a stale one.
 */
describe("season averages in the prompt", () => {
  const thin = { gamesPlayed: 2, avgGoalsScored: 1.5, avgGoalsConceded: 2, cleanSheetRate: 0, bttsRate: 1 };
  const settled = { gamesPlayed: 38, avgGoalsScored: 1.71, avgGoalsConceded: 1.13, cleanSheetRate: 0.316, bttsRate: 0.5 };

  it("states the games behind every season line", () => {
    const out = statsBlock({ home_season: settled, away_season: settled }, null);
    expect(out).toContain("Home season (38 played)");
    expect(out).toContain("Away season (38 played)");
  });

  it("marks a short season THIN so it cannot be read as settled", () => {
    const out = statsBlock({ home_season: thin, away_season: settled }, null);
    expect(out).toContain("Home season (2 played, THIN)");
    expect(out).not.toContain("Away season (38 played, THIN)");
  });

  it("prints last season beneath a side whose current season is short", () => {
    const out = statsBlock(
      { home_season: thin, away_season: settled, home_season_prior: settled },
      null,
    );
    expect(out).toContain("Home LAST season (38 played");
    expect(out).toMatch(/Home season \(2 played, THIN\)[\s\S]*Home LAST season/);
  });

  it("suppresses last season once the current one stands on its own", () => {
    // The fetch stops asking for it, but a stored row survives the crossover.
    // Showing it then is an invitation to average a live number with a stale one.
    const out = statsBlock(
      { home_season: settled, away_season: settled, home_season_prior: settled },
      null,
    );
    expect(out).not.toContain("LAST season");
  });

  it("says nothing extra for a thin side with no prior record", () => {
    // A promoted or newly tracked side. Thin and unknown are different claims,
    // and inventing a prior line here would collapse them.
    const out = statsBlock({ home_season: thin, away_season: thin }, null);
    expect(out).toContain("THIN");
    expect(out).not.toContain("LAST season");
  });

  it("refuses to state an average over zero games", () => {
    // The endpoint answers a side that has not kicked a ball with zeros, not
    // nulls. Printing them claims they score nothing and concede nothing, and
    // Step 1 reads that as the primary quantitative signal. On an opening
    // weekend that was four of seven fixtures.
    const none = { gamesPlayed: 0, avgGoalsScored: 0, avgGoalsConceded: 0, cleanSheetRate: 0, bttsRate: 0 };
    const out = statsBlock({ home_season: none, away_season: none }, null);
    expect(out).toContain("Home season: no matches played yet this season");
    expect(out).not.toMatch(/0 scored \/ 0 conceded/);
  });

  it("falls back to last season for a side that has not played yet", () => {
    const none = { gamesPlayed: 0, avgGoalsScored: 0, avgGoalsConceded: 0, cleanSheetRate: 0, bttsRate: 0 };
    const out = statsBlock({ home_season: none, away_season: none, home_season_prior: settled }, null);
    expect(out).toContain("Home season: no matches played yet this season");
    expect(out).toContain("Home LAST season (38 played");
    // The away side has no prior, so it must read as unknown rather than as a
    // gap that someone will fill in later.
    expect(out).toContain("Away has no record here last season either");
    expect(out).not.toContain("Home has no record here last season");
  });

  it("still renders when the feed omits gamesPlayed entirely", () => {
    const out = statsBlock(
      { home_season: { avgGoalsScored: 1.2 }, away_season: {} },
      null,
    );
    expect(out).toContain("Home season:");
    expect(out).not.toContain("played");
  });
});

/**
 * Which of a fixture's existing picks a fresh run may touch.
 *
 * Every branch here is a thing that must NOT happen: overwriting a graded
 * result, rewriting a pick sitting on someone's slip, or churning the board on
 * a rerun that found nothing better.
 */
describe("replaceVerdict", () => {
  const none = new Set<string>();
  const pending = (score: number, id = "p1") => ({
    id,
    status: "pending",
    confidence_score: score,
  });

  it("writes where the fixture has nothing", () => {
    expect(replaceVerdict(null, 7.5, none)).toBe("write");
  });

  it("replaces a weaker pick with a stronger one", () => {
    expect(replaceVerdict(pending(7.0), 7.6, none)).toBe("write");
  });

  it("keeps the incumbent on a tie, so a rerun does not churn the board", () => {
    expect(replaceVerdict(pending(7.4), 7.4, none)).toBe("weaker");
  });

  it("keeps the incumbent when the new pick is worse", () => {
    expect(replaceVerdict(pending(8.1), 7.2, none)).toBe("weaker");
  });

  it("never overwrites a pick a customer is holding, however much better", () => {
    expect(replaceVerdict(pending(5.0), 9.8, new Set(["p1"]))).toBe("slipped");
  });

  it("never overwrites a settled or flagged pick", () => {
    for (const status of ["won", "lost", "void", "review_needed"]) {
      expect(replaceVerdict({ id: "p1", status, confidence_score: 5 }, 9.8, none)).toBe(
        "settled",
      );
    }
  });

  it("reads a confidence that arrives as a string", () => {
    // numeric columns come back as strings through PostgREST, and a string
    // compare would make "9.5" < "10" false and silently stop replacing.
    expect(replaceVerdict({ id: "p1", status: "pending", confidence_score: "7.0" }, 7.6, none))
      .toBe("write");
  });
});
