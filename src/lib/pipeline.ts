import { createServiceClient } from "./supabase/server";
import { getProviders } from "./providers";
import type { Market } from "./types";
import type { H2HMeeting, RecentMatch, VenueSplit } from "./providers/types";
import { renderPrompt } from "./engine/template";
import { resolveEngineVariables } from "./engine/variables";
import { blankToNull, normalisePredictedValue } from "./engine/output";
import { ENGINE_CALL_BUDGET_MS, THIN_SEASON_GAMES, sessionCap } from "./engine/limits";
import { ENGINE_PROMPT_VERSION } from "./engine/prompt";
import { reportError } from "./report-error";
import { SITE_URL } from "./site-url";
import { utcDayWindow } from "./format";

/**
 * The daily pipeline, ported from convex/cron_jobs and convex/football.
 *
 * Everything here runs with the service role because it writes rows no user is
 * authorised to write. None of it is reachable from the browser, the routes
 * that call it are behind the cron bearer secret.
 */

type Outcome = "won" | "lost" | "void" | "review_needed";

/**
 * Grade a settled prediction.
 *
 * DELIBERATE DEVIATION from the Convex original: that version returned `false`
 * for markets it couldn't evaluate, so corners and half-goals picks were all
 * written as LOSSES, despite the code comments saying they should be marked
 * for review. Draws on draw-no-bet were graded as losses too, when they should
 * void and refund.
 *
 * Here: half-time markets are graded properly (we store ht_home_goals /
 * ht_away_goals), draw-no-bet voids on a draw, and genuinely ungradeable
 * markets return review_needed rather than quietly costing someone a win.
 */
export function gradePrediction(
  market: Market,
  value: string,
  hg: number,
  ag: number,
  htHg: number | null,
  htAg: number | null,
): Outcome {
  const total = hg + ag;
  const v = value.toLowerCase();
  const ou = (line: number, sum: number): Outcome =>
    v === "over" ? (sum > line ? "won" : "lost") : sum < line ? "won" : "lost";

  switch (market) {
    case "1x2":
      if (v === "1") return hg > ag ? "won" : "lost";
      if (v === "x") return hg === ag ? "won" : "lost";
      if (v === "2") return ag > hg ? "won" : "lost";
      return "review_needed";

    case "over_under_1_5":
      return ou(1.5, total);
    case "over_under_2_5":
      return ou(2.5, total);
    case "over_under_3_5":
      return ou(3.5, total);

    case "btts": {
      const both = hg > 0 && ag > 0;
      return v === "yes" ? (both ? "won" : "lost") : both ? "lost" : "won";
    }

    case "double_chance":
      if (value === "1X") return hg >= ag ? "won" : "lost";
      if (value === "X2") return ag >= hg ? "won" : "lost";
      if (value === "12") return hg !== ag ? "won" : "lost";
      return "review_needed";

    case "draw_no_bet":
      // A draw refunds the stake, it is not a loss.
      if (hg === ag) return "void";
      if (v === "1") return hg > ag ? "won" : "lost";
      if (v === "2") return ag > hg ? "won" : "lost";
      return "review_needed";

    case "handicap": {
      const [side, lineRaw] = value.split(" ");
      const line = Number.parseFloat(lineRaw);
      if (!Number.isFinite(line)) return "review_needed";
      const margin = side === "home" ? hg - ag : ag - hg;
      const adjusted = margin + line;
      if (adjusted === 0) return "void";
      return adjusted > 0 ? "won" : "lost";
    }

    case "correct_score": {
      const [eh, ea] = value.split("-").map(Number);
      if (!Number.isFinite(eh) || !Number.isFinite(ea)) return "review_needed";
      return hg === eh && ag === ea ? "won" : "lost";
    }

    case "first_half_goals":
      if (htHg == null || htAg == null) return "review_needed";
      return ou(0.5, htHg + htAg);

    case "second_half_goals":
      if (htHg == null || htAg == null) return "review_needed";
      return ou(0.5, total - (htHg + htAg));

    case "corners_over_under":
      // Corner counts need a separate API call we don't make. Flag, don't guess.
      return "review_needed";

    default:
      return "review_needed";
  }
}

/**
 * Pull fixtures for a date and upsert leagues, teams and fixtures.
 *
 * `withStats` chains the stats pull onto the same pass. It is off by default
 * and ON from the Office, and the asymmetry is deliberate: the scheduled jobs
 * stage these apart on purpose, fixtures at 00:30 and stats at 05:00, so the
 * 36-hour stats window is centred on the day the engine runs at 05:00. An
 * operator pulling fixtures by hand has no second job coming to enrich them,
 * so for them a fixture pull that leaves the engine with nothing but team
 * names is a pull that did half a job.
 */
export async function runFetchFixtures(
  date: string,
  { withStats = false, maxFixtures }: { withStats?: boolean; maxFixtures?: number } = {},
) {
  const db = createServiceClient();
  const { football } = getProviders();

  const { data: config } = await db
    .from("ai_engine_config")
    .select("selected_league_ids")
    .eq("status", "active")
    .maybeSingle();

  const leagueIds: number[] = config?.selected_league_ids?.length
    ? config.selected_league_ids
    : [39, 140, 135, 78, 61, 88];

  const raw = await football.fetchFixtures(date, leagueIds);
  let inserted = 0;

  for (const f of raw) {
    const { data: league } = await db
      .from("leagues")
      .upsert(
        {
          external_id: f.leagueExternalId,
          name: f.leagueName,
          slug: slugify(f.leagueName),
          country: f.country,
          season: f.season,
          logo: f.leagueLogo,
          is_active: true,
        },
        { onConflict: "external_id" },
      )
      .select("id")
      .single();

    if (!league) continue;

    const teamIds: Record<"home" | "away", string | null> = { home: null, away: null };
    for (const side of ["home", "away"] as const) {
      const t = f[side];
      const { data: team } = await db
        .from("teams")
        .upsert(
          {
            external_id: t.externalId,
            league_id: league.id,
            name: t.name,
            short_name: t.shortName,
            slug: slugify(t.name),
            logo: t.logo,
          },
          { onConflict: "external_id" },
        )
        .select("id")
        .single();
      teamIds[side] = team?.id ?? null;
    }

    if (!teamIds.home || !teamIds.away) continue;

    const { error } = await db.from("fixtures").upsert(
      {
        external_id: f.externalId,
        league_id: league.id,
        home_team_id: teamIds.home,
        away_team_id: teamIds.away,
        slug: `${slugify(f.home.name)}-v-${slugify(f.away.name)}-${f.externalId}`,
        fixture_date: f.kickoff,
        status: f.status,
        venue: f.venue,
        referee: f.referee,
        round: f.round,
        home_goals: f.homeGoals,
        away_goals: f.awayGoals,
        ht_home_goals: f.htHomeGoals,
        ht_away_goals: f.htAwayGoals,
        // The clock too, from the same response that carries the status.
        //
        // This is the second writer of these columns and it was writing only
        // some of them: on the 00:30 schedule that is invisible, because
        // nothing has kicked off. Run by hand from the Office mid-afternoon —
        // which "Fetch & generate" does — it overwrote a live fixture's status
        // and score while leaving the minute at whatever the poller last set,
        // so a card could show a fresh score against a stale clock.
        elapsed_minutes: f.elapsed,
        elapsed_extra: f.elapsedExtra,
        status_short: f.statusShort,
      },
      { onConflict: "external_id" },
    );

    if (!error) inserted++;
  }

  const result = {
    date,
    leagues: leagueIds.length,
    fixtures: raw.length,
    upserted: inserted,
  };

  if (!withStats) return result;

  // Nested rather than merged, so `describeStage` can tell "no stats fetched"
  // apart from "stats were never asked for" — the second is not a failure.
  return { ...result, stats: await runFetchStats({ maxFixtures }) };
}

/**
 * Fetch pre-match stats for upcoming fixtures.
 *
 * This is the feed the engine actually reasons over. Without it the prompt
 * carries fixture names and nothing else, and every "based on the numbers"
 * claim in the product is hollow.
 */
