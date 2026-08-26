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
  /**
   * The match clock, straight from the feed.
   *
   * Never derived from kickoff time. An elapsed minute computed client-side
   * drifts the moment anything interrupts play: it keeps counting through half
   * time, ignores stoppage, and has no way to represent a suspended match. The
   * feed knows all three and reports them.
   *
   * `statusShort` is API-Football's own code (1H, HT, 2H, ET, BT, P, FT…) and
   * is carried unmapped alongside our three-state `status`, because "HT" and
   * "in the 67th minute" are both `live` to us and must not render the same.
   */
  elapsed: number | null;
  /** Stoppage minutes, so 45 + 2 renders as 45+2'. Null outside stoppage. */
  elapsedExtra: number | null;
  statusShort: string | null;
  homeGoals: number | null;
  awayGoals: number | null;
  htHomeGoals: number | null;
  htAwayGoals: number | null;
  home: RawFixtureTeam;
  away: RawFixtureTeam;
};

/** One side's team sheet for a fixture. */
export type RawLineup = {
  fixtureExternalId: number;
  teamExternalId: number;
  formation: string | null;
  coach: string | null;
  startXI: RawLineupPlayer[];
  substitutes: RawLineupPlayer[];
};

export type RawLineupPlayer = {
  externalId: number | null;
  name: string;
  number: number | null;
  /** G, D, M, F — null where the feed does not say. */
  position: string | null;
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

/**
 * One past meeting between two sides, as the engine needs it for Step 1E.
 *
 * The prompt weights meetings by recency and isolates the ones played at this
 * venue, and it says so explicitly: "Aggregate totals are not a meeting list."
 * We were already paying for these, `/fixtures/headtohead` returns every
 * meeting, and then reducing them to five totals before anything saw them.
 */
export type H2HMeeting = {
  date: string;
  /** External id of the side that hosted THIS meeting, not the coming fixture. */
  homeExternalId: number;
  awayExternalId: number;
  homeGoals: number;
  awayGoals: number;
};

/**
 * A team's record split by where it played, for Step 1D.
 *
 * `/teams/statistics` reports every one of these home and away as well as
 * combined; we were reading `.total` and discarding the split. A combined form
 * string is explicitly not a split as far as the prompt is concerned.
 */
export type VenueSplit = {
  gamesPlayed: number;
  wins: number;
  draws: number;
  losses: number;
  avgGoalsScored: number;
  avgGoalsConceded: number;
};

/**
 * A recent fixture for one side, for the Step 5 rest overlay.
 *
 * Sourced from our own `fixtures` table rather than the API. The Free plan
 * refuses the `last` parameter outright, and congestion is a question about
 * dates we already hold once the daily fetch has been running.
 */
export type RecentMatch = {
  date: string;
  opponent: string;
  venue: "home" | "away";
};

/** Pre-match stats the engine reasons over. */
export type RawFixtureStats = {
  fixtureExternalId: number;
  homeForm: string | null;
  awayForm: string | null;
  /**
   * Null means WE HAVE NO HEAD-TO-HEAD, not "they have never beaten each
   * other". These were non-nullable numbers, so a failed or empty upstream call
   * produced 0/0/0 and the engine read it as a real goalless history. The whole
   * [GATED] design of the prompt rests on absent data being absent, so absence
   * has to be representable.
   */
  h2hHomeWins: number | null;
  h2hAwayWins: number | null;
  h2hDraws: number | null;
  h2hAvgGoals: number | null;
  h2hBttsRate: number | null;
  homeSeason: Record<string, number>;
  awaySeason: Record<string, number>;
  /**
   * Last season's averages, fetched ONLY while this season is too short to
   * mean anything. Null once the current season carries enough games.
   *
   * At matchday 2 an average is two matches wide: one 4-0 moves goals-per-game
   * by 2.0, and the engine had no way to see that, because the payload printed
   * "1.50 scored / 2.00 conceded" in exactly the format it prints a settled
   * 38-game record. Last season is a worse answer to "how good are they NOW"
   * and a far better one to "what should we expect from them", and at two games
   * played the second question is the only one with an answer.
   *
   * Not a substitution. Both records reach the prompt, each labelled with the
   * games behind it, because silently swapping in a stale number is the kind of
   * fabrication the whole [GATED] design exists to prevent.
   */
  homeSeasonPrior: Record<string, number> | null;
  awaySeasonPrior: Record<string, number> | null;
  /**
   * Individual meetings, newest first. Empty means we have no meeting list,
   * which gates Step 1E off; the aggregate fields above may still be present,
   * and the prompt falls back to using them unweighted.
   */
  h2hMatches: H2HMeeting[];
  /** Venue-separated records. Null gates Step 1D off. */
  homeSplit: { home: VenueSplit; away: VenueSplit } | null;
  awaySplit: { home: VenueSplit; away: VenueSplit } | null;
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
  /** Team sheets for fixtures near kickoff. Empty until the clubs publish. */
  fetchLineups(externalIds: number[]): Promise<RawLineup[]>;
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

export type PaymentRefund = {
  refunded: boolean;
  amountMinor: number;
  currency: string;
  /** Paystack's own id for the refund, for reconciliation against a statement. */
  providerRef: string | null;
};

export interface PaymentProvider {
  initialize(input: {
    email: string;
    amountMinor: number;
    currency: string;
    reference: string;
    metadata: Record<string, unknown>;
    /** Where the provider sends the customer back to. */
    callbackUrl?: string;
  }): Promise<PaymentInit>;
  verify(reference: string): Promise<PaymentVerification>;
  /**
   * Refund a settled transaction, in full or in part.
   *
   * The Terms promise a refund in two circumstances and there was no code path
   * for either, so every one was a manual dashboard operation with no link back
   * to the payments row.
   */
  refund(input: {
    reference: string;
    amountMinor?: number;
    reason?: string;
  }): Promise<PaymentRefund>;
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
