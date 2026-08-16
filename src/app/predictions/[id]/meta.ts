import { createServiceClient } from "@/lib/supabase/server";

/**
 * The public facts about a fixture, for metadata and the share card.
 *
 * Read with the service client and then narrowed by hand to the fields that are
 * public on every prediction regardless of access: teams, crests, league,
 * venue, kickoff, and the score once there is one. The market, the selection
 * and the confidence are deliberately not returned, so there is no path from
 * here into a meta tag or an image that gives the call away.
 *
 * Uses the service client rather than the gated RPC because metadata and OG
 * images are generated without a request session: the RPC would see no user,
 * treat the caller as a guest, and withhold fields that are public anyway.
 */
export type PredictionMeta = {
  id: string;
  homeName: string;
  homeShort: string | null;
  homeLogo: string | null;
  awayName: string;
  awayShort: string | null;
  awayLogo: string | null;
  leagueName: string;
  leagueCountry: string | null;
  leagueLogo: string | null;
  venue: string | null;
  kickoff: string;
  status: string;
  fixtureStatus: string;
  homeGoals: number | null;
  awayGoals: number | null;
};

type Row = {
  id: string;
  status: string;
  fixtures: {
    fixture_date: string;
    venue: string | null;
    status: string;
    home_goals: number | null;
    away_goals: number | null;
    home: { name: string; short_name: string | null; logo: string | null } | null;
    away: { name: string; short_name: string | null; logo: string | null } | null;
    leagues: { name: string; country: string | null; logo: string | null } | null;
  } | null;
};

function one<T>(v: T | T[] | null | undefined): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}

export async function fetchPredictionMeta(
  id: string,
): Promise<PredictionMeta | null> {
  // A malformed id would otherwise reach Postgres and throw on the uuid cast,
  // turning a bad link into a 500 during metadata generation.
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;

  try {
    const db = createServiceClient();
    const { data } = await db
      .from("predictions")
      .select(
        `id, status,
         fixtures!inner(
           fixture_date, venue, status, home_goals, away_goals,
           home:teams!fixtures_home_team_id_fkey(name, short_name, logo),
           away:teams!fixtures_away_team_id_fkey(name, short_name, logo),
           leagues(name, country, logo)
         )`,
      )
      .eq("id", id)
      .maybeSingle();

    const row = data as Row | null;
    const f = one(row?.fixtures);
    if (!row || !f) return null;

    const home = one(f.home);
    const away = one(f.away);
    const league = one(f.leagues);

    return {
      id: row.id,
      homeName: home?.name ?? "Home",
      homeShort: home?.short_name ?? null,
      homeLogo: home?.logo ?? null,
      awayName: away?.name ?? "Away",
      awayShort: away?.short_name ?? null,
      awayLogo: away?.logo ?? null,
      leagueName: league?.name ?? "Football",
      leagueCountry: league?.country ?? null,
      leagueLogo: league?.logo ?? null,
      venue: f.venue,
      kickoff: f.fixture_date,
      status: row.status,
      fixtureStatus: f.status,
      homeGoals: f.home_goals,
      awayGoals: f.away_goals,
    };
  } catch (err) {
    console.error("[prediction meta]", err);
    return null;
  }
}

/** "Arsenal v Chelsea prediction" — what someone would actually search for. */
export function fixtureHeadline(m: PredictionMeta): string {
  return `${m.homeName} v ${m.awayName} prediction`;
}

export function kickoffLine(m: PredictionMeta): string {
  return new Date(m.kickoff).toLocaleString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
}