export async function runFetchStats({ maxFixtures }: { maxFixtures?: number } = {}) {
  const db = createServiceClient();
  const { football } = getProviders();

  const { data: config } = await db
    .from("ai_engine_config")
    .select("api_budget")
    .eq("status", "active")
    .maybeSingle();

  // This used to take a flat 60 while runDailyPicks only ever reasons over
  // maxFixturesPerSession (30 by default), so up to half the daily API budget
  // bought stats for fixtures that never got a prediction. On a plan with a
  // 100-call ceiling and roughly four calls per fixture, that overspend is the
  // difference between covering the day and running dry before grading.
  //
  // Two limits, whichever binds first: the session cap, and what the daily
  // budget can actually pay for once results are reserved.
  const budget = config?.api_budget ?? {};
  const perSession = sessionCap(budget, maxFixtures);
  const perFixture = Math.max(1, budget.callsPerFixtureEstimate ?? 4);
  const spendable = (budget.dailyTotal ?? 500) - (budget.reservedForResults ?? 100);
  const affordable = Math.max(0, Math.floor(spendable / perFixture));
  const limit = Math.min(perSession, affordable);

  if (limit === 0) {
    return {
      fetched: 0,
      upserted: 0,
      skipped: `api_budget leaves nothing for stats (${spendable} calls spendable at ~${perFixture} per fixture)`,
    };
  }

  const now = new Date();
  const horizon = new Date(now.getTime() + 36 * 3600 * 1000);

  const { data: fixtures } = await db
    .from("fixtures")
    .select("id, external_id")
    .eq("status", "scheduled")
    .gte("fixture_date", now.toISOString())
    .lt("fixture_date", horizon.toISOString())
    .not("external_id", "is", null)
    .order("fixture_date")
    .limit(limit);

  if (!fixtures?.length) return { fetched: 0, upserted: 0 };

  const byExternal = new Map(fixtures.map((f) => [f.external_id as number, f.id]));
  const stats = await football.fetchStats([...byExternal.keys()]);

  // Congestion comes from fixtures we already hold, not from the API. The Free
  // plan refuses `last` outright, and this is a question about dates the daily
  // fetch has been recording anyway, so it costs a query rather than a call.
  const congestion = await recentMatchesFor([...byExternal.values()], db);

  let upserted = 0;
  for (const s of stats) {
    const fixtureId = byExternal.get(s.fixtureExternalId);
    if (!fixtureId) continue;

    const recent = congestion.get(fixtureId);

    const { error } = await db.from("fixture_stats").upsert(
      {
        fixture_id: fixtureId,
        fixture_external_id: s.fixtureExternalId,
        fetched_at: new Date().toISOString(),
        home_form: s.homeForm,
        away_form: s.awayForm,
        h2h_home_wins: s.h2hHomeWins,
        h2h_away_wins: s.h2hAwayWins,
        h2h_draws: s.h2hDraws,
        h2h_avg_goals: s.h2hAvgGoals,
        h2h_btts_rate: s.h2hBttsRate,
        home_season: s.homeSeason,
        away_season: s.awaySeason,
        // Null for most of the season. Written on every upsert rather than
        // conditionally, so a side that crosses the thin-season line has its
        // stale prior CLEARED rather than left behind to be read as current.
        home_season_prior: s.homeSeasonPrior,
        away_season_prior: s.awaySeasonPrior,
        h2h_matches: s.h2hMatches,
        home_split: s.homeSplit ?? {},
        away_split: s.awaySplit ?? {},
        home_recent_matches: recent?.home ?? [],
        away_recent_matches: recent?.away ?? [],
      },
      { onConflict: "fixture_id" },
    );
    if (!error) upserted++;
  }

  return {
    fetched: stats.length,
    upserted,
    requested: fixtures.length,
    limit,
    // Named so the Office can say WHICH bound applied. An override that the
    // budget quietly ignored looks identical to one that was honoured.
    boundBy: affordable < perSession ? ("budget" as const) : ("session" as const),
  };
}

/**
 * Each side's recent finished fixtures, for the Step 5 rest overlay.
 *
 * Read out of our own `fixtures` table. That has one consequence worth stating:
 * we only see matches in the leagues we track, so a midweek cup tie is
 * invisible and a congested side can read as rested. The overlay is gated on
 * the count, and understating congestion skips the penalty rather than
 * inventing one, which is the safe direction. It is also why the brief labels
 * this "league matches only" rather than letting the engine read it as a
 * complete schedule.
 */
