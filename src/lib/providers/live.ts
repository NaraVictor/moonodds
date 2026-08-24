import Anthropic from "@anthropic-ai/sdk";
import type {
  AiProvider,
  EnginePick,
  FootballProvider,
  H2HMeeting,
  MessagingProvider,
  PaymentProvider,
  RawFixture,
  RawFixtureStats,
  RawTeam,
  VenueSplit,
} from "./types";
import { leagueBadgeUrl, teamCrestUrl } from "./types";
import { PICK_SCHEMA } from "@/lib/engine/output";

/* -------------------------------------------------------------------------
 * API-Football
 * ---------------------------------------------------------------------- */

type ApiFixture = {
  fixture: {
    id: number;
    referee: string | null;
    date: string;
    venue: { name: string | null };
    status: { short: string };
  };
  league: {
    id: number;
    name: string;
    country: string;
    season: number;
    round: string;
    logo: string | null;
  };
  teams: {
    home: { id: number; name: string; logo: string | null };
    away: { id: number; name: string; logo: string | null };
  };
  goals: { home: number | null; away: number | null };
  score: { halftime: { home: number | null; away: number | null } };
};

type ApiLeague = {
  league: { id: number; name: string; type: string | null; logo: string | null };
  country: { name: string } | null;
  seasons: Array<{ year: number; current: boolean }>;
};

type ApiTeam = {
  team: {
    id: number;
    name: string;
    code: string | null;
    country: string | null;
    logo: string | null;
  };
  venue?: { name: string | null } | null;
};

const LIVE_CODES = ["1H", "HT", "2H", "ET", "BT", "P", "SUSP", "INT", "LIVE"];
const DONE_CODES = ["FT", "AET", "PEN", "AWD", "WO"];

function mapStatus(code: string): RawFixture["status"] {
  if (LIVE_CODES.includes(code)) return "live";
  if (DONE_CODES.includes(code)) return "finished";
  return "scheduled";
}

function shortName(name: string): string {
  const words = name
    .replace(/\b(FC|CF|SC|AC|AS|SS|US|CD)\b/gi, "")
    .trim()
    .split(/\s+/);
  if (words.length >= 3) return words.slice(0, 3).map((w) => w[0]).join("").toUpperCase();
  if (words.length === 2) return (words[0].slice(0, 2) + words[1][0]).toUpperCase();
  return name.slice(0, 3).toUpperCase();
}

function toRawTeam(t: ApiTeam): RawTeam {
  return {
    externalId: t.team.id,
    name: t.team.name,
    shortName: t.team.code || null,
    country: t.team.country ?? null,
    logo: t.team.logo || null,
    venue: t.venue?.name ?? null,
  };
}

function toRaw(f: ApiFixture): RawFixture {
  return {
    externalId: f.fixture.id,
    leagueExternalId: f.league.id,
    leagueName: f.league.name,
    leagueLogo: f.league.logo ?? leagueBadgeUrl(f.league.id),
    country: f.league.country,
    season: f.league.season,
    round: f.league.round ?? null,
    kickoff: f.fixture.date,
    venue: f.fixture.venue?.name ?? null,
    referee: f.fixture.referee ?? null,
    status: mapStatus(f.fixture.status.short),
    homeGoals: f.goals.home,
    awayGoals: f.goals.away,
    htHomeGoals: f.score?.halftime?.home ?? null,
    htAwayGoals: f.score?.halftime?.away ?? null,
    home: {
      externalId: f.teams.home.id,
      name: f.teams.home.name,
      shortName: shortName(f.teams.home.name),
      logo: f.teams.home.logo ?? teamCrestUrl(f.teams.home.id),
    },
    away: {
      externalId: f.teams.away.id,
      name: f.teams.away.name,
      shortName: shortName(f.teams.away.name),
      logo: f.teams.away.logo ?? teamCrestUrl(f.teams.away.id),
    },
  };
}

