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
  leagueLogo: string | null;
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
  home: RawFixtureTeam;
  away: RawFixtureTeam;
};

export type RawFixtureTeam = {
  externalId: number;
  name: string;
  shortName: string;
  logo: string | null;
};

/**
 * Crest and badge URLs.
 *
 * API-Football serves these from a public CDN at a path derived purely from the
 * entity id, no key, no request, no quota. Since our `external_id` columns
 * hold real API-Football ids, we can produce genuine artwork while the rest of
 * the pipeline is still mocked. That matters: the card design leans on crests,
 * and monograms everywhere make a finished layout look unfinished.
 */
export const CREST_BASE = "https://media.api-sports.io/football";

export function teamCrestUrl(externalId: number | null | undefined): string | null {
  return externalId ? `${CREST_BASE}/teams/${externalId}.png` : null;
}

export function leagueBadgeUrl(externalId: number | null | undefined): string | null {
  return externalId ? `${CREST_BASE}/leagues/${externalId}.png` : null;
}

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

/** A league as the upstream catalogue describes it, before we import it. */
export type RawLeague = {
  externalId: number;
  name: string;
  type: string | null;
  country: string;
  logo: string | null;
  currentSeason: number | null;
};

/** A team as the upstream catalogue describes it, before we import it. */
export type RawTeam = {
  externalId: number;
  name: string;
  shortName: string | null;
  country: string | null;
  logo: string | null;
  venue: string | null;
};

export interface FootballProvider {
  /** Fixtures for a UTC date across the given league external ids. */
  fetchFixtures(date: string, leagueIds: number[]): Promise<RawFixture[]>;
  /** Final scores for fixtures believed to have finished. */
  fetchResults(externalIds: number[]): Promise<RawFixture[]>;
  /** Form, head-to-head and season averages for upcoming fixtures. */
  fetchStats(externalIds: number[]): Promise<RawFixtureStats[]>;
  /** Catalogue lookup by name, for adding a league we don't track yet. */
  searchLeagues(query: string): Promise<RawLeague[]>;
  /** Catalogue lookup by name, for adding a team we don't track yet. */
  searchTeams(query: string): Promise<RawTeam[]>;
  /** Every team in a league for a season, bulk import after adding a league. */
  fetchTeamsByLeague(leagueExternalId: number, season: number): Promise<RawTeam[]>;
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

/**
 * What the engine returns.
 *
 * Defined in `@/lib/engine/output` alongside the JSON schema that constrains
 * it, so the type and the schema cannot drift apart. Re-exported here because
 * that is where provider consumers expect to find it.
 */
import type { EnginePick } from "@/lib/engine/output";
export type { EnginePick };

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