async function recentMatchesFor(
  fixtureIds: string[],
  db: ReturnType<typeof createServiceClient>,
): Promise<Map<string, { home: RecentMatch[]; away: RecentMatch[] }>> {
  const out = new Map<string, { home: RecentMatch[]; away: RecentMatch[] }>();
  if (!fixtureIds.length) return out;

  const { data: targets } = await db
    .from("fixtures")
    .select("id, fixture_date, home_team_id, away_team_id")
    .in("id", fixtureIds);
  if (!targets?.length) return out;

  const teamIds = [
    ...new Set(targets.flatMap((f) => [f.home_team_id, f.away_team_id])),
  ].filter(Boolean) as string[];

  // The window is the one the rest overlay asks about, widened enough that a
  // side playing every three days still shows all of it.
  const earliest = new Date(
    Math.min(...targets.map((f) => new Date(f.fixture_date as string).getTime())) -
      21 * 86400_000,
  ).toISOString();

  // Two .in() queries rather than one interpolated .or(). The values here are
  // UUIDs read from our own fixtures table so the string form was safe, but
  // building a PostgREST filter by concatenation is a pattern that only stays
  // safe while nobody points it at user input, and .in() is parameterised.
  const columns =
    "id, fixture_date, home_team_id, away_team_id, home:teams!fixtures_home_team_id_fkey(name), away:teams!fixtures_away_team_id_fkey(name)";

  const [asHome, asAway] = await Promise.all([
    db.from("fixtures").select(columns)
      .eq("status", "finished").gte("fixture_date", earliest)
      .in("home_team_id", teamIds)
      .order("fixture_date", { ascending: false }),
    db.from("fixtures").select(columns)
      .eq("status", "finished").gte("fixture_date", earliest)
      .in("away_team_id", teamIds)
      .order("fixture_date", { ascending: false }),
  ]);

  // A fixture where both sides are in the batch comes back from both queries.
  const seen = new Set<string>();
  const history = [...(asHome.data ?? []), ...(asAway.data ?? [])]
    .filter((h) => {
      const id = h.id as string;
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .sort((a, b) =>
      String(b.fixture_date).localeCompare(String(a.fixture_date)),
    );

  const byTeam = new Map<string, RecentMatch[]>();
  for (const h of history ?? []) {
    for (const side of ["home", "away"] as const) {
      const teamId = (side === "home" ? h.home_team_id : h.away_team_id) as string;
      if (!teamId) continue;
      const opponent =
        side === "home" ? asOne(h.away)?.name : asOne(h.home)?.name;
      const list = byTeam.get(teamId) ?? [];
      if (list.length < 6) {
        list.push({
          date: h.fixture_date as string,
          opponent: opponent ?? "Unknown",
          venue: side,
        });
      }
      byTeam.set(teamId, list);
    }
  }

  for (const f of targets) {
    const kickoff = new Date(f.fixture_date as string).getTime();
    // Only matches BEFORE this fixture count as congestion for it.
    const before = (list: RecentMatch[]) =>
      list.filter((m) => new Date(m.date).getTime() < kickoff);
    out.set(f.id as string, {
      home: before(byTeam.get(f.home_team_id as string) ?? []),
      away: before(byTeam.get(f.away_team_id as string) ?? []),
    });
  }

  return out;
}

/**
 * Format one fixture's stats for the prompt.
 *
 * Form order is stated explicitly. The prompt reads trajectory off the last
 * three characters, so an unlabelled string that happens to run newest-first
 * would invert every trajectory silently, right shape, wrong answer, no error.
 */
export function statsBlock(
  s: Record<string, unknown> | null | undefined,
  homeExternalId: number | null,
): string {
  if (!s) {
    return "    (no stats for this fixture, reason from league and venue only, and lower confidence accordingly)";
  }
  const home = (s.home_season ?? {}) as Record<string, number>;
  const away = (s.away_season ?? {}) as Record<string, number>;

  const lines = [
    `    Form (oldest result first, rightmost is most recent): home ${s.home_form ?? "?"} | away ${s.away_form ?? "?"}`,
    // Absent H2H is stated as absent. Rendering nulls as 0 would tell the
    // engine these sides have met and never scored, which is a claim, not a gap.
    s.h2h_home_wins == null
      ? "    H2H: none available for this pairing"
      : `    H2H totals: ${s.h2h_home_wins} home wins, ${s.h2h_draws ?? 0} draws, ${s.h2h_away_wins ?? 0} away wins; avg ${s.h2h_avg_goals ?? "?"} goals, both scored ${s.h2h_btts_rate ?? "?"}`,
    /*
     * Each side's season, with last season directly beneath it where this one
     * is too short to mean anything.
     *
     * Interleaved rather than grouped into a block of priors at the end, so the
     * model meets the thin number and the record that explains it together. Six
     * lines apart they read as two unrelated facts, and the whole point is that
     * one qualifies the other.
     */
    ...seasonLines("Home", home, s.home_season_prior),
    ...seasonLines("Away", away, s.away_season_prior),
  ];

  const meetings = (s.h2h_matches ?? []) as H2HMeeting[];
  if (meetings.length && homeExternalId) {
    lines.push(`    ${formatMeetings(meetings, homeExternalId)}`);
  }

  for (const [label, raw] of [
    ["Home side", s.home_split],
    ["Away side", s.away_split],
  ] as const) {
    const line = formatSplit(raw);
    if (line) lines.push(`    ${label} by venue: ${line}`);
  }

  for (const [label, raw] of [
    ["Home side", s.home_recent_matches],
    ["Away side", s.away_recent_matches],
  ] as const) {
    const line = formatCongestion(raw);
    if (line) lines.push(`    ${label} recent schedule: ${line}`);
  }

  /*
   * Absences, and ONLY when there are some.
   *
   * This is the guard, and it is deliberately asymmetric. An empty list is not
   * printed as "no absences", and not printed at all — because the feed returns
   * nothing both for a squad with a clean bill of health and for a fixture it
   * has not populated yet, and there is no way to tell those apart from here.
   *
   * Printing "no absences" would resolve that ambiguity in the dangerous
   * direction: it would satisfy STEP 6, clear the personnel flags, and satisfy
   * the anchoring condition "no Tier 1 or Tier 2 absence" — handing a fixture a
   * higher ceiling on the strength of a feed that had not loaded. A side with
   * three defenders out would score as clean.
   *
   * So silence means absent, the [GATED] step skips exactly as it does today,
   * and the only thing that can move a number is a name.
   */
  for (const [label, raw] of [
    ["Home", s.home_absences],
    ["Away", s.away_absences],
  ] as const) {
    const line = formatAbsences(raw);
    if (line) lines.push(`    ${label} absences: ${line}`);
  }

  return lines.join("\n");
}

/**
 * The feeds no fixture in this batch carries, as a sentence for the prompt.
 *
 * Everything the payload can never supply is listed unconditionally, because
 * no plan or code path here produces it. The rest is checked against the batch,
 * so a feed that starts arriving stops being declared absent on the same run
 * it starts arriving, with nothing to remember to edit.
 */
export function batchAbsentFeeds(rows: Array<Record<string, unknown>>): string {
  const has = (test: (r: Record<string, unknown>) => boolean) => rows.some(test);

  const conditional: Array<[string, boolean]> = [
    // Present only where a NAME came back. A fetch that returned nothing counts
    // as absent here for the same reason statsBlock prints nothing for it: an
    // empty list cannot be told from an unloaded one, and declaring the feed
    // present would invite the model to read silence as a fit squad.
    ["injuries and suspensions", has((r) => ((r.home_absences ?? []) as unknown[]).length > 0 || ((r.away_absences ?? []) as unknown[]).length > 0)],
    ["individual head-to-head meetings", has((r) => ((r.h2h_matches ?? []) as unknown[]).length > 0)],
    ["venue-separated form", has((r) => Object.keys((r.home_split ?? {}) as object).length > 0)],
    [
      "fixture congestion",
      has((r) => ((r.home_recent_matches ?? []) as unknown[]).length > 0),
    ],
  ];

  // Nothing in this build fetches these. They are named so the engine knows
  // they are absent by design rather than missing by accident.
  const never = [
    // Line-ups stay here permanently, and not for want of a feed: they are
    // fetched now, but they publish about forty minutes before kickoff and
    // daily-picks runs at 05:00. Thirteen hours too late to inform a prediction.
    "lineups",
    "odds and market movement",
    "league standings",
    "weather",
    "travel distance",
    "pitch surface",
    "referee history",
  ];

  const missing = [...never, ...conditional.filter(([, present]) => !present).map(([name]) => name)];

  if (!missing.length) {
    return "Every gated input this build supplies is printed beneath the fixtures; anything not printed there is absent, so the steps that depend on it must be skipped rather than estimated.";
  }

  return `The following are absent for every fixture in this batch: ${missing.join(", ")}. The steps that depend on them must be skipped rather than estimated.`;
}

/**
 * Meetings normalised to the coming fixture's home side.
 *
 * Every score is written home-side-first regardless of who hosted that
 * meeting, and the venue flag says who did. The alternative, printing each
 * meeting as the API reports it, hands the engine the exact attribution
 * problem `tallyH2H` exists to solve, on half the rows, with no error if it
 * gets it wrong.
 */
function formatMeetings(meetings: H2HMeeting[], homeExternalId: number): string {
  const rendered = meetings.slice(0, 10).map((m) => {
    const hosted = m.homeExternalId === homeExternalId;
    const [hg, ag] = hosted
      ? [m.homeGoals, m.awayGoals]
      : [m.awayGoals, m.homeGoals];
    return `${m.date.slice(0, 10)} ${hosted ? "H" : "A"} ${hg}-${ag}`;
  });
  return `H2H meetings (newest first; scores are home-side-first, H = played at the home side's ground): ${rendered.join(" | ")}`;
}

/** One side's home and away records, or nothing if the split is empty. */
/**
 * A season line that says how much season is behind it.
 *
 * `gamesPlayed` was fetched, stored and then dropped on the floor here. Without
 * it "1.50 scored / 2.00 conceded" is unreadable: it is the same sentence
 * whether it rests on two matches or thirty-eight, and Step 1 treats it as the
 * primary quantitative signal either way.
 */
function seasonLines(
  label: string,
  rec: Record<string, number>,
  rawPrior: unknown,
): string[] {
  const played = rec.gamesPlayed;

  /*
   * Nobody has an average over zero games.
   *
   * The upstream endpoint answers a side that has not kicked a ball with zeros
   * rather than nulls, and this printed them: "0 scored / 0 conceded per game,
   * clean sheets 0, both scored 0". Every one of those is a CLAIM — that they
   * score nothing, concede nothing and keep no clean sheets — and the engine
   * read them as its primary quantitative signal. On the opening weekend of
   * four leagues at once that was most of the board.
   *
   * The H2H line two rows up has said "none available for this pairing" rather
   * than 0-0-0 since the day it was written, for exactly this reason. This is
   * the same bug in the same function, on the field the prompt leans on hardest.
   */
  const lines =
    played === 0
      ? [`    ${label} season: no matches played yet this season`]
      : [
          `    ${label} season${played == null ? "" : ` (${played} played${played < THIN_SEASON_GAMES ? ", THIN" : ""})`}: ` +
            `${rec.avgGoalsScored ?? "?"} scored / ${rec.avgGoalsConceded ?? "?"} conceded per game, ` +
            `clean sheets ${rec.cleanSheetRate ?? "?"}, both scored ${rec.bttsRate ?? "?"}`,
        ];

  const prior = priorLine(label, rec, (rawPrior ?? null) as Record<string, number> | null);
  if (prior) return [...lines, prior];

  // No current season and no prior is the genuinely unknown case — a promoted
  // side, or one we have only just started tracking. Saying so beats leaving a
  // bare "no matches played yet", which reads as a gap someone will fill later.
  if (played === 0) {
    lines.push(`    ${label} has no record here last season either, treat as unknown`);
  }
  return lines;
}

/**
 * The fallback line, or nothing.
 *
 * Suppressed once the current season stands on its own, because a prior record
 * shown next to a healthy one is an invitation to average two things that
 * should not be averaged. It is a fallback, not a second opinion.
 */
function priorLine(
  label: string,
  current: Record<string, number>,
  prior: Record<string, number> | null,
): string | null {
  if (!prior || !prior.gamesPlayed) return null;
  if ((current.gamesPlayed ?? 0) >= THIN_SEASON_GAMES) return null;
  return (
    `    ${label} LAST season (${prior.gamesPlayed} played, use where this ` +
    `season is too short): ${prior.avgGoalsScored ?? "?"} scored / ` +
    `${prior.avgGoalsConceded ?? "?"} conceded per game, clean sheets ` +
    `${prior.cleanSheetRate ?? "?"}, both scored ${prior.bttsRate ?? "?"}`
  );
}

/**
 * The absence list, or nothing at all.
 *
 * Returns null for null, for a non-array, and for an empty array — all three
 * are "we have no information", and none of them is "everybody is fit". The
 * caller prints nothing on null, which leaves STEP 6 gated.
 *
 * Capped at eight names per side. Beyond that the list stops being a personnel
 * note and starts being most of the prompt, and the step it feeds cares about
 * tiers and totals rather than about the ninth name.
 */
function formatAbsences(raw: unknown): string | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;

  const named = raw
    .map((r) => {
      const p = r as { name?: string; reason?: string | null; kind?: string | null };
      if (!p?.name) return null;
      const why = p.reason || p.kind;
      return why ? `${p.name} (${why})` : p.name;
    })
    .filter((v): v is string => Boolean(v));

  if (!named.length) return null;

  const shown = named.slice(0, 8);
  const rest = named.length - shown.length;
  return `${named.length} reported out — ${shown.join(", ")}${rest > 0 ? `, and ${rest} more` : ""}`;
}

function formatSplit(raw: unknown): string | null {
  const split = raw as { home?: VenueSplit; away?: VenueSplit } | null;
  if (!split?.home || !split?.away) return null;
  if (!split.home.gamesPlayed && !split.away.gamesPlayed) return null;
  const side = (v: VenueSplit) =>
    `${v.wins}W-${v.draws}D-${v.losses}L in ${v.gamesPlayed}, ${v.avgGoalsScored} scored / ${v.avgGoalsConceded} conceded`;
  return `at home ${side(split.home)}; away ${side(split.away)}`;
}

/**
 * Recent match dates, labelled for what they are.
 *
 * "League matches only" is not a hedge, it is the accurate description: this
 * comes from fixtures we track, so cup and international games are missing.
 * Saying so is what stops the engine reading a gap as a rested side.
 */
function formatCongestion(raw: unknown): string | null {
  const matches = (raw ?? []) as RecentMatch[];
  if (!matches.length) return null;
  const rendered = matches
    .slice(0, 5)
    .map((m) => `${m.date.slice(0, 10)} ${m.venue === "home" ? "vs" : "at"} ${m.opponent}`);
  return `${rendered.join(" | ")} (league matches only, cup and international games not included)`;
}

/** Generate today's picks with the active engine config. */
export async function runDailyPicks({ maxFixtures }: { maxFixtures?: number } = {}) {
  const startedAt = Date.now();
  const db = createServiceClient();
  const { ai } = getProviders();

  const { data: config } = await db
    .from("ai_engine_config")
    .select("*")
    .eq("status", "active")
    .maybeSingle();

  if (!config) return { skipped: "no active engine config" };

  const now = new Date();
  const endOfDay = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1),
  );

  const { data: fixtures } = await db
    .from("fixtures")
    .select("id, fixture_date, venue, leagues(name, country), home:teams!fixtures_home_team_id_fkey(name, external_id), away:teams!fixtures_away_team_id_fkey(name)")
    .eq("status", "scheduled")
    .gte("fixture_date", now.toISOString())
    .lt("fixture_date", endOfDay.toISOString())
    .order("fixture_date")
    .limit(sessionCap(config.api_budget, maxFixtures));

  if (!fixtures?.length) return { skipped: "no upcoming fixtures today" };

  // Resolve every tunable once. The prompt gets them substituted into its text;
  // the pipeline reads the same values for its cutoffs, so the number the engine
  // was told to stake against is the number we stake against.
  const vars = resolveEngineVariables(config);
  const minConfidence = Number(vars.values.primarySlipFloor);
  const floor = Number(vars.values.absoluteMinimumFloor);

  // Pull the stats the engine is supposed to reason over.
  const { data: statRows } = await db
    .from("fixture_stats")
    .select("*")
    .in("fixture_id", fixtures.map((f) => f.id));
  const statsByFixture = new Map(
    (statRows ?? []).map((r) => [r.fixture_id as string, r]),
  );

  const briefs = fixtures.map((f, i) => {
    const league = asOne(f.leagues);
    const head = `[${i}] ${asOne(f.home)?.name} vs ${asOne(f.away)?.name} | ${league?.name} (${league?.country}) | ${f.fixture_date} | ${f.venue ?? "Unknown"}`;
    const homeExternalId = (asOne(f.home)?.external_id as number | null) ?? null;
    return `${head}\n${statsBlock(statsByFixture.get(f.id), homeExternalId)}`;
  });

  // Which feeds are absent across the WHOLE batch. This sentence used to be a
  // hard-coded list, written when none of these had a feed. It is the last
  // thing the model reads before the fixtures, so once a feed starts arriving
  // a stale list here tells the engine to skip data that is sitting in front
  // of it, and the step goes dark with no error anywhere.
  const absent = batchAbsentFeeds([...statsByFixture.values()]);

  // The thresholds used to be pasted into the user prompt as raw JSON next to a
  // system prompt carrying its own conflicting prose defaults. Now they are
  // substituted into the system prompt itself, so there is exactly one copy of
  // every number and the model is never asked to reconcile two.
  const rendered = renderPrompt(config.system_prompt, config);

  if (rendered.warnings.length) {
    console.warn(
      `[engine] ${rendered.warnings.length} config warning(s):`,
      rendered.warnings.map((w) => `${w.key}=${w.value}, ${w.message}`).join(" | "),
    );
  }
  if (rendered.unknownKeys.length) {
    console.warn(`[engine] config keys matching no variable: ${rendered.unknownKeys.join(", ")}`);
  }

  const userPrompt = `Analyse these ${fixtures.length} fixtures for ${now.toISOString().slice(0, 10)}.

Return one object per fixture, using the fixture index shown in brackets.
Only the stats printed under a fixture are available to you. ${absent}
A feed present for one fixture may be missing for another; judge each fixture
on what is printed beneath it, not on what other fixtures carry.

Fixtures:
${briefs.join("\n")}`;

  /*
   * The model call, timed.
   *
   * This is the step that became the constraint. It is bounded by a 240s client
   * timeout inside a 300s platform ceiling, and the only measurement anyone has
   * is one run of seven fixtures at 152 seconds. Every number downstream of
   * that — the session cap, the timeout itself — is an extrapolation from a
   * single point, so the duration is recorded on the run and returned to the
   * caller rather than being something you find out about by watching a request
   * die.
   */
  const modelStartedAt = Date.now();
  const picks = await ai.generatePicks({
    systemPrompt: rendered.text,
    userPrompt,
    // One object per fixture. The old cap of 10 silently contradicted the
    // prompt's "emit for every fixture" whenever a day carried more than ten.
    maxPicks: fixtures.length,
  });
  const modelDurationMs = Date.now() - modelStartedAt;

  // Loud at three quarters of the budget, because the failure mode past it is
  // not a slow run — it is an aborted one that has already been paid for.
  if (modelDurationMs > 0.75 * ENGINE_CALL_BUDGET_MS) {
    console.warn(
      `[engine] model call took ${(modelDurationMs / 1000).toFixed(1)}s over ${fixtures.length} fixture(s), ` +
        `against a ${ENGINE_CALL_BUDGET_MS / 1000}s timeout. Cut maxFixturesPerSession before it aborts.`,
    );
  }

  // No-bet fixtures are returned so a missing index still means a truncated
  // response rather than a deliberate decline. They are dropped here.
  const analysed = picks.filter((p) => !p.noBetZone);
  const qualifying = analysed.filter((p) => p.confidenceScore >= minConfidence);

  if (!qualifying.length) {
    // The Terms promise a refund for a day we fail to publish, so a zero-pick
    // run is a contractual event, not just an empty board. Nothing detected it
    // before: the run returned quietly and passes kept selling for a day that
    // would never have a board.
    /*
     * What each fixture actually scored, kept.
     *
     * A zero-pick run used to discard the entire analysis: it reported "0
     * generated of 7 considered" and nothing else, so a board of 6.9s and a
     * board of 3.1s were indistinguishable afterwards. The first says the floor
     * is a shade too high, the second says the engine found nothing — opposite
     * problems, identical row. Reconstructing the difference cost a second
     * model call over fixtures that had already been paid for once.
     *
     * Compact on purpose: the score, the pre-anchoring score, and which anchor
     * condition capped it. That is the whole of what you need to tell those two
     * boards apart.
     */
    const scores = picks
      .map((p) => ({
        fixture: describeFixture(fixtures[p.fixtureIndex]),
        market: p.predictionType,
        selection: p.predictedValue,
        confidence: p.confidenceScore,
        raw: p.confidenceRaw ?? null,
        cappedBy: p.anchorCapReason || null,
      }))
      .sort((a, b) => b.confidence - a.confidence);

    await db.from("jobs").insert({
      kind: "engine_published_nothing",
      payload: {
        date: now.toISOString().slice(0, 10),
        considered: picks.length,
        noBetZone: picks.length - analysed.length,
        floor: minConfidence,
        // A run that published nothing still spent the time, and it is the run
        // most likely to have been cut short. No prediction_runs row is written
        // for it, so this payload is the only place its duration survives.
        modelDurationMs,
        fixtures: fixtures.length,
        scores,
      },
    });

    console.error(
      `[engine] published NOTHING for ${now.toISOString().slice(0, 10)}: ${picks.length} considered, none cleared ${minConfidence}`,
    );

    return {
      generated: 0,
      considered: picks.length,
      noBetZone: picks.length - analysed.length,
      note: "none cleared the floor",
      alerted: true,
      // The floor travels with the result. Without it the Office could say only
      // that nothing published, not what the bar was that nothing cleared.
      floor: minConfidence,
      best: scores[0]?.confidence ?? null,
      scores,
      fixtures: fixtures.length,
      modelDurationMs,
      durationMs: Date.now() - startedAt,
      callBudgetMs: ENGINE_CALL_BUDGET_MS,
    };
  }

  const { data: tipster } = await db
    .from("tipsters")
    .select("id")
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();

  const modelVersion = `kicka-quant-v${config.version}-p${ENGINE_PROMPT_VERSION}`;
  const { data: run } = await db
    .from("prediction_runs")
    .insert({
      num_picks: qualifying.length,
      model_version: modelVersion,
      fixtures_considered: fixtures.length,
      model_duration_ms: modelDurationMs,
      // Written before the per-pick inserts below, so this is the run up to and
      // including the model call. The whole-pass figure is patched on at the
      // end; if that patch never lands, the model figure — the one the timeout
      // actually bounds — is still on the row.
      duration_ms: Date.now() - startedAt,
    })
    .select("id")
    .single();

  /*
   * What each fixture already carries, read once.
   *
   * The engine had no idea a fixture already had a pick on it. Every run over
   * the same board wrote another row, so three runs on a seven-fixture Monday
   * left three competing calls per match — different markets, different
   * confidences, all live, all sold. Nothing downstream picks a winner between
   * them, so the board showed whichever the query happened to order first.
   *
   * One pick per fixture, any market, and a better one replaces a worse one.
   * Read as a batch rather than per pick: a session cap of 20 would otherwise
   * be 40 extra round trips inside a loop that already holds an open run.
   */
  const fixtureIds = fixtures.map((f) => f.id);
  const { data: existingRows } = await db
    .from("predictions")
    .select("id, fixture_id, status, confidence_score, prediction_type")
    .in("fixture_id", fixtureIds);

  const existing = new Map<string, NonNullable<typeof existingRows>[number]>();
  const superseded: NonNullable<typeof existingRows> = [];
  for (const row of existingRows ?? []) {
    // Keep the strongest where a previous run left several, so the incoming
    // pick has to beat the best of them rather than whichever sorted first.
    const held = existing.get(row.fixture_id as string);
    if (!held) {
      existing.set(row.fixture_id as string, row);
      continue;
    }
    if (Number(row.confidence_score) > Number(held.confidence_score)) {
      existing.set(row.fixture_id as string, row);
      superseded.push(held);
    } else {
      superseded.push(row);
    }
  }

  /*
   * Which of those a customer is holding.
   *
   * A pick on a slip is one someone has acted on. Rewriting it in place would
   * leave them holding a call they never added — the same reason deleting one
   * is refused. So a slipped pick is left exactly as it is, even when the new
   * pick scores higher: the better call is not worth changing what somebody
   * already bought.
   */
  // Every candidate, not only the strongest per fixture: the losers below are
  // deleted, and a delete needs the same "is anyone holding this" answer that a
  // replace does.
  const heldIds = [...existing.values(), ...superseded].map((r) => r.id as string);
  const { data: legs } = heldIds.length
    ? await db.from("slip_legs").select("prediction_id").in("prediction_id", heldIds)
    : { data: [] as { prediction_id: string }[] };
  const slipped = new Set((legs ?? []).map((l) => l.prediction_id as string));

  /*
   * Duplicates left behind before one-pick-per-fixture existed.
   *
   * Keeping only the strongest in `existing` decides which row this run will
   * compete with, but it does not remove the others — so a fixture that
   * collected three picks over three runs kept showing all three on the board,
   * and the rule was enforced going forward while the backlog stayed live.
   *
   * The same two exemptions as everywhere else: a pick a customer holds, and a
   * pick that has been settled or flagged. Deleting either would rewrite
   * something a person has acted on. Anything left is a row no one has seen and
   * nothing points at.
   */
  const removable = superseded
    .filter((r) => r.status === "pending" && !slipped.has(r.id as string))
    .map((r) => r.id as string);

  let cleaned = 0;
  if (removable.length) {
    const { error } = await db.from("predictions").delete().in("id", removable);
    if (error) {
      // Not fatal: the run's own picks are still correct, and a stale duplicate
      // is the state we were already in.
      console.warn(`[engine] could not clear ${removable.length} duplicate pick(s):`, error.message);
    } else {
      cleaned = removable.length;
      console.warn(
        `[engine] cleared ${cleaned} duplicate pick(s) left by earlier runs on today's board`,
      );
    }
  }

  let written = 0;
  let rejected = 0;
  let replaced = 0;
  let duplicates = 0;

  for (const raw of qualifying) {
    // "" is how the schema expresses "no reason", because a nullable string
    // costs one of the sixteen union slots the model API allows. The column
    // should hold one representation of absent, so the blanks become nulls
    // here, at the boundary, rather than downstream of it.
    const p = blankToNull(raw);
    const fixture = fixtures[p.fixtureIndex];
    if (!fixture || !tipster) continue;

    // A selection the grader cannot parse settles as review_needed forever,
    // never won, never lost, sitting in the Office queue. Drop it at the door.
    const value = normalisePredictedValue(p.predictionType, p.predictedValue);
    if (!value) {
      console.warn(
        `[engine] unusable selection "${p.predictedValue}" for ${p.predictionType} on fixture ${p.fixtureIndex}, dropped`,
      );
      rejected++;
      continue;
    }

    // Clamped, not raised: the floor is a publication gate, and anything below
    // it was already filtered out above.
    const confidence = Math.min(Math.max(p.confidenceScore, floor), 9.8);

    /*
     * One pick per fixture, and the better one wins.
     *
     * Three ways this ends without a write, and they are different enough to
     * count separately. A settled or flagged pick is history — the fixture has
     * been graded or a human has been asked to look, and neither is something
     * a fresh run should overwrite. A slipped pick belongs to a customer. A
     * weaker pick is simply not an improvement.
     */
    const held = existing.get(fixture.id as string);
    const verdict = replaceVerdict(held ?? null, confidence, slipped);
    if (verdict !== "write") {
      if (verdict === "slipped") {
        console.warn(
          `[engine] ${describeFixture(fixture)} already has a pick on a customer slip, leaving it`,
        );
      }
      duplicates++;
      continue;
    }

    const row = {
      fixture_id: fixture.id,
      tipster_id: tipster.id,
      prediction_run_id: run?.id ?? null,
      prediction_type: p.predictionType,
      predicted_value: value,
      confidence_score: confidence,
      confidence_raw: p.confidenceRaw ?? null,
      anchor_cap_applied: p.anchorCapApplied ?? false,
      consistency_override: p.consistencyOverride ?? false,
      staking_unit: stakingUnit(confidence, vars.values),
      frontier_explanation: p.reasoning,
      model_version: modelVersion,
      reasoning_tags: p.reasoningTags?.slice(0, 3) ?? [],
      alt_market: p.altMarket ?? null,
      alt_predicted_value: p.altPredictedValue ?? null,
      alt_confidence: p.altConfidence ?? null,
      mra_signal_home: p.mraSignalHome ?? null,
      mra_signal_away: p.mraSignalAway ?? null,
      filters_applied: p.filtersApplied ?? {},
      // The audit trail behind the number. Kept out of columns because nothing
      // queries it, it is read when someone asks why a pick scored what it did.
      local_model_output: {
        promptVersion: ENGINE_PROMPT_VERSION,
        configVersion: config.version,
        configFallbacks: rendered.fallbacks,
        anchorCapReason: p.anchorCapReason ?? null,
        originalPredictedValue: p.originalPredictedValue ?? null,
        overrideReason: p.overrideReason ?? null,
        h2hLog: p.h2hLog ?? null,
        formLog: p.formLog ?? null,
        penaltyLog: p.penaltyLog ?? null,
      },
    };

    /*
     * Updated in place, not deleted and re-inserted.
     *
     * The id is the pick's public URL and its OG image, so a replacement that
     * minted a new one would break every link already shared for this fixture
     * and leave the old page 404ing. Nothing holds the row — that was checked
     * above — so there is no reason to move it.
     */
    if (held) {
      const { error } = await db.from("predictions").update(row).eq("id", held.id);
      if (!error) {
        replaced++;
        written++;
        // So a third run in the same session compares against what this one
        // wrote, rather than against the row it has already superseded.
        existing.set(fixture.id as string, {
          ...held,
          confidence_score: confidence,
          prediction_type: p.predictionType,
        });
      }
      continue;
    }

    const { data: inserted, error } = await db
      .from("predictions")
      .insert(row)
      .select("id")
      .single();

    if (!error) {
      written++;
      // Two picks in one response can name the same fixture index. Recording
      // the insert means the second is compared against the first rather than
      // becoming the duplicate this whole block exists to prevent.
      if (inserted?.id) {
        existing.set(fixture.id as string, {
          id: inserted.id,
          fixture_id: fixture.id as string,
          status: "pending",
          confidence_score: confidence,
          prediction_type: p.predictionType,
        });
      }
    }
  }

  // Fan-out goes through the outbox, so a slow mail provider can't fail the run.
  // Written directly rather than via app.enqueue(): that helper lives in the
  // private schema PostgREST can't see, and the service role can insert here
  // regardless.
  await db.from("jobs").insert({
    kind: "daily_picks_ready",
    payload: { count: written },
  });

  // High-confidence calls get their own alert, matching the profile toggle.
  const standout = qualifying.filter((p) => p.confidenceScore >= 9.5);
  if (standout.length) {
    await db.from("jobs").insert(
      standout.map((p) => {
        const f = fixtures[p.fixtureIndex];
        return {
          kind: "high_confidence_pick",
          payload: {
            home: asOne(f?.home)?.name ?? "Home",
            away: asOne(f?.away)?.name ?? "Away",
            league: asOne(f?.leagues)?.name ?? "",
            market: p.predictionType,
            confidence: p.confidenceScore,
          },
        };
      }),
    );
  }

  const durationMs = Date.now() - startedAt;
  if (run?.id) {
    await db.from("prediction_runs").update({ duration_ms: durationMs }).eq("id", run.id);
  }

  return {
    generated: written,
    replaced,
    // Fixtures that already carried a pick this run did not improve on. Not a
    // failure — on a second run over the same board it is the expected result.
    duplicates,
    considered: picks.length,
    noBetZone: picks.length - analysed.length,
    rejected,
    configFallbacks: rendered.fallbacks.length,
    warnings: rendered.warnings.length,
    duplicatesCleared: cleaned,
    fixtures: fixtures.length,
    modelDurationMs,
    durationMs,
    // So the Office can show the headroom rather than a bare number nobody can
    // read. 152s means nothing on its own; 152s of 240s means something.
    callBudgetMs: ENGINE_CALL_BUDGET_MS,
  };
}

