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

/**
 * A prediction as the board sees it.
 *
 * Since the board went public, a row can arrive in one of two shapes. An
 * unlocked pick has everything. A locked one carries the fixture facts and the
 * market, and the AI fields are genuinely absent from the payload — not blanked
 * client-side, not hidden with CSS. `locked` discriminates the two, and the
 * AI fields are optional because for a locked row they do not exist.
 */
export type Pick = {
  id: string;
  locked?: boolean;
  predictionType: Market;
  predictedValue?: string;
  confidenceScore?: number;
  stakingUnit?: number;
  /** Book price where we have one, else a market-shaped estimate. */
  odds?: number;
  reasoning?: string;
  status: PredictionStatus;
  reasoningTags?: string[] | null;
  altMarket?: Market | null;
  altPredictedValue?: string | null;
  altConfidence?: number | null;
  filtersApplied?: Record<string, boolean> | null;
  actualResult?: { homeGoals: number; awayGoals: number } | null;
  settledAt?: string | null;
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
 * A pick with its AI content present.
 *
 * Anything that renders the call, the confidence or the reasoning — the slip,
 * the summary, the Office — operates on this rather than on `Pick`, so the
 * compiler refuses code that would read a field a locked payload never carries.
 * That is the point of the optionality above: it turns "did you handle the
 * locked case?" into a build error instead of a runtime `undefined`.
 */
export type UnlockedPick = Pick & {
  predictedValue: string;
  confidenceScore: number;
  odds: number;
  reasoning: string;
};

export function isUnlocked(p: Pick): p is UnlockedPick {
  return !p.locked && p.predictedValue !== undefined;
}

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
