import type {
  AiProvider,
  EnginePick,
  FootballProvider,
  MessagingProvider,
  PaymentProvider,
  RawFixture,
  RawLeague,
  RawTeam,
} from "./types";
import { leagueBadgeUrl, teamCrestUrl } from "./types";
import type { Market } from "@/lib/types";

/**
 * Canned providers. No network, no keys, no spend.
 *
 * These aren't stubs that return empty arrays, they generate plausible,
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
        const h = Math.floor(rand() * teams.length);
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
          leagueLogo: leagueBadgeUrl(leagueId),
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
            logo: teamCrestUrl(teams[h][0]),
          },
          away: {
            externalId: teams[a][0],
            name: teams[a][1],
            shortName: teams[a][2],
            logo: teamCrestUrl(teams[a][0]),
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
        leagueLogo: null,
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
        home: { externalId: 0, name: "", shortName: "", logo: null },
        away: { externalId: 0, name: "", shortName: "", logo: null },
      };
    });
  },

  async searchLeagues(query) {
    const term = query.trim().toLowerCase();
    return SEARCHABLE_LEAGUES.filter(
      (l) =>
        l.name.toLowerCase().includes(term) ||
        l.country.toLowerCase().includes(term),
    );
  },

  async searchTeams(query) {
    const term = query.trim().toLowerCase();
    return SEARCHABLE_TEAMS.filter((t) => t.name.toLowerCase().includes(term));
  },

  async fetchTeamsByLeague(leagueExternalId) {
    const teams = TEAM_POOL[leagueExternalId];
    if (!teams) return [];
    const country = LEAGUE_META[leagueExternalId]?.country ?? null;
    return teams.map(([externalId, name, shortName]) => ({
      externalId,
      name,
      shortName,
      country,
      logo: null,
      venue: `${name} Stadium`,
    }));
  },
};

/**
 * The searchable catalogue is deliberately wider than the six leagues that
 * generate fixtures: importing a league you already have proves nothing about
 * the import path. The extras carry no team pool, so a mock fixture fetch will
 * return nothing for them, correct behaviour, not a bug.
 */
const SEARCHABLE_LEAGUES: RawLeague[] = [
  ...Object.entries(LEAGUE_META).map(([id, meta]) => ({
    externalId: Number(id),
    name: meta.name,
    type: "League",
    country: meta.country,
    logo: null,
    currentSeason: new Date().getUTCFullYear(),
  })),
  { externalId: 94, name: "Primeira Liga", type: "League", country: "Portugal", logo: null, currentSeason: new Date().getUTCFullYear() },
  { externalId: 203, name: "Süper Lig", type: "League", country: "Turkey", logo: null, currentSeason: new Date().getUTCFullYear() },
  { externalId: 144, name: "Jupiler Pro League", type: "League", country: "Belgium", logo: null, currentSeason: new Date().getUTCFullYear() },
  { externalId: 2, name: "UEFA Champions League", type: "Cup", country: "World", logo: null, currentSeason: new Date().getUTCFullYear() },
  { externalId: 253, name: "Major League Soccer", type: "League", country: "USA", logo: null, currentSeason: new Date().getUTCFullYear() },
];

const SEARCHABLE_TEAMS: RawTeam[] = Object.entries(TEAM_POOL).flatMap(
  ([leagueId, teams]) =>
    teams.map(([externalId, name, shortName]) => ({
      externalId,
      name,
      shortName,
      country: LEAGUE_META[Number(leagueId)]?.country ?? null,
      logo: null,
      venue: `${name} Stadium`,
    })),
);

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
  "Away form flatters them, three of four recent wins came against bottom-third opposition. Against this press, expect them to sit deep and concede territory.",
  "Rest advantage decides this one: the visitors played 72 hours ago and travelled over 1,500km. The rest-rule penalty applies, so we have pivoted to the safer market.",
];

// Drawn from the prompt's tag vocabulary. The old list used slugs the prompt
// never mentions, so the mock exercised a shape the live engine cannot produce.
const TAGS = [
  "Home advantage",
  "Away form",
  "H2H dominance",
  "Defensive matchup",
  "Form streak",
  "Set-piece threat",
  "Thin data",
  "Calibration capped",
];

/** Selections the grader accepts, per market. Mirrors the prompt's value table. */
const VALUES: Record<string, string[]> = {
  "1x2": ["1", "X", "2"],
  double_chance: ["1X", "X2", "12"],
  draw_no_bet: ["1", "2"],
  btts: ["yes", "no"],
  handicap: ["home -1.5", "away +0.5"],
  over_under_1_5: ["over", "under"],
  over_under_2_5: ["over", "under"],
  over_under_3_5: ["over", "under"],
};