/** Find overdue fixtures, fetch their results, grade the predictions. */
/**
 * How long after kickoff a fixture belongs to the live poller.
 *
 * Ninety minutes plus stoppage, half time, and generous room for a delayed
 * start. Past this it is either finished — in which case one more poll settles
 * it — or it is stuck, and a stuck fixture polled every ten seconds forever is
 * a standing charge against the API budget for no new information.
 *
 * It is also the handover line: runAutoGrade starts exactly where this ends, so
 * no fixture is ever fetched by both.
 */
const LIVE_WINDOW_MS = 4 * 60 * 60 * 1000;

export async function runAutoGrade() {
  const db = createServiceClient();
  const { football } = getProviders();

  /*
   * Starts where the live poller gives up, so the two never fetch the same
   * fixture.
   *
   * This used to cut at 2.5 hours while the poller holds its window open for 4,
   * which left a 90-minute band where both were asking the upstream about the
   * same match — one every ten seconds and one every two hours. Harmless to the
   * data, since both write the same idempotent update, but it is a second
   * caller for records that already have one, and the sweep's whole job is to
   * catch what the poller could NOT.
   *
   * Disjoint now: the poller owns a fixture for four hours, and anything still
   * unfinished after that is stuck and belongs here. The cost is that a fixture
   * the poller misses waits until 4h rather than 2.5h — which only happens when
   * the poller is down, and is the correct trade for a backstop.
   */
  const cutoff = new Date(Date.now() - LIVE_WINDOW_MS).toISOString();

  const { data: overdue } = await db
    .from("fixtures")
    .select("id, external_id")
    .neq("status", "finished")
    .lt("fixture_date", cutoff)
    .limit(50);

  if (!overdue?.length) return { graded: 0, fixtures: 0 };

  return applyResults(db, football, overdue);
}

