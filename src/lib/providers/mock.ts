import type {
  AiProvider,
  RawFixtureStats,
  EnginePick,
  FootballProvider,
  MessagingProvider,
  PaymentProvider,
  RawFixture,
} from "./types";
import type { Market } from "@/lib/types";

/**
 * Canned providers. No network, no keys, no spend.
 *
 * These aren't stubs that return empty arrays — they generate plausible,
 * varied data so the pipeline, grading and payment flows can be exercised
 * end to end and the UI has something real-shaped to render.
 */

/** Deterministic PRNG so a given seed always produces the same fixtures. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

const TEAM_POOL: Record<number, Array<[number, string, string]>> = {
  39: [
    [42, "Arsenal", "ARS"],
    [50, "Manchester City", "MCI"],
    [40, "Liverpool", "LIV"],
    [49, "Chelsea", "CHE"],
    [34, "Newcastle United", "NEW"],
    [47, "Tottenham", "TOT"],
  ],
  140: [
    [541, "Real Madrid", "RMA"],
    [529, "Barcelona", "BAR"],
    [530, "Atletico Madrid", "ATM"],
    [531, "Athletic Club", "ATH"],
  ],
  135: [
    [505, "Inter", "INT"],
    [489, "AC Milan", "MIL"],
    [496, "Juventus", "JUV"],
    [492, "Napoli", "NAP"],
  ],
  78: [
    [157, "Bayern Munich", "BAY"],
    [168, "Bayer Leverkusen", "B04"],
    [165, "Borussia Dortmund", "BVB"],
    [173, "RB Leipzig", "RBL"],
  ],
  61: [
    [85, "Paris Saint-Germain", "PSG"],
    [81, "Marseille", "OM"],
    [91, "Monaco", "ASM"],
    [79, "Lille", "LIL"],
  ],
  88: [
    [194, "Ajax", "AJA"],
    [197, "PSV", "PSV"],
    [209, "Feyenoord", "FEY"],
    [201, "AZ Alkmaar", "AZ"],
  ],
};

const LEAGUE_META: Record<number, { name: string; country: string }> = {
  39: { name: "Premier League", country: "England" },
  140: { name: "La Liga", country: "Spain" },
  135: { name: "Serie A", country: "Italy" },
  78: { name: "Bundesliga", country: "Germany" },
  61: { name: "Ligue 1", country: "France" },
  88: { name: "Eredivisie", country: "Netherlands" },
};

export const mockFootball: FootballProvider = {
  async fetchFixtures(date, leagueIds) {
    const seed =
      Number(date.replaceAll("-", "")) % 100000 || Date.now() % 100000;
    const rand = rng(seed);
    const out: RawFixture[] = [];

    for (const leagueId of leagueIds) {
      const teams = TEAM_POOL[leagueId];
      const meta = LEAGUE_META[leagueId];
      if (!teams || !meta) continue;

      const count = 1 + Math.floor(rand() * 2);
      const used = new Set<number>();

      for (let i = 0; i < count; i++) {
        let h = Math.floor(rand() * teams.length);
        let a = Math.floor(rand() * teams.length);
        while (a === h) a = (a + 1) % teams.length;
        if (used.has(h) || used.has(a)) continue;
        used.add(h);
        used.add(a);

        const kickoff = new Date(`${date}T00:00:00Z`);
        kickoff.setUTCHours(13 + Math.floor(rand() * 8));

        out.push({
          externalId: Number(
            `${leagueId}${date.replaceAll("-", "").slice(4)}${i}`,
          ),
          leagueExternalId: leagueId,
          leagueName: meta.name,
          country: meta.country,
          season: kickoff.getUTCFullYear(),
          round: `Regular Season - ${10 + Math.floor(rand() * 25)}`,
          kickoff: kickoff.toISOString(),
          venue: `${teams[h][1]} Stadium`,
          referee: ["M. Oliver", "A. Taylor", "C. Pawson", "S. Hooper"][
            Math.floor(rand() * 4)
          ],
          status: "scheduled",
          homeGoals: null,
          awayGoals: null,
          htHomeGoals: null,
          htAwayGoals: null,
          home: {
            externalId: teams[h][0],
            name: teams[h][1],
            shortName: teams[h][2],
          },
          away: {
            externalId: teams[a][0],
            name: teams[a][1],
            shortName: teams[a][2],
          },
        });
      }
    }

    return out;
  },

  async fetchStats(externalIds) {
    const rand = rng(externalIds.length * 13 + 5);
    const forms = ["WWDLW", "WDWWL", "LWWDW", "DWLWW", "LDWLL", "WLDLW"];
    return externalIds.map((id) => ({
      fixtureExternalId: id,
      homeForm: forms[Math.floor(rand() * forms.length)],
      awayForm: forms[Math.floor(rand() * forms.length)],
      h2hHomeWins: Math.floor(rand() * 4),
      h2hAwayWins: Math.floor(rand() * 3),
      h2hDraws: Math.floor(rand() * 3),
      h2hAvgGoals: Number((2.1 + rand() * 1.4).toFixed(2)),
      h2hBttsRate: Number((0.4 + rand() * 0.4).toFixed(3)),
      homeSeason: {
        gamesPlayed: 24, wins: 13, draws: 6, losses: 5,
        avgGoalsScored: Number((1.4 + rand()).toFixed(2)),
        avgGoalsConceded: Number((0.8 + rand() * 0.7).toFixed(2)),
        cleanSheetRate: Number((0.25 + rand() * 0.25).toFixed(3)),
        bttsRate: Number((0.45 + rand() * 0.25).toFixed(3)),
      },
      awaySeason: {
        gamesPlayed: 24, wins: 9, draws: 7, losses: 8,
        avgGoalsScored: Number((1.0 + rand()).toFixed(2)),
        avgGoalsConceded: Number((1.1 + rand() * 0.7).toFixed(2)),
        cleanSheetRate: Number((0.15 + rand() * 0.2).toFixed(3)),
        bttsRate: Number((0.5 + rand() * 0.25).toFixed(3)),
      },
    }));
  },

  async fetchResults(externalIds) {
    const rand = rng(externalIds.length + 7);
    return externalIds.map((id) => {
      const hg = Math.floor(rand() * 4);
      const ag = Math.floor(rand() * 3);
      return {
        externalId: id,
        leagueExternalId: 0,
        leagueName: "",
        country: "",
        season: new Date().getUTCFullYear(),
        round: null,
        kickoff: new Date().toISOString(),
        venue: null,
        referee: null,
        status: "finished" as const,
        homeGoals: hg,
        awayGoals: ag,
        htHomeGoals: Math.min(hg, Math.floor(rand() * 2)),
        htAwayGoals: Math.min(ag, Math.floor(rand() * 2)),
        home: { externalId: 0, name: "", shortName: "" },
        away: { externalId: 0, name: "", shortName: "" },
      };
    });
  },
};

const MARKETS: Market[] = [
  "1x2",
  "over_under_2_5",
  "btts",
  "double_chance",
  "over_under_1_5",
  "draw_no_bet",
  "over_under_3_5",
  "handicap",
];

const REASONS = [
  "Home side converts big chances at nearly twice the visitors' rate, and the away back four has conceded from set pieces in four of five. The goal line is the cleaner expression of that edge than the result.",
  "Both sides have gone over this line in four of their last five. Neither keeper is behind a settled defence, and the referee's cards profile suggests the game stays open.",
  "The market has drifted since midweek while the underlying numbers have not moved. We are taking the earlier price on form the closing line has not caught up to.",
  "Away form flatters them — three of four recent wins came against bottom-third opposition. Against this press, expect them to sit deep and concede territory.",
  "Rest advantage decides this one: the visitors played 72 hours ago and travelled over 1,500km. The rest-rule penalty applies, so we have pivoted to the safer market.",
];

const TAGS = [
  "xg-edge",
  "form-divergence",
  "h2h-strong",
  "rest-advantage",
  "market-drift",
  "set-piece-threat",
  "press-mismatch",
];

export const mockAi: AiProvider = {
  async generatePicks({ userPrompt, maxPicks }) {
    // Count the fixtures the prompt described so picks map to real indices.
    const fixtureCount = (userPrompt.match(/^\[\d+\]/gm) ?? []).length || 8;
    const rand = rng(fixtureCount * 31 + new Date().getUTCDate());
    const picks: EnginePick[] = [];

    // Deliberately not one pick per fixture — the engine is supposed to decline
    // fixtures where it has no edge, and the UI should handle that.
    for (let i = 0; i < fixtureCount && picks.length < maxPicks; i++) {
      if (rand() < 0.3) continue;

      const market = MARKETS[Math.floor(rand() * MARKETS.length)];
      const value =
        market === "1x2"
          ? ["1", "X", "2"][Math.floor(rand() * 3)]
          : market === "btts"
            ? ["yes", "no"][Math.floor(rand() * 2)]
            : market === "double_chance"
              ? ["1X", "X2", "12"][Math.floor(rand() * 3)]
              : market === "draw_no_bet"
                ? ["1", "2"][Math.floor(rand() * 2)]
                : market === "handicap"
                  ? ["home -1.5", "away +0.5"][Math.floor(rand() * 2)]
                  : ["over", "under"][Math.floor(rand() * 2)];

      picks.push({
        fixtureIndex: i,
        predictionType: market,
        predictedValue: value,
        confidenceScore: Number((7.4 + rand() * 2.4).toFixed(2)),
        reasoning: REASONS[Math.floor(rand() * REASONS.length)],
        reasoningTags: [
          TAGS[Math.floor(rand() * TAGS.length)],
          TAGS[Math.floor(rand() * TAGS.length)],
        ],
        altMarket: "over_under_1_5",
        altPredictedValue: "over",
        altConfidence: Number((6.8 + rand() * 1.5).toFixed(2)),
        mraSignalHome: ["overperforming", "stable", "regressing"][
          Math.floor(rand() * 3)
        ],
        mraSignalAway: ["overperforming", "stable", "regressing"][
          Math.floor(rand() * 3)
        ],
        filtersApplied: {
          chaosFilter: rand() < 0.2,
          restRule: rand() < 0.15,
          keyMan: rand() < 0.25,
          travel: rand() < 0.1,
          clvDrift: rand() < 0.2,
        },
      });
    }

    return picks;
  },
};

export const mockPayments: PaymentProvider = {
  async initialize({ reference, amountMinor, currency }) {
    return {
      reference,
      accessCode: `mock_access_${reference.slice(-8)}`,
      publicKey: process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY ?? "pk_test_mock",
      amountMinor,
      currency,
    };
  },

  async verify(reference) {
    // Mock payments always succeed. The amount is recovered from the payments
    // row by the caller, which is also what binds the reference to its buyer.
    return {
      status: "success",
      reference,
      amountMinor: 0,
      currency: "GHS",
    };
  },
};

export const mockMessaging: MessagingProvider = {
  async sendEmail({ to, subject }) {
    console.log(`[mock email] to=${to} subject=${subject}`);
  },
  async sendSms({ to, message }) {
    console.log(`[mock sms] to=${to} message=${message.slice(0, 60)}`);
  },
};