/**
 * One transport for every API-Football endpoint.
 *
 * The `errors` check is not decoration: this API answers a bad key, an expired
 * plan or an exhausted quota with **HTTP 200** and an errors object alongside
 * an empty `response`. Trusting `res.ok` alone turns "your key is dead" into
 * "no leagues matched", which is the kind of failure you chase for an hour.
 */
const API_FOOTBALL_TIMEOUT_MS = 15_000;

async function apiFootball<T>(path: string): Promise<T[]> {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) throw new Error("API_FOOTBALL_KEY is not set.");

  const base = process.env.API_FOOTBALL_BASE_URL ?? "https://v3.football.api-sports.io";
  // Bounded, because the callers are not. Cron routes run under
  // maxDuration = 300 and fetch has no default timeout, so a hung upstream is
  // killed by the platform mid-run rather than handled: the pipeline stops
  // wherever it happened to be, having already spent part of a 100-call day.
  // Fifteen seconds is generous for this API and still leaves a 15-fixture run
  // room to finish inside the ceiling.
  const res = await fetch(`${base}${path}`, {
    headers: { "x-apisports-key": key },
    cache: "no-store",
    signal: AbortSignal.timeout(API_FOOTBALL_TIMEOUT_MS),
  });

  if (!res.ok) {
    throw new Error(`API-Football ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const json = (await res.json()) as {
    response: T[];
    errors?: Record<string, string> | unknown[];
  };

  // No errors is `[]`; an actual problem is a keyed object.
  if (json.errors && !Array.isArray(json.errors)) {
    const detail = Object.entries(json.errors)
      .map(([k, v]) => `${k}: ${v}`)
      .join("; ");
    if (detail) throw new Error(`API-Football: ${detail}`);
  }

  return json.response ?? [];
}

/**
 * Season resolution mirrors the Convex original: guess from the calendar, and
 * try the calendar year too, because tournaments and domestic leagues disagree
 * about what "season" means.
 */
function seasonsFor(date: string): number[] {
  const d = new Date(date);
  const year = d.getUTCFullYear();
  const primary = d.getUTCMonth() <= 5 ? year - 1 : year;
  return [...new Set([primary, year])];
}


/* ------------------------- fixture stats helpers ------------------------- */

type ApiH2H = {
  teams: { home: { id: number }; away: { id: number } };
  goals: { home: number | null; away: number | null };
  fixture: { status: { short: string }; date?: string };
};

/**
 * Home/away/total appears on every counter this endpoint returns. We read only
 * `.total` for years; the split halves are what Step 1D is gated on.
 */
type ApiSplit = { home: number; away: number; total: number };
type ApiAvgSplit = { home: string; away: string; total: string };

type ApiTeamStats = {
  form: string | null;
  fixtures: {
    played: ApiSplit;
    wins: ApiSplit;
    draws: ApiSplit;
    loses: ApiSplit;
  };
  goals: {
    for: { total: ApiSplit; average: ApiAvgSplit };
    against: { total: ApiSplit; average: ApiAvgSplit };
  };
  clean_sheet: ApiSplit;
  failed_to_score: ApiSplit;
};

/**
 * Recent meetings between two sides.
 *
 * Only finished fixtures count. An abandoned or postponed match carries null
 * goals, and folding those in as 0-0 would invent draws that never happened.
 */
async function headToHead(homeId: number, awayId: number) {
  let rows: ApiH2H[];
  try {
    // NO `last` PARAMETER. API-Football rejects it on the Free plan with
    // "Free plans do not have access to the Last parameter", returned as
    // HTTP 200 plus an errors object, so the call silently yielded nothing.
    // status=FT filters to finished games upstream, which is what we want
    // anyway, and the ten most recent are taken below.
    rows = await apiFootball<ApiH2H>(
      `/fixtures/headtohead?h2h=${homeId}-${awayId}&status=FT`,
    );
  } catch (err) {
    console.error(`[football] h2h ${homeId}-${awayId}:`, err);
    // Null, not zeros. Zeros are a claim that they have met and never scored.
    return null;
  }

  if (!rows.length) return null;

  // Newest first, then the ten most recent, matching what `last=10` meant.
  const recent = [...rows]
    .sort((a, b) => (b.fixture?.date ?? "").localeCompare(a.fixture?.date ?? ""))
    .slice(0, 10);

  const tallied = tallyH2H(recent, homeId);
  // Nothing finished among them is the same as having no history to read.
  if (tallied.played === 0) return null;

  // The same rows the tally was computed from, kept individually. This costs
  // no extra call: they were fetched, reduced to five numbers, and dropped.
  return { ...tallied, meetings: toMeetings(recent) };
}

/**
 * Meetings the engine can weight, in the order it expects.
 *
 * Only finished meetings with both scores survive, the same filter the tally
 * applies, so the list and the totals can never describe different histories.
 */
export function toMeetings(rows: ApiH2H[]): H2HMeeting[] {
  return rows
    .filter(
      (r) =>
        DONE_CODES.includes(r.fixture?.status?.short ?? "") &&
        r.goals.home != null &&
        r.goals.away != null &&
        r.fixture?.date,
    )
    .map((r) => ({
      date: r.fixture.date as string,
      homeExternalId: r.teams.home.id,
      awayExternalId: r.teams.away.id,
      homeGoals: r.goals.home as number,
      awayGoals: r.goals.away as number,
    }));
}

/**
 * Tally meetings from the perspective of one side.
 *
 * Pure and exported so the attribution can be tested without a network. The
 * subtlety is that the API returns each meeting with its OWN home side, which
 * is not necessarily the home side of the fixture being priced, so a reverse
 * fixture has to be credited by team id rather than by position. Getting that
 * wrong inverts the head-to-head split on exactly half the meetings, and the
 * totals still look plausible.
 */
export function tallyH2H(rows: ApiH2H[], homeId: number) {
  const empty = { homeWins: 0, awayWins: 0, draws: 0, avgGoals: 0, bttsRate: 0, played: 0 };

  const played = rows.filter(
    (r) =>
      DONE_CODES.includes(r.fixture?.status?.short ?? "") &&
      r.goals.home != null &&
      r.goals.away != null,
  );
  if (!played.length) return empty;

  let homeWins = 0;
  let awayWins = 0;
  let draws = 0;
  let goals = 0;
  let btts = 0;

  for (const r of played) {
    const hg = r.goals.home as number;
    const ag = r.goals.away as number;
    goals += hg + ag;
    if (hg > 0 && ag > 0) btts++;

    if (hg === ag) draws++;
    else if ((hg > ag) === (r.teams.home.id === homeId)) homeWins++;
    else awayWins++;
  }

  return {
    homeWins,
    awayWins,
    draws,
    avgGoals: Number((goals / played.length).toFixed(2)),
    bttsRate: Number((btts / played.length).toFixed(3)),
    played: played.length,
  };
}

/**
 * A team's season in one competition, memoised per run.
 *
 * `form` rides along inside the record and is stripped out before the value
 * reaches the engine, because RawFixtureStats keeps form as its own field.
 */
async function teamSeason(
  cache: Map<string, Record<string, number> | null>,
  leagueId: number,
  season: number,
  teamId: number,
): Promise<Record<string, number> | null> {
  const key = `${leagueId}:${season}:${teamId}`;
  if (cache.has(key)) return cache.get(key) ?? null;

  let stats: ApiTeamStats | undefined;
  try {
    // This endpoint answers with a single object rather than an array.
    const rows = await apiFootball<ApiTeamStats>(
      `/teams/statistics?league=${leagueId}&season=${season}&team=${teamId}`,
    );
    stats = Array.isArray(rows) ? rows[0] : (rows as unknown as ApiTeamStats);
  } catch (err) {
    console.error(`[football] team stats ${teamId}:`, err);
  }

  if (!stats?.fixtures) {
    cache.set(key, null);
    return null;
  }

  const played = stats.fixtures.played?.total ?? 0;
  const conceded = stats.goals?.against?.total?.total ?? 0;
  const cleanSheets = stats.clean_sheet?.total ?? 0;
  const failedToScore = stats.failed_to_score?.total ?? 0;

  const record: Record<string, number> = {
    gamesPlayed: played,
    wins: stats.fixtures.wins?.total ?? 0,
    draws: stats.fixtures.draws?.total ?? 0,
    losses: stats.fixtures.loses?.total ?? 0,
    avgGoalsScored: num(stats.goals?.for?.average?.total),
    avgGoalsConceded: num(stats.goals?.against?.average?.total),
    cleanSheetRate: played ? Number((cleanSheets / played).toFixed(3)) : 0,
    // Both teams scored in a game this side played: they scored (did not fail
    // to score) and they conceded at least once. Derived rather than fetched,
    // because the endpoint does not report it and a second call per team to
    // get it would not be worth the quota.
    bttsRate: played
      ? Number((((played - failedToScore) * (conceded > 0 ? 1 : 0)) / played).toFixed(3))
      : 0,
  };

  // Carried through so fetchStats can read it, stripped before it ships.
  (record as unknown as { form: string | null }).form = stats.form ?? null;
  // Same arrangement for the venue split: it rides inside the cached record so
  // the memoised call is still one call, and is lifted out in fetchStats.
  (record as unknown as { split: { home: VenueSplit; away: VenueSplit } }).split =
    venueSplit(stats);

  cache.set(key, record);
  return record;
}

/**
 * The home and away halves of a season record.
 *
 * Averages arrive as strings on this endpoint and the counters as numbers,
 * which is why they go through different readers. A side with no away games
 * yet reports zeros rather than nulls upstream, so `gamesPlayed` is what tells
 * the engine whether the split means anything, and Step 1D checks it.
 */
function venueSplit(stats: ApiTeamStats): { home: VenueSplit; away: VenueSplit } {
  const side = (where: "home" | "away"): VenueSplit => ({
    gamesPlayed: stats.fixtures.played?.[where] ?? 0,
    wins: stats.fixtures.wins?.[where] ?? 0,
    draws: stats.fixtures.draws?.[where] ?? 0,
    losses: stats.fixtures.loses?.[where] ?? 0,
    avgGoalsScored: num(stats.goals?.for?.average?.[where]),
    avgGoalsConceded: num(stats.goals?.against?.average?.[where]),
  });
  return { home: side("home"), away: side("away") };
}

function stripForm(rec: Record<string, number> | null): Record<string, number> {
  if (!rec) return {};
  const out = { ...rec } as Record<string, unknown>;
  // form and split ride along inside the cached record so fetchStats can read
  // them from one call; RawFixtureStats keeps both as their own fields, so
  // neither may also appear here. A stray object in what is typed
  // Record<string, number> reaches the prompt as "[object Object]".
  delete out.form;
  delete out.split;
  return out as Record<string, number>;
}

/** Lift the venue split back out of the cached season record. */
function splitOf(
  rec: Record<string, number> | null,
): { home: VenueSplit; away: VenueSplit } | null {
  const carried = (rec as unknown as { split?: { home: VenueSplit; away: VenueSplit } })?.split;
  return carried ?? null;
}

/** API-Football returns averages as strings like "1.85". */
function num(v: string | number | null | undefined): number {
  const n = typeof v === "string" ? Number.parseFloat(v) : v;
  return Number.isFinite(n) ? Number((n as number).toFixed(2)) : 0;
}

export const liveFootball: FootballProvider = {
  async fetchFixtures(date, leagueIds) {
    const seen = new Set<number>();
    const out: RawFixture[] = [];

    for (const leagueId of leagueIds) {
      for (const season of seasonsFor(date)) {
        try {
          const rows = await apiFootball<ApiFixture>(
            `/fixtures?date=${date}&league=${leagueId}&season=${season}`,
          );
          for (const row of rows) {
            if (seen.has(row.fixture.id)) continue;
            seen.add(row.fixture.id);
            out.push(toRaw(row));
          }
          if (rows.length) break; // right season found
        } catch (err) {
          console.error(`[football] league ${leagueId} season ${season}:`, err);
        }
      }
    }

    return out;
  },

  /**
   * Form, head-to-head and season splits for upcoming fixtures.
   *
   * This threw by design until now, because handing the engine empty stats
   * while its prompt claims to have reasoned over data is worse than a loud
   * failure. It is the feed the whole [CORE] tier of the prompt reads.
   *
   * Three upstream calls per fixture at worst, and the reason for the caches:
   * a matchday has several fixtures in one league, and `/teams/statistics` is
   * keyed on (team, league, season), so without memoising the same team is
   * fetched once per fixture it appears in. API-Football bills per call and the
   * daily budget in ai_engine_config assumes about four per fixture.
   */
  async fetchStats(externalIds) {
    if (!externalIds.length) return [];

    const out: RawFixtureStats[] = [];
    const teamStatsCache = new Map<string, Record<string, number> | null>();

    // The ids alone do not carry team, league or season, so the fixtures come
    // first and everything else keys off them.
    const fixtures: ApiFixture[] = [];
    for (let i = 0; i < externalIds.length; i += 20) {
      const chunk = externalIds.slice(i, i + 20);
      try {
        fixtures.push(...(await apiFootball<ApiFixture>(`/fixtures?ids=${chunk.join("-")}`)));
      } catch (err) {
        console.error("[football] stats: fixture chunk failed:", err);
      }
    }

    for (const f of fixtures) {
      const homeId = f.teams.home.id;
      const awayId = f.teams.away.id;
      const leagueId = f.league.id;
      const season = f.league.season;

      const [h2h, homeSeason, awaySeason] = await Promise.all([
        headToHead(homeId, awayId),
        teamSeason(teamStatsCache, leagueId, season, homeId),
        teamSeason(teamStatsCache, leagueId, season, awayId),
      ]);

      out.push({
        fixtureExternalId: f.fixture.id,
        // Form comes from the season statistics rather than being derived
        // here: API-Football already computes it against the right competition,
        // and a string assembled from recent fixtures would silently mix
        // cup games into a league form line.
        homeForm: (homeSeason?.form as unknown as string) ?? null,
        awayForm: (awaySeason?.form as unknown as string) ?? null,
        h2hHomeWins: h2h?.homeWins ?? null,
        h2hAwayWins: h2h?.awayWins ?? null,
        h2hDraws: h2h?.draws ?? null,
        h2hAvgGoals: h2h?.avgGoals ?? null,
        h2hBttsRate: h2h?.bttsRate ?? null,
        homeSeason: stripForm(homeSeason),
        awaySeason: stripForm(awaySeason),
        // Both of these come out of calls already made above. Step 1D and
        // Step 1E were gated off for want of data we were fetching and
        // throwing away, not for want of a call we could not afford.
        h2hMatches: h2h?.meetings ?? [],
        homeSplit: splitOf(homeSeason),
        awaySplit: splitOf(awaySeason),
      });
    }

    return out;
  },

  async fetchResults(externalIds) {
    if (!externalIds.length) return [];
    const out: RawFixture[] = [];

    // The API caps ids per request; chunk conservatively.
    for (let i = 0; i < externalIds.length; i += 20) {
      const chunk = externalIds.slice(i, i + 20);
      try {
        const rows = await apiFootball<ApiFixture>(`/fixtures?ids=${chunk.join("-")}`);
        out.push(...rows.map(toRaw));
      } catch (err) {
        console.error("[football] results chunk failed:", err);
      }
    }

    return out;
  },

  async searchLeagues(query) {
    const rows = await apiFootball<ApiLeague>(
      `/leagues?search=${encodeURIComponent(query)}`,
    );
    return rows.map((entry) => {
      // Prefer the season the API flags as current; fall back to the newest it
      // knows about, so an off-season competition still imports usefully.
      const current = entry.seasons?.find((s) => s.current);
      const latest = entry.seasons?.[entry.seasons.length - 1];
      return {
        externalId: entry.league.id,
        name: entry.league.name,
        type: entry.league.type ?? null,
        country: entry.country?.name ?? "-",
        logo: entry.league.logo || null,
        currentSeason: current?.year ?? latest?.year ?? null,
      };
    });
  },

  async searchTeams(query) {
    const rows = await apiFootball<ApiTeam>(
      `/teams?search=${encodeURIComponent(query)}`,
    );
    return rows.map(toRawTeam);
  },

  async fetchTeamsByLeague(leagueExternalId, season) {
    const rows = await apiFootball<ApiTeam>(
      `/teams?league=${leagueExternalId}&season=${season}`,
    );
    return rows.map(toRawTeam);
  },
};

/* -------------------------------------------------------------------------
 * Anthropic
 *
 * Three things changed moving off the Hercules OpenAI-compatible gateway:
 *   1. Model ids drop the "anthropic/" prefix, it's `claude-opus-5`.
 *   2. `temperature` is REJECTED on current models. The old code sent 0.25;
 *      steer with the prompt instead.
 *   3. The JSON-coaxing (fence stripping, corrective retry) is replaced by
 *      structured outputs, which removes the failure mode entirely.
 * ---------------------------------------------------------------------- */

/**
 * The engine's confidence occasionally comes back on the wrong scale, 0–1 as
 * a probability, or 0–100 as a percentage. Left alone, a 0.92 silently fails
 * the `>= minConfidence` filter and the pick vanishes, which was the single
 * biggest cause of "no picks generated" in the original app.
 */
export function normaliseConfidence(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  let v = raw;
  if (v <= 1) v *= 10;
  else if (v > 10) v /= 10;
  return Math.min(Math.max(v, 0), 10);
}

/**
 * Inside the 300s route ceiling, with room to fail cleanly rather than vanish.
 *
 * Measured, not guessed: a real run over seven fixtures took 152 seconds end to
 * end. This was 120s, which the first successful run came close enough to that
 * it was luck rather than headroom — a slightly slower day or two more fixtures
 * and the client would have aborted a call that was working.
 *
 * 240s leaves the platform's own 300s limit as the outer bound while still
 * failing as an error we raised. Raising it further is not the answer if runs
 * get longer; fewer fixtures per session is, because the ceiling above is not
 * ours to move.
 */
const ANTHROPIC_TIMEOUT_MS = 240_000;

export const liveAi: AiProvider = {
  async generatePicks({ systemPrompt, userPrompt, maxPicks }) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");

    // The SDK's own default timeout is longer than the function that calls it,
    // so left alone the platform kills the run instead of the client failing
    // cleanly. maxRetries is pinned for the same reason: two silent retries of
    // a slow call is three times the duration budget, spent invisibly.
    const client = new Anthropic({
      apiKey,
      timeout: ANTHROPIC_TIMEOUT_MS,
      maxRetries: 1,
    });

    // Streaming because max_tokens is large; non-streaming risks an HTTP timeout.
    const stream = client.messages.stream({
      model: process.env.ANTHROPIC_MODEL ?? "claude-opus-5",
      max_tokens: 32000,
      system: systemPrompt,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "high",
        format: { type: "json_schema", schema: PICK_SCHEMA },
      },
      messages: [
        {
          role: "user",
          content: `${userPrompt}\n\nReturn exactly ${maxPicks} objects, one per fixture, in index order. Where you hold no edge, say so in the reasoning and score it low; where Step 3 applies, set noBetZone. Do not omit a fixture.`,
        },
      ],
    } as Parameters<typeof client.messages.stream>[0]);

    const message = await stream.finalMessage();

    // Safety classifiers can decline; check before reading content.
    if (message.stop_reason === "refusal") {
      throw new Error("Model declined the request.");
    }

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    const parsed = JSON.parse(text) as { picks: EnginePick[] };

    return (parsed.picks ?? []).map((p) => ({
      ...p,
      confidenceScore: normaliseConfidence(p.confidenceScore),
      altConfidence:
        p.altConfidence != null ? normaliseConfidence(p.altConfidence) : undefined,
    }));
  },
};

/* -------------------------------------------------------------------------
 * Paystack
 * ---------------------------------------------------------------------- */

const PAYSTACK = "https://api.paystack.co";

/**
 * Paystack currency minor units.
 *
 * GHS is quoted in pesewas and NGN in kobo, both 1/100. Paystack rejects a
 * non-integer amount outright rather than rounding, which is why every amount
 * reaching here has already been through usdToPesewas.
 */
const PAYSTACK_TIMEOUT_MS = 20_000;

/**
 * Read the keys, and refuse an obviously wrong pair.
 *
 * The failure this exists for: a live secret alongside a test public key (or
 * the reverse) initialises fine and then fails at the popup with a message that
 * blames the customer's card. Paystack prefixes tell us the mode, so a mismatch
 * is caught here where it can say what is actually wrong.
 */
function paystackKeys(): { secret: string; publicKey: string; live: boolean } {
  const secret = process.env.PAYSTACK_SECRET_KEY;
  const publicKey = process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY;

  if (!secret) throw new Error("PAYSTACK_SECRET_KEY is not set.");
  if (!publicKey) throw new Error("NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY is not set.");

  const secretLive = secret.startsWith("sk_live_");
  const publicLive = publicKey.startsWith("pk_live_");

  if (!secret.startsWith("sk_")) {
    throw new Error("PAYSTACK_SECRET_KEY does not look like a Paystack secret key.");
  }
  if (!publicKey.startsWith("pk_")) {
    throw new Error("NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY does not look like a Paystack public key.");
  }
  if (secretLive !== publicLive) {
    throw new Error(
      `Paystack key mismatch: the secret key is ${secretLive ? "live" : "test"} and the public key is ${publicLive ? "live" : "test"}. Both must be the same mode.`,
    );
  }

  return { secret, publicKey, live: secretLive };
}

/**
 * One call to Paystack.
 *
 * Timed out, because an unbounded fetch here holds a checkout request open for
 * as long as the upstream feels like it. Errors never carry the response body
 * verbatim into a thrown message that might reach a customer, and the key is
 * never logged.
 */
async function paystack<T>(
  path: string,
  init: { method?: string; secret: string; body?: unknown },
): Promise<{ status: boolean; message: string; data?: T }> {
  let res: Response;
  try {
    res = await fetch(`${PAYSTACK}${path}`, {
      method: init.method ?? "GET",
      headers: {
        Authorization: `Bearer ${init.secret}`,
        "Content-Type": "application/json",
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      cache: "no-store",
      signal: AbortSignal.timeout(PAYSTACK_TIMEOUT_MS),
    });
  } catch (err) {
    // A timeout or a network failure is ours, not the customer's. The webhook
    // and the reconcile sweep are what recover a payment that settled anyway.
    console.error(`[paystack] ${path} failed:`, err);
    throw new Error("Could not reach the payment provider. Try again shortly.");
  }

  const json = (await res.json().catch(() => null)) as {
    status: boolean;
    message: string;
    data?: T;
  } | null;

  if (!json) {
    console.error(`[paystack] ${path} returned ${res.status} with an unreadable body`);
    throw new Error("The payment provider returned something unexpected.");
  }

  return json;
}

export const livePayments: PaymentProvider = {
  async initialize({ email, amountMinor, currency, reference, metadata, callbackUrl }) {
    const { secret, publicKey } = paystackKeys();

    const json = await paystack<{ access_code: string; reference: string }>(
      "/transaction/initialize",
      {
        method: "POST",
        secret,
        body: {
          email,
          amount: amountMinor,
          currency,
          reference,
          metadata,
          // Where Paystack returns the customer if they complete on the hosted
          // page rather than in the popup. Without it they land on Paystack's
          // own confirmation and never come back to verify.
          ...(callbackUrl ? { callback_url: callbackUrl } : {}),
          // Ghana's actual payment mix. Mobile money is the majority rail here,
          // so omitting it would exclude most of the market.
          channels: ["card", "mobile_money", "bank_transfer", "ussd"],
        },
      },
    );

    if (!json.status || !json.data) {
      console.error(`[paystack] initialize rejected: ${json.message}`);
      throw new Error(json.message || "Could not start the payment.");
    }

    return {
      reference: json.data.reference,
      accessCode: json.data.access_code,
      publicKey,
      amountMinor,
      currency,
    };
  },

  async verify(reference) {
    const { secret } = paystackKeys();

    const json = await paystack<{
      status: string;
      amount: number;
      currency: string;
      reference: string;
    }>(`/transaction/verify/${encodeURIComponent(reference)}`, { secret });

    if (!json.status || !json.data) {
      console.error(`[paystack] verify rejected for ${reference}: ${json.message}`);
      throw new Error(json.message || "Could not verify the payment.");
    }

    return {
      status:
        json.data.status === "success"
          ? "success"
          : json.data.status === "failed" || json.data.status === "reversed"
            ? "failed"
            : "pending",
      reference: json.data.reference,
      amountMinor: json.data.amount,
      currency: json.data.currency,
    };
  },

  async refund({ reference, amountMinor, reason }) {
    const { secret } = paystackKeys();

    const json = await paystack<{
      id: number;
      amount: number;
      currency: string;
      status: string;
    }>("/refund", {
      method: "POST",
      secret,
      body: {
        transaction: reference,
        // Omitted means the full amount. Paystack treats a partial refund as
        // final for that transaction, so a caller wanting the rest has to say
        // so in one call.
        ...(amountMinor ? { amount: amountMinor } : {}),
        ...(reason ? { merchant_note: reason } : {}),
      },
    });

    if (!json.status || !json.data) {
      console.error(`[paystack] refund rejected for ${reference}: ${json.message}`);
      throw new Error(json.message || "Could not refund that payment.");
    }

    return {
      refunded: json.data.status !== "failed",
      amountMinor: json.data.amount,
      currency: json.data.currency,
      providerRef: json.data.id ? String(json.data.id) : null,
    };
  },
};

export const liveMessaging: MessagingProvider = {
  async sendEmail({ to, subject, html }) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY is not set.");

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM ?? "picks@kicka.app",
        to,
        subject,
        html,
      }),
    });

    if (!res.ok) {
      throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
  },

  /**
   * SMS through mNotify.
   *
   * This was written against Hubtel and read HUBTEL_CLIENT_ID and
   * HUBTEL_CLIENT_SECRET, while the configured credentials were MNOTIFY_KEY
   * and MNOTIFY_SENDER, which nothing in the codebase read. So SMS was
   * configured and unsendable at the same time: every send threw "Hubtel
   * credentials are not set" from a deployment that had perfectly good SMS
   * credentials sitting in its environment.
   *
   * Like API-Football, mNotify answers a rejected message with **HTTP 200**
   * and a status in the body, so `res.ok` is not the check. Codes are strings:
   * 2000 is success, 1005 an invalid recipient, 1006 an unregistered sender id,
   * 1007 insufficient balance. Anything that is not 2000 is a failure and is
   * raised with the code intact, because "SMS did not arrive" and "your sender
   * ID was never approved" need different people to fix them.
   */
  async sendSms({ to, message }) {
    const key = process.env.MNOTIFY_KEY;
    if (!key) throw new Error("MNOTIFY_KEY is not set.");

    const res = await fetch(
      `https://api.mnotify.com/api/sms/quick?key=${encodeURIComponent(key)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // The API takes a list even for one number.
          recipient: [to],
          sender: process.env.MNOTIFY_SENDER ?? "Kicka",
          message,
          is_schedule: false,
          schedule_date: "",
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );

    if (!res.ok) {
      throw new Error(`mNotify ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }

    const json = (await res.json().catch(() => null)) as
      | { status?: string; code?: string; message?: string }
      | null;

    // A body we cannot parse is not a success. Treating it as one is how a
    // provider change turns into "nobody got their alerts" with a clean log.
    if (!json) throw new Error("mNotify: unreadable response body");

    if (String(json.code) !== "2000" && json.status !== "success") {
      throw new Error(
        `mNotify rejected the message (code ${json.code ?? "none"}): ${json.message ?? json.status ?? "no detail"}`,
      );
    }
  },
};