/**
 * The fixtures worth polling right now, as query bounds.
 *
 * Exported and used to BUILD the query rather than re-deciding in JavaScript
 * what the query already decided — a predicate beside a WHERE clause is two
 * implementations of one rule, and the one that drifts is always the untested
 * one.
 *
 * Half-open on purpose: `to` is inclusive of a fixture kicking off this very
 * second, `from` is exclusive so a fixture aging out at exactly four hours
 * leaves rather than being polled one last time.
 */
export function liveWindow(now: number = Date.now()): { from: string; to: string } {
  return {
    from: new Date(now - LIVE_WINDOW_MS).toISOString(),
    to: new Date(now).toISOString(),
  };
}

/**
 * Poll in-play fixtures, every ten seconds.
 *
 * Results used to arrive only from runAutoGrade, on a two-hourly schedule
 * behind a 2.5-hour cutoff. A match finishing at 20:30 could therefore sit
 * PENDING until 23:15 — nearly three hours in which the customer who backed it
 * knows the score and the product does not, and the card still says the game is
 * yet to start.
 *
 * THE API BUDGET IS THE DESIGN CONSTRAINT, so read the cost carefully:
 *
 *   - No fixture in the window means NO upstream call at all. This is the whole
 *     guard, and it is what makes a ten-second tick affordable: a poller that
 *     called the API just to be told nothing is in play would spend 8,640 a day
 *     doing it, which is more than the entire plan.
 *   - When something is in play, every fixture in the window goes into ONE
 *     request — fetchResults batches twenty ids per call — so the cost is six
 *     calls a minute regardless of how many matches are on.
 *   - The heaviest realistic day, a Saturday card running 11:30 to 22:00, keeps
 *     the window open about twelve hours and costs roughly 4,650 calls against
 *     a 7,500 plan. A weekday evening is nearer 1,950.
 *
 * Five seconds was considered and rejected: it lands at 9,150 on that same
 * Saturday, which is over the plan, and it would fail by being refused
 * mid-evening rather than by refusing to deploy.
 *
 * Safe to overlap. pg_net fires and forgets, so a slow run can still be in
 * flight when the next tick comes round; every write here is an idempotent
 * update keyed on a fixture id, and grading only ever moves a prediction off
 * `pending`, so a second pass over the same fixture changes nothing.
 */
