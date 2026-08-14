/**
 * Domain types.
 *
 * These mirror the jsonb shape returned by the gated RPCs in
 * supabase/migrations/*_rls.sql. When you change app.pick_json(), change this.
 */

export const MARKETS = [
  "1x2",
  "over_under_2_5",
  "over_under_1_5",
  "over_under_3_5",
  "btts",
  "double_chance",
  "handicap",
  "corners_over_under",
  "correct_score",
  "draw_no_bet",
  "first_half_goals",
  "second_half_goals",
] as const;

export type Market = (typeof MARKETS)[number];

export type PredictionStatus =
  | "pending"
  | "won"
  | "lost"
  | "void"
  | "review_needed"
  | "disputed";

export type FixtureStatus = "scheduled" | "live" | "finished";

export type TeamRef = {
  name: string | null;
  shortName: string | null;
  logo: string | null;
};

export type Pick = {
  id: string;
  predictionType: Market;
  predictedValue: string;
  confidenceScore: number;
  stakingUnit: number;
  reasoning: string;
  status: PredictionStatus;
  reasoningTags: string[] | null;
  altMarket: Market | null;
  altPredictedValue: string | null;
  altConfidence: number | null;
  filtersApplied: Record<string, boolean> | null;
  actualResult: { homeGoals: number; awayGoals: number } | null;
  settledAt: string | null;
  fixture: {
    id: string;
    date: string;
    status: FixtureStatus;
    venue: string | null;
    round: string | null;
    homeGoals: number | null;
    awayGoals: number | null;
  };
  homeTeam: TeamRef;
  awayTeam: TeamRef;
  league: { name: string | null; country: string | null; logo: string | null };
};

/**
 * What every pick-returning RPC hands back. `totalCount` always reflects the
 * true total so the paywall can say how many are hidden — while `picks` only
 * ever contains what the caller is allowed to read.
 */
export type GatedPicks = {
  picks: Pick[];
  totalCount: number;
  hasFullAccess: boolean;
  isFirstDay: boolean;
  freePickLimit: number;
};

export type AccessState = {
  hasFullAccess: boolean;
  isFirstDay: boolean;
  freePickLimit: number;
  isSuperAdmin: boolean;
  isSuspended: boolean;
};

export type EngineStats = {
  winRate: number;
  roi: number;
  totalPicks: number;
};

export type StatusCounts = {
  all: number;
  upcoming: number;
  live: number;
  settled: number;
};

export type StatusFilter = "all" | "upcoming" | "live" | "settled";

export type SlipLeg = {
  predictionId: string;
  odds: number;
};

export type LeagueOption = {
  leagueId: string;
  name: string;
  country: string;
  logo: string | null;
  availableGames: number;
};
