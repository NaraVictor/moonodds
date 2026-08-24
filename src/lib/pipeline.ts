import { createServiceClient } from "./supabase/server";
import { getProviders } from "./providers";
import type { Market } from "./types";
import type { H2HMeeting, RecentMatch, VenueSplit } from "./providers/types";
import { renderPrompt } from "./engine/template";
import { resolveEngineVariables } from "./engine/variables";
import { blankToNull, normalisePredictedValue } from "./engine/output";
import { ENGINE_PROMPT_VERSION } from "./engine/prompt";
import { reportError } from "./report-error";

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

/** Pull fixtures for a date and upsert leagues, teams and fixtures. */
export async function runFetchFixtures(date: string) {
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
      },
      { onConflict: "external_id" },
    );

    if (!error) inserted++;
  }

  return { date, leagues: leagueIds.length, fixtures: raw.length, upserted: inserted };
}

/**
 * Fetch pre-match stats for upcoming fixtures.
 *
 * This is the feed the engine actually reasons over. Without it the prompt
 * carries fixture names and nothing else, and every "based on the numbers"
 * claim in the product is hollow.
 */
export async function runFetchStats() {
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
  const perSession = budget.maxFixturesPerSession ?? 30;
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

  return { fetched: stats.length, upserted, requested: fixtures.length, limit };
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
    `    Home season: ${home.avgGoalsScored ?? "?"} scored / ${home.avgGoalsConceded ?? "?"} conceded per game, clean sheets ${home.cleanSheetRate ?? "?"}, both scored ${home.bttsRate ?? "?"}`,
    `    Away season: ${away.avgGoalsScored ?? "?"} scored / ${away.avgGoalsConceded ?? "?"} conceded per game, clean sheets ${away.cleanSheetRate ?? "?"}, both scored ${away.bttsRate ?? "?"}`,
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
    "lineups",
    "injuries and suspensions",
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
export async function runDailyPicks() {
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
    .limit(config.api_budget?.maxFixturesPerSession ?? 30);

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

  const picks = await ai.generatePicks({
    systemPrompt: rendered.text,
    userPrompt,
    // One object per fixture. The old cap of 10 silently contradicted the
    // prompt's "emit for every fixture" whenever a day carried more than ten.
    maxPicks: fixtures.length,
  });

  // No-bet fixtures are returned so a missing index still means a truncated
  // response rather than a deliberate decline. They are dropped here.
  const analysed = picks.filter((p) => !p.noBetZone);
  const qualifying = analysed.filter((p) => p.confidenceScore >= minConfidence);

  if (!qualifying.length) {
    // The Terms promise a refund for a day we fail to publish, so a zero-pick
    // run is a contractual event, not just an empty board. Nothing detected it
    // before: the run returned quietly and passes kept selling for a day that
    // would never have a board.
    await db.from("jobs").insert({
      kind: "engine_published_nothing",
      payload: {
        date: now.toISOString().slice(0, 10),
        considered: picks.length,
        noBetZone: picks.length - analysed.length,
        floor: minConfidence,
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
    .insert({ num_picks: qualifying.length, model_version: modelVersion })
    .select("id")
    .single();

  let written = 0;
  let rejected = 0;

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

    const { error } = await db.from("predictions").insert({
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
    });
    if (!error) written++;
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

  return {
    generated: written,
    considered: picks.length,
    noBetZone: picks.length - analysed.length,
    rejected,
    configFallbacks: rendered.fallbacks.length,
    warnings: rendered.warnings.length,
  };
}

/** Find overdue fixtures, fetch their results, grade the predictions. */
export async function runAutoGrade() {
  const db = createServiceClient();
  const { football } = getProviders();

  const cutoff = new Date(Date.now() - 2.5 * 60 * 60 * 1000).toISOString();

  const { data: overdue } = await db
    .from("fixtures")
    .select("id, external_id")
    .neq("status", "finished")
    .lt("fixture_date", cutoff)
    .limit(50);

  if (!overdue?.length) return { graded: 0, fixtures: 0 };

  const withIds = overdue.filter((f) => f.external_id != null);
  const results = await football.fetchResults(
    withIds.map((f) => f.external_id as number),
  );
  const byExternal = new Map(results.map((r) => [r.externalId, r]));

  let graded = 0;
  let finished = 0;

  for (const fixture of withIds) {
    const result = byExternal.get(fixture.external_id as number);
    if (!result || result.status !== "finished") continue;
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

  return { fixtures: finished, graded };
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
              html: `<p>${job.payload.count} new picks are live on Kicka.</p>`,
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
function asOne<T>(v: T | T[] | null): T | null {
  if (Array.isArray(v)) return v[0] ?? null;
  return v ?? null;
}