export async function runLiveResults() {
  const db = createServiceClient();
  const { football } = getProviders();

  const window = liveWindow();

  const { data: inPlay } = await db
    .from("fixtures")
    .select("id, external_id")
    .neq("status", "finished")
    .lte("fixture_date", window.to)
    .gt("fixture_date", window.from)
    .not("external_id", "is", null)
    .order("fixture_date")
    .limit(40);

  // The quota guard, and the common case: most minutes of most days have
  // nothing in play. Returning before the provider is touched is the reason
  // this can run every sixty seconds at all.
  if (!inPlay?.length) return { polled: 0, skipped: "nothing in play" };

  return { polled: inPlay.length, ...(await applyResults(db, football, inPlay)) };
}

/**
 * Fetch results for a set of fixtures, write what came back, grade what ended.
 *
 * Shared by the minute-by-minute poller and the two-hourly sweep, which differ
 * only in which fixtures they hand over. They used to differ in more than that,
 * because only one of them existed and the other would have been a copy.
 *
 * In-play scores are written, not just final ones. The board can show a live
 * score that way, and — more importantly — a fixture moving to `live` is what
 * stops the card claiming the match has not kicked off yet.
 */
async function applyResults(
  db: ReturnType<typeof createServiceClient>,
  football: ReturnType<typeof getProviders>["football"],
  fixtures: Array<{ id: string; external_id: number | null }>,
) {
  const withIds = fixtures.filter((f) => f.external_id != null);
  if (!withIds.length) return { fixtures: 0, graded: 0, live: 0 };

  const results = await football.fetchResults(
    withIds.map((f) => f.external_id as number),
  );
  const byExternal = new Map(results.map((r) => [r.externalId, r]));

  let graded = 0;
  let finished = 0;
  let live = 0;

  for (const fixture of withIds) {
    const result = byExternal.get(fixture.external_id as number);
    if (!result) continue;

    /*
     * A match in progress. Scores are written but nothing is graded, because a
     * scoreline at 70 minutes is not a result — settling on it would pay out a
     * bet the match can still overturn.
     */
    if (result.status !== "finished") {
      const { error } = await db
        .from("fixtures")
        .update({
          status: result.status,
          home_goals: result.homeGoals,
          away_goals: result.awayGoals,
          ht_home_goals: result.htHomeGoals,
          ht_away_goals: result.htAwayGoals,
          // The clock. Written on every pass because it is the field that
          // changes between passes; the scores often do not.
          elapsed_minutes: result.elapsed,
          elapsed_extra: result.elapsedExtra,
          status_short: result.statusShort,
        })
        .eq("id", fixture.id);
      if (!error && result.status === "live") live++;
      continue;
    }

    // Finished, but the feed has not published a score yet. Leaving the status
    // alone keeps it in the poller's window so the next pass picks it up;
    // marking it finished with null goals would make it ungradeable forever.
    if (result.homeGoals == null || result.awayGoals == null) continue;

    await db
      .from("fixtures")
      .update({
        status: "finished",
        home_goals: result.homeGoals,
        away_goals: result.awayGoals,
        ht_home_goals: result.htHomeGoals,
        ht_away_goals: result.htAwayGoals,
        ended_at: new Date().toISOString(),
        // Cleared, not frozen at 90. A finished match has no running clock, and
        // a card that reads "90'" beside a full-time score is claiming the game
        // is still on.
        elapsed_minutes: null,
        elapsed_extra: null,
        status_short: result.statusShort,
      })
      .eq("id", fixture.id);
    finished++;

    const { data: preds } = await db
      .from("predictions")
      .select("id, prediction_type, predicted_value")
      .eq("fixture_id", fixture.id)
      .eq("status", "pending");

    for (const p of preds ?? []) {
      const outcome = gradePrediction(
        p.prediction_type as Market,
        p.predicted_value,
        result.homeGoals,
        result.awayGoals,
        result.htHomeGoals,
        result.htAwayGoals,
      );

      await db
        .from("predictions")
        .update({
          status: outcome,
          settled_at: new Date().toISOString(),
          actual_result: {
            homeGoals: result.homeGoals,
            awayGoals: result.awayGoals,
            htHomeGoals: result.htHomeGoals,
            htAwayGoals: result.htAwayGoals,
          },
          void_reason:
            outcome === "void" ? "Draw on draw-no-bet, stake refunded" : null,
        })
        .eq("id", p.id);
      graded++;
    }
  }

  return { fixtures: finished, graded, live };
}

/**
 * Fetch reported absences for the fixtures the engine is about to reason over.
 *
 * Runs at 05:30, half an hour before daily-picks. That ordering is the entire
 * reason this feed exists rather than line-ups: STEP 6 has been gated off since
 * the prompt was written because the only personnel data anybody had arrived
 * forty minutes before kickoff, twelve hours after the prediction was made.
 *
 * Asked by league and date rather than per fixture, so a seven-fixture evening
 * across four leagues costs four calls rather than seven.
 *
 * WHAT THIS DOES NOT DO is treat an empty answer as good news. The feed returns
 * nothing both for a fully fit squad and for a fixture it has not populated
 * yet, and those are opposite claims. Everything here records what came back
 * and lets statsBlock decide what it means — which it does by refusing to read
 * an empty list as anything at all.
 */
export async function runFetchInjuries() {
  const db = createServiceClient();
  const { football } = getProviders();

  const now = new Date();
  const horizon = new Date(now.getTime() + 36 * 3600 * 1000);

  const { data: fixtures } = await db
    .from("fixtures")
    .select("id, external_id, fixture_date, home_team_id, away_team_id, leagues(external_id, season)")
    .eq("status", "scheduled")
    .gte("fixture_date", now.toISOString())
    .lt("fixture_date", horizon.toISOString())
    .not("external_id", "is", null)
    .order("fixture_date")
    .limit(40);

  if (!fixtures?.length) return { checked: 0, skipped: "no upcoming fixtures" };

  // One request per (league, date) pair rather than per fixture.
  const pairs = new Map<string, { league: number; season: number; date: string }>();
  for (const f of fixtures) {
    const league = asOne(f.leagues) as { external_id: number; season: number } | null;
    if (!league?.external_id) continue;
    const date = String(f.fixture_date).slice(0, 10);
    pairs.set(`${league.external_id}:${date}`, {
      league: league.external_id,
      season: league.season,
      date,
    });
  }

  const all: Awaited<ReturnType<typeof football.fetchInjuries>> = [];
  for (const { league, season, date } of pairs.values()) {
    all.push(...(await football.fetchInjuries(league, season, date)));
  }

  // Index by fixture and side.
  const teamIds = [
    ...new Set(fixtures.flatMap((f) => [f.home_team_id as string, f.away_team_id as string])),
  ];
  const { data: teams } = await db.from("teams").select("id, external_id").in("id", teamIds);
  const externalByTeam = new Map(
    (teams ?? []).map((t) => [t.id as string, t.external_id as number]),
  );

  const byFixture = new Map<number, typeof all>();
  for (const inj of all) {
    const list = byFixture.get(inj.fixtureExternalId) ?? [];
    list.push(inj);
    byFixture.set(inj.fixtureExternalId, list);
  }

  const fetchedAt = new Date().toISOString();
  let upserted = 0;

  for (const f of fixtures) {
    const forFixture = byFixture.get(f.external_id as number) ?? [];
    const homeExternal = externalByTeam.get(f.home_team_id as string);
    const awayExternal = externalByTeam.get(f.away_team_id as string);

    const pick = (side: number | undefined) =>
      forFixture
        .filter((i) => side != null && i.teamExternalId === side)
        .map((i) => ({ name: i.playerName, kind: i.kind, reason: i.reason }));

    const { error } = await db.from("fixture_stats").upsert(
      {
        fixture_id: f.id,
        fixture_external_id: f.external_id,
        home_absences: pick(homeExternal),
        away_absences: pick(awayExternal),
        // Written even when both lists are empty. It is the record that the
        // question was asked, which is the only thing that separates "nobody is
        // out" from "we do not know" — and neither of those is a reason to
        // penalise a side, which is why statsBlock still gates on the CONTENT.
        absences_fetched_at: fetchedAt,
      },
      { onConflict: "fixture_id" },
    );
    if (!error) upserted++;
  }

  return {
    fixtures: fixtures.length,
    calls: pairs.size,
    absences: all.length,
    upserted,
  };
}

/**
 * How far ahead of kickoff a team sheet is worth asking for.
 *
 * Clubs publish roughly an hour to twenty minutes out, and the window opens
 * wider than that on purpose: asking early costs one call that returns empty,
 * while asking late means the page shows a placeholder for a sheet that has
 * been public for half an hour.
 */
const LINEUP_WINDOW_MS = 75 * 60 * 1000;

/**
 * Fetch team sheets for fixtures approaching kickoff.
 *
 * /fixtures/lineups takes one fixture id per call — there is no batch form — so
 * unlike every other feed here the cost scales with the number of fixtures.
 * Two things keep it bounded:
 *
 *   - Only fixtures inside the publication window are asked about, and no
 *     fixture in the window means no upstream call at all.
 *   - A fixture already holding a sheet is never asked again. A published XI
 *     does not change; substitutions are a different feed and are not this.
 *
 * A seven-fixture evening therefore costs at most seven calls in total, spread
 * across the five-minute schedule, not seven per run.
 */