const TRAJECTORIES = ["Positive", "Negative", "Neutral"] as const;
const MRA = ["Stable", "Overperforming", "Underperforming"] as const;

export const mockAi: AiProvider = {
  async generatePicks({ userPrompt, maxPicks }) {
    // Count the fixtures the prompt described so picks map to real indices.
    const fixtureCount = (userPrompt.match(/^\[\d+\]/gm) ?? []).length || 8;
    const rand = rng(fixtureCount * 31 + new Date().getUTCDate());
    const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
    const picks: EnginePick[] = [];

    // One object per fixture, matching the prompt: the engine declines by
    // flagging a no-bet zone or scoring low, never by omitting an index.
    for (let i = 0; i < fixtureCount && picks.length < maxPicks; i++) {
      const noBetZone = rand() < 0.08;
      const market = pick(MARKETS);
      const value = pick(VALUES[market] ?? ["over", "under"]);

      // Anchoring bites often on this feed, so the mock exercises the capped
      // path rather than always producing a clean high score.
      const confidenceRaw = Number((5.2 + rand() * 4.3).toFixed(2));
      const capped = confidenceRaw > 7 && rand() < 0.45;
      const confidenceScore = noBetZone
        ? 0
        : Number((capped ? Math.min(confidenceRaw, 6.5) : confidenceRaw).toFixed(2));

      const globalPenaltyRaw = Number((rand() * 45).toFixed(1));
      const globalPenaltyApplied = Math.min(globalPenaltyRaw, 35);

      picks.push({
        fixtureIndex: i,
        predictionType: market,
        predictedValue: value,
        confidenceScore,
        confidenceRaw,
        anchorCapApplied: capped,
        anchorCapReason: capped
          ? "No confirmed lineup and no odds in the payload, anchoring conditions 4 and 6 unmet."
          : null,
        consistencyOverride: false,
        originalPredictedValue: null,
        overrideReason: null,
        stakingUnit: confidenceScore >= 9 ? 5 : confidenceScore >= 8 ? 4 : confidenceScore >= 7 ? 3 : confidenceScore >= 6 ? 2 : 1,
        noBetZone,
        noBetZoneReason: noBetZone ? "Interim manager taking charge for the first time." : null,
        reasoning: pick(REASONS),
        reasoningTags: [pick(TAGS), pick(TAGS)],
        altMarket: "over_under_1_5",
        altPredictedValue: "over",
        altConfidence: Number((5.8 + rand() * 1.5).toFixed(2)),
        mraSignalHome: pick(MRA),
        mraSignalAway: pick(MRA),
        // Only the gates this feed can actually satisfy fire. The personnel and
        // weather flags stay false because the mock stats block carries neither,
        // which is what the live engine should also produce.
        filtersApplied: {
          capitulation_applied: rand() < 0.3,
          recent_h2h_dominance: rand() < 0.25,
          low_sample_warning: rand() < 0.2,
          anchor_cap_applied: capped,
          global_cap_applied: globalPenaltyRaw > 35,
        },
        environmentalLog: {
          windSpeedKmh: null,
          altitudeMetres: null,
          temperatureCelsius: null,
          refereeProfile: "Unknown",
          refAvgYellows: null,
          refAvgFouls: null,
        },
        h2hLog: {
          meetingsAnalysed: Math.floor(rand() * 8),
          weightedScoreHome: null,
          weightedScoreAway: null,
          venueH2HRecord: null,
          recentH2HDominant: null,
          lowSampleWarning: rand() < 0.2,
        },
        formLog: {
          homeFormWindow: "WDLWW",
          awayFormWindow: "LDWLL",
          homeTrajectory: pick(TRAJECTORIES),
          awayTrajectory: pick(TRAJECTORIES),
          homeQualityFormScore: null,
          awayQualityFormScore: null,
        },
        personnelLog: {
          totalAbsencesHome: 0,
          totalAbsencesAway: 0,
          suspendedPlayerTierHome: "None",
          suspendedPlayerTierAway: "None",
          returnFromInjuryHome: false,
          returnFromInjuryAway: false,
          positionalCascadeHome: false,
          positionalCascadeAway: false,
          cascadePositionHome: null,
          cascadePositionAway: null,
          personnelPenaltyRaw: 0,
          personnelPenaltyCapped: false,
        },
        penaltyLog: {
          globalPenaltyRaw,
          globalPenaltyApplied,
          globalPenaltyCapped: globalPenaltyRaw > 35,
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
