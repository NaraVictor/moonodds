import type { Market } from "@/lib/types";

/**
 * External providers, behind one interface each.
 *
 * Every route handler talks to these, never to a vendor SDK directly. That is
 * what makes MOCK_PROVIDERS=true a single switch rather than a scatter of
 * if-statements, and it's what let this build ship without live keys.
 */

export type RawFixture = {
  externalId: number;
  leagueExternalId: number;
  leagueName: string;
  country: string;
  season: number;
  round: string | null;
  kickoff: string;
  venue: string | null;
  referee: string | null;
  status: "scheduled" | "live" | "finished";
  homeGoals: number | null;
  awayGoals: number | null;
  htHomeGoals: number | null;
  htAwayGoals: number | null;
  home: { externalId: number; name: string; shortName: string };
  away: { externalId: number; name: string; shortName: string };
};

/** Pre-match stats the engine reasons over. */
export type RawFixtureStats = {
  fixtureExternalId: number;
  homeForm: string | null;
  awayForm: string | null;
  h2hHomeWins: number;
  h2hAwayWins: number;
  h2hDraws: number;
  h2hAvgGoals: number;
  h2hBttsRate: number;
  homeSeason: Record<string, number>;
  awaySeason: Record<string, number>;
};

export interface FootballProvider {
  /** Fixtures for a UTC date across the given league external ids. */
  fetchFixtures(date: string, leagueIds: number[]): Promise<RawFixture[]>;
  /** Final scores for fixtures believed to have finished. */
  fetchResults(externalIds: number[]): Promise<RawFixture[]>;
  /** Form, head-to-head and season averages for upcoming fixtures. */
  fetchStats(externalIds: number[]): Promise<RawFixtureStats[]>;
}

/** What the engine is asked to analyse. */
export type FixtureBrief = {
  index: number;
  home: string;
  away: string;
  league: string;
  country: string;
  kickoff: string;
  venue: string;
  stats: string;
};

/** What the engine returns. Shape is enforced by structured outputs. */
export type EnginePick = {
  fixtureIndex: number;
  predictionType: Market;
  predictedValue: string;
  confidenceScore: number;
  reasoning: string;
  reasoningTags: string[];
  altMarket?: Market;
  altPredictedValue?: string;
  altConfidence?: number;
  mraSignalHome?: string;
  mraSignalAway?: string;
  filtersApplied?: Record<string, boolean>;
};

export interface AiProvider {
  generatePicks(input: {
    systemPrompt: string;
    userPrompt: string;
    maxPicks: number;
  }): Promise<EnginePick[]>;
}

export type PaymentInit = {
  reference: string;
  accessCode: string;
  publicKey: string;
  amountMinor: number;
  currency: string;
};

export type PaymentVerification = {
  status: "success" | "failed" | "pending";
  reference: string;
  amountMinor: number;
  currency: string;
};

export interface PaymentProvider {
  initialize(input: {
    email: string;
    amountMinor: number;
    currency: string;
    reference: string;
    metadata: Record<string, unknown>;
  }): Promise<PaymentInit>;
  verify(reference: string): Promise<PaymentVerification>;
}

export interface MessagingProvider {
  sendEmail(input: { to: string; subject: string; html: string }): Promise<void>;
  sendSms(input: { to: string; message: string }): Promise<void>;
}

export type Providers = {
  football: FootballProvider;
  ai: AiProvider;
  payments: PaymentProvider;
  messaging: MessagingProvider;
  /** True when nothing here touches the network. */
  mocked: boolean;
};