export async function runFetchLineups() {
  const db = createServiceClient();
  const { football } = getProviders();

  const now = Date.now();

  const { data: upcoming } = await db
    .from("fixtures")
    .select("id, external_id, home_team_id, away_team_id")
    .eq("status", "scheduled")
    .gte("fixture_date", new Date(now).toISOString())
    .lt("fixture_date", new Date(now + LINEUP_WINDOW_MS).toISOString())
    .not("external_id", "is", null)
    .order("fixture_date")
    .limit(20);

  if (!upcoming?.length) return { checked: 0, skipped: "nothing near kickoff" };

  // Whoever already has a sheet drops out before a single call is made.
  const { data: have } = await db
    .from("fixture_lineups")
    .select("fixture_id")
    .in("fixture_id", upcoming.map((f) => f.id));
  const held = new Set((have ?? []).map((r) => r.fixture_id as string));

  const wanted = upcoming.filter((f) => !held.has(f.id as string));
  if (!wanted.length) return { checked: upcoming.length, fetched: 0, upserted: 0 };

  const byExternal = new Map(wanted.map((f) => [f.external_id as number, f]));
  const lineups = await football.fetchLineups([...byExternal.keys()]);

  // The feed answers by API team id; our rows are keyed on ours.
  const teamIds = [
    ...new Set(wanted.flatMap((f) => [f.home_team_id as string, f.away_team_id as string])),
  ];
  const { data: teams } = await db
    .from("teams")
    .select("id, external_id")
    .in("id", teamIds);
  const teamByExternal = new Map(
    (teams ?? []).map((t) => [t.external_id as number, t.id as string]),
  );

  let upserted = 0;
  for (const l of lineups) {
    const fixture = byExternal.get(l.fixtureExternalId);
    const teamId = teamByExternal.get(l.teamExternalId);
    // A side we do not hold in the catalogue. Skipping beats writing a sheet
    // against the wrong team.
    if (!fixture || !teamId) continue;

    const { error } = await db.from("fixture_lineups").upsert(
      {
        fixture_id: fixture.id,
        team_id: teamId,
        formation: l.formation,
        coach: l.coach,
        start_xi: l.startXI,
        substitutes: l.substitutes,
        fetched_at: new Date().toISOString(),
      },
      { onConflict: "fixture_id,team_id" },
    );
    if (!error) upserted++;
  }

  return { checked: upcoming.length, asked: wanted.length, fetched: lineups.length, upserted };
}

/** HTML-escape. These are team names from a feed, not our own strings. */
function esc(v: string): string {
  return v.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

/**
 * The daily board as an email.
 *
 * Table markup with inline styles and no external stylesheet, because that is
 * the only thing every mail client renders the same way. No flexbox, no grid,
 * no <style> block: Gmail strips the last one and Outlook has never understood
 * the first two.
 *
 * Confidence is shown, the CALL is not. Everyone who opted in receives this
 * whether or not they have paid today, so fixture, kickoff and confidence are
 * the tease and the market and selection stay behind the paywall — which is
 * also why the button is worth pressing.
 */
function dailyPicksEmail(
  board: Array<{ fixture: string; kickoff: string | null; confidence: number }>,
  count: number,
): string {
  const rows = board
    .map((b, i) => {
      const time = b.kickoff
        ? new Date(b.kickoff).toLocaleTimeString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            timeZone: "UTC",
          })
        : "—";
      const cell = "padding:10px 12px;border-bottom:1px solid #e6e8eb;font-size:14px;";
      return (
        `<tr>` +
        `<td style="${cell}color:#6b7280;">${i + 1}</td>` +
        `<td style="${cell}font-weight:600;">${esc(b.fixture)}</td>` +
        `<td style="${cell}color:#6b7280;white-space:nowrap;">${time}</td>` +
        `<td style="${cell}font-weight:600;text-align:right;">${Math.round(b.confidence * 10)}%</td>` +
        `</tr>`
      );
    })
    .join("");

  const head = "padding:10px 12px;border-bottom:2px solid #111827;font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#6b7280;text-align:left;";

  return [
    `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827;max-width:600px;">`,
    `<p style="font-size:16px;margin:0 0 4px;">${count} new pick${count === 1 ? "" : "s"} are live on Kicka.</p>`,
    `<p style="font-size:13px;color:#6b7280;margin:0 0 20px;">Kickoff times are UTC. Confidence is the model's own score \u2014 the call and the reasoning are on the board.</p>`,
    board.length
      ? `<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;width:100%;">` +
        `<thead><tr>` +
        `<th style="${head}">S/N</th><th style="${head}">Fixture</th>` +
        `<th style="${head}">Time</th><th style="${head}text-align:right;">AI Confidence</th>` +
        `</tr></thead><tbody>${rows}</tbody></table>`
      : "",
    `<p style="margin:28px 0 0;">`,
    `<a href="${SITE_URL}" style="display:inline-block;background:#15803D;color:#ffffff;text-decoration:none;padding:13px 22px;border-radius:999px;font-size:15px;font-weight:600;">See Predictions on Kicka</a>`,
    `</p>`,
    `</div>`,
  ].join("");
}

/** Drain the jobs outbox. Called every minute by pg_cron. */
export async function runDrainJobs(batchSize = 20) {
  const db = createServiceClient();
  const { messaging } = getProviders();

  const { data: claimed } = await db.rpc("claim_jobs", { batch_size: batchSize });
  const jobs = (claimed ?? []) as Array<{
    id: string;
    kind: string;
    payload: Record<string, unknown>;
  }>;

  let done = 0;
  let failed = 0;

  for (const job of jobs) {
    try {
      await handleJob(job, messaging, db);
      await db.rpc("complete_job", { job_id: job.id });
      done++;
    } catch (err) {
      await db.rpc("fail_job", {
        job_id: job.id,
        err: err instanceof Error ? err.message : String(err),
      });
      failed++;

      /*
       * A job that has exhausted its retries is parked in 'dead' rather than
       * dropped, which is right, but it was visible only to an admin who
       * happened to open the Office queue. A dead payment_receipt is a paying
       * customer with no proof of purchase, in a product whose Terms promise
       * refunds; a dead daily_picks_ready is nobody being told the picks exist.
       *
       * A retry that will run again is not worth waking anyone for, so only
       * the final failure reports.
       */
      // fail_job returns void, so the outcome is read back. One extra select on
      // a path that only runs when something already went wrong, in exchange
      // for not changing the signature of a function running in production.
      const { data: after } = await db
        .from("jobs")
        .select("status, attempts, max_attempts")
        .eq("id", job.id)
        .maybeSingle();

      if (after?.status === "dead") {
        reportError(err, {
          scope: "jobs/dead",
          level: "fatal",
          detail: {
            kind: job.kind,
            jobId: job.id,
            attempts: after.attempts,
            maxAttempts: after.max_attempts,
          },
        });
      }
    }
  }

  return { claimed: jobs.length, done, failed };
}

/**
 * One recipient's delivery, isolated from everyone else's.
 *
 * A broadcast used to be a bare `await` inside `for (const r of recipients)`,
 * so the first failure threw out of the loop and every recipient after it got
 * nothing, including the channels that were working. One unreachable number
 * silenced the whole announcement, and the job then retried the entire list
 * from the top, re-sending to everyone who had already been reached before the
 * throw.
 *
 * Failures are reported rather than swallowed. A send that fails silently is
 * the same as one that never happened, and this is the code path that tells
 * people their picks are ready.
 */
export async function deliver(
  scope: string,
  channel: "email" | "sms",
  send: () => Promise<void>,
): Promise<boolean> {
  try {
    await send();
    return true;
  } catch (err) {
    reportError(err, { scope, level: "warning", detail: { channel } });
    return false;
  }
}

/**
 * Fail the job only when nothing at all got through.
 *
 * Partial delivery must not retry: the outbox would re-send to everyone who
 * already received it. Total failure almost always means a credential or a
 * provider outage, which is exactly what retrying is for.
 */
export function settleBroadcast(scope: string, sent: number, failed: number) {
  if (failed > 0 && sent === 0) {
    throw new Error(`${scope}: every delivery failed (${failed} attempted)`);
  }
  if (failed > 0) {
    console.warn(`[kicka] ${scope}: delivered ${sent}, failed ${failed}`);
  }
}

async function handleJob(
  job: { kind: string; payload: Record<string, unknown> },
  messaging: ReturnType<typeof getProviders>["messaging"],
  db: ReturnType<typeof createServiceClient>,
) {
  switch (job.kind) {
    case "daily_picks_ready": {
      const { data: recipients } = await db
        .from("notification_preferences")
        .select("user_id, email_enabled, sms_enabled, profiles(email, phone)")
        .eq("daily_picks_alert", true);

      /*
       * The board, as a table, WITHOUT the calls.
       *
       * This email goes to everybody who opted in, most of whom have not paid
       * today — so it carries fixture, kickoff and confidence and stops there.
       * The market and the selection are the product; naming them here would
       * hand the day away to a mailing list.
       *
       * Fetched here rather than carried in the payload. The job only knows a
       * count, and a payload holding the whole board would duplicate rows that
       * may have been corrected in the Office between the run and the drain.
       */
      const { startISO, endISO } = utcDayWindow();
      const { data: boardRows } = await db
        .from("predictions")
        .select(
          "confidence_score, fixtures!inner(fixture_date, home:teams!fixtures_home_team_id_fkey(name), away:teams!fixtures_away_team_id_fkey(name))",
        )
        .gte("fixtures.fixture_date", startISO)
        .lt("fixtures.fixture_date", endISO)
        .order("confidence_score", { ascending: false })
        .limit(50);

      const board = (boardRows ?? []).map((r) => {
        const f = asOne(r.fixtures) as {
          fixture_date: string;
          home: unknown;
          away: unknown;
        } | null;
        return {
          fixture: `${(asOne(f?.home as never) as { name?: string } | null)?.name ?? "?"} v ${(asOne(f?.away as never) as { name?: string } | null)?.name ?? "?"}`,
          kickoff: f?.fixture_date ?? null,
          confidence: Number(r.confidence_score ?? 0),
        };
      });

      const html = dailyPicksEmail(board, Number(job.payload.count ?? board.length));

      let sent = 0;
      let failed = 0;

      for (const r of recipients ?? []) {
        const profile = asOne(r.profiles) as { email: string | null; phone: string | null } | null;
        if (r.email_enabled && profile?.email) {
          const email = profile.email;
          const ok = await deliver("jobs/daily_picks_ready", "email", () =>
            messaging.sendEmail({
              to: email,
              subject: `Today's picks are ready`,
              html,
            }),
          );
          if (ok) sent++;
          else failed++;
        }
        if (r.sms_enabled && profile?.phone) {
          const phone = profile.phone;
          const ok = await deliver("jobs/daily_picks_ready", "sms", () =>
            messaging.sendSms({
              to: phone,
              message: `Kicka: ${job.payload.count} new picks are live.`,
            }),
          );
          if (ok) sent++;
          else failed++;
        }
      }

      settleBroadcast("jobs/daily_picks_ready", sent, failed);
      return;
    }

    case "high_confidence_pick": {
      const { data: recipients } = await db
        .from("notification_preferences")
        .select("user_id, email_enabled, sms_enabled, profiles(email, phone)")
        .eq("high_confidence_alert", true);

      const p = job.payload as {
        home: string; away: string; league: string; market: string; confidence: number;
      };

      let sent = 0;
      let failed = 0;

      for (const r of recipients ?? []) {
        const profile = asOne(r.profiles) as { email: string | null; phone: string | null } | null;
        const line = `${p.home} v ${p.away} · ${p.market} · ${Math.round(p.confidence * 10)}% confidence`;
        if (r.email_enabled && profile?.email) {
          const email = profile.email;
          const ok = await deliver("jobs/high_confidence_pick", "email", () =>
            messaging.sendEmail({
              to: email,
              subject: `High-confidence call: ${p.home} v ${p.away}`,
              html: `<p>${line}</p><p>${p.league}</p>`,
            }),
          );
          if (ok) sent++;
          else failed++;
        }
        if (r.sms_enabled && profile?.phone) {
          const phone = profile.phone;
          const ok = await deliver("jobs/high_confidence_pick", "sms", () =>
            messaging.sendSms({ to: phone, message: `Kicka: ${line}` }),
          );
          if (ok) sent++;
          else failed++;
        }
      }

      settleBroadcast("jobs/high_confidence_pick", sent, failed);
      return;
    }

    /*
     * One leg landed, and the slip is still alive.
     *
     * refresh_slip decides whether this is worth sending — single-leg slips,
     * the deciding leg, and legs of an already-decided slip are all filtered
     * out in SQL, so anything reaching here is a leg the holder can still do
     * something about. The message says where the slip stands rather than only
     * what the leg did, because "2 of 4 through" is the part they care about.
     */
    case "slip_leg_settled": {
      const p = job.payload as {
        userId: string;
        slipId: string;
        predictionId: string;
        legStatus: string;
        legsSettled: number;
        legsTotal: number;
      };

      const { data: pref } = await db
        .from("notification_preferences")
        .select("email_enabled, sms_enabled, profiles(email, phone)")
        .eq("user_id", p.userId)
        .eq("slip_result_alert", true)
        .maybeSingle();

      if (!pref) return;
      const profile = asOne(pref.profiles) as { email: string | null; phone: string | null } | null;

      const { data: pred } = await db
        .from("predictions")
        .select("fixtures(home:teams!fixtures_home_team_id_fkey(name), away:teams!fixtures_away_team_id_fkey(name))")
        .eq("id", p.predictionId)
        .maybeSingle();

      const fx = asOne(pred?.fixtures as never) as { home: unknown; away: unknown } | null;
      const match = fx
        ? `${(asOne(fx.home as never) as { name?: string } | null)?.name ?? "?"} v ${(asOne(fx.away as never) as { name?: string } | null)?.name ?? "?"}`
        : "A leg of your slip";

      const verb = p.legStatus === "won" ? "won" : p.legStatus === "lost" ? "lost" : "was voided";
      const line = `${match} ${verb}. ${p.legsSettled} of ${p.legsTotal} legs settled, your slip is still open.`;

      if (pref.email_enabled && profile?.email) {
        await messaging.sendEmail({
          to: profile.email,
          subject: `${match} ${verb}`,
          html:
            `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#111827;max-width:600px;">` +
            `<p style="font-size:16px;margin:0 0 16px;">${esc(line)}</p>` +
            `<p style="margin:0;"><a href="${SITE_URL}/slips" style="display:inline-block;background:#15803D;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:999px;font-size:15px;font-weight:600;">View your slip</a></p>` +
            `</div>`,
        });
      }
      if (pref.sms_enabled && profile?.phone) {
        await messaging.sendSms({ to: profile.phone, message: `Kicka: ${line}` });
      }
      return;
    }

    case "slip_settled": {
      const p = job.payload as { userId: string; slipId: string; status: string; legs: number };

      const { data: pref } = await db
        .from("notification_preferences")
        .select("email_enabled, sms_enabled, profiles(email, phone)")
        .eq("user_id", p.userId)
        .eq("slip_result_alert", true)
        .maybeSingle();

      if (!pref) return;
      const profile = asOne(pref.profiles) as { email: string | null; phone: string | null } | null;
      const line = `Your ${p.legs}-leg slip settled: ${p.status.toUpperCase()}`;

      if (pref.email_enabled && profile?.email) {
        await messaging.sendEmail({
          to: profile.email,
          subject: line,
          html: `<p>${line}</p>`,
        });
      }
      if (pref.sms_enabled && profile?.phone) {
        await messaging.sendSms({ to: profile.phone, message: `Kicka: ${line}` });
      }
      return;
    }

    case "payment_receipt": {
      const p = job.payload as {
        userId: string; reference: string; purpose: string;
        amountMinor: number; currency: string; amountUsd: number;
      };

      const { data: profile } = await db
        .from("profiles")
        .select("email")
        .eq("id", p.userId)
        .maybeSingle();

      if (!profile?.email) return;

      const what =
        p.purpose === "daily_pass" ? "Day pass" : "Extra league picks";
      const major = (p.amountMinor / 100).toFixed(2);

      await messaging.sendEmail({
        to: profile.email,
        subject: `Your Kicka receipt (${p.reference})`,
        html:
          `<p>Thanks, your payment went through.</p>` +
          `<table style="border-collapse:collapse">` +
          `<tr><td style="padding:4px 12px 4px 0">Item</td><td><strong>${what}</strong></td></tr>` +
          `<tr><td style="padding:4px 12px 4px 0">Amount</td><td><strong>${p.currency} ${major}</strong> (about $${p.amountUsd})</td></tr>` +
          `<tr><td style="padding:4px 12px 4px 0">Reference</td><td><code>${p.reference}</code></td></tr>` +
          `<tr><td style="padding:4px 12px 4px 0">Date</td><td>${new Date().toUTCString()}</td></tr>` +
          `</table>` +
          `<p style="color:#666;font-size:13px">Keep this reference. You will need it if you ever ask us about this payment.</p>`,
      });
      return;
    }

    case "engine_published_nothing": {
      // Goes to the operators, not to customers. A quiet day is our problem to
      // investigate before it becomes a refund conversation.
      const p = job.payload as {
        date: string; considered: number; floor: number;
      };
      const { data: admins } = await db
        .from("profiles")
        .select("email")
        .eq("is_super_admin", true);

      for (const a of admins ?? []) {
        if (!a.email) continue;
        await messaging.sendEmail({
          to: a.email,
          subject: `No predictions published for ${p.date}`,
          html:
            `<p>The engine ran and published nothing for ${p.date}.</p>` +
            `<p>${p.considered} fixtures considered, none cleared the ${p.floor} floor.</p>` +
            `<p>Passes sold for this day may be refundable under the Terms.</p>`,
        });
      }
      return;
    }

    default:
      throw new Error(`Unknown job kind: ${job.kind}`);
  }
}

/* ----------------------------- helpers ----------------------------- */

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

/** Staking band. Thresholds come from the same resolved table the prompt was rendered with. */
function stakingUnit(confidence: number, v: Record<string, number | string>): number {
  const at = (key: string) => Number(v[key]);
  if (confidence >= at("stakingUnit5Threshold")) return 5;
  if (confidence >= at("stakingUnit4Threshold")) return 4;
  if (confidence >= at("stakingUnit3Threshold")) return 3;
  if (confidence >= at("stakingUnit2Threshold")) return 2;
  return 1;
}

/** PostgREST returns embedded relations as an array or object depending on shape. */
/**
 * Whether an incoming pick may take a fixture that already has one.
 *
 * Pulled out of the loop because it is the whole of the rule and none of the
 * plumbing: four outcomes, no database, no engine. Getting it wrong either
 * rewrites a call a customer is holding or silently keeps the weaker of two
 * picks, and neither shows up as an error anywhere.
 */
export type ReplaceVerdict = "write" | "settled" | "slipped" | "weaker";

export function replaceVerdict(
  held: { id: string; status: string; confidence_score: number | string } | null,
  incoming: number,
  slipped: ReadonlySet<string>,
): ReplaceVerdict {
  // Nothing there. Write it.
  if (!held) return "write";

  // Graded, voided, or flagged for a human. A fresh run does not overwrite a
  // fixture someone has already ruled on.
  if (held.status !== "pending") return "settled";

  // Someone bought this one. The better call is not worth changing what a
  // customer already added to their slip.
  if (slipped.has(held.id)) return "slipped";

  // Ties keep the incumbent: an equal score is not an improvement, and
  // rewriting on a tie would churn the board on every rerun.
  return incoming > Number(held.confidence_score) ? "write" : "weaker";
}

/** "Fulham v Chelsea", for a log line a person has to read. */
function describeFixture(f: { home?: unknown; away?: unknown } | undefined): string {
  if (!f) return "unknown fixture";
  const home = (asOne(f.home as never) as { name?: string } | null)?.name ?? "?";
  const away = (asOne(f.away as never) as { name?: string } | null)?.name ?? "?";
  return `${home} v ${away}`;
}

function asOne<T>(v: T | T[] | null): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}
