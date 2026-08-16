import { createServiceClient } from "./supabase/server";
import { getProviders } from "./providers";
import type { Market } from "./types";
import { renderPrompt } from "./engine/template";
import { resolveEngineVariables } from "./engine/variables";
import { normalisePredictedValue } from "./engine/output";
import { ENGINE_PROMPT_VERSION } from "./engine/prompt";

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

  const now = new Date();
  const horizon = new Date(now.getTime() + 36 * 3600 * 1000);

  const { data: fixtures } = await db
    .from("fixtures")
    .select("id, external_id")
    .eq("status", "scheduled")
    .gte("fixture_date", now.toISOString())
    .lt("fixture_date", horizon.toISOString())
    .not("external_id", "is", null)
    .limit(60);

  if (!fixtures?.length) return { fetched: 0, upserted: 0 };

  const byExternal = new Map(fixtures.map((f) => [f.external_id as number, f.id]));
  const stats = await football.fetchStats([...byExternal.keys()]);

  let upserted = 0;
  for (const s of stats) {
    const fixtureId = byExternal.get(s.fixtureExternalId);
    if (!fixtureId) continue;

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
      },
      { onConflict: "fixture_id" },
    );
    if (!error) upserted++;
  }

  return { fetched: stats.length, upserted };
}

/**
 * Format one fixture's stats for the prompt.
 *
 * Form order is stated explicitly. The prompt reads trajectory off the last
 * three characters, so an unlabelled string that happens to run newest-first
 * would invert every trajectory silently, right shape, wrong answer, no error.
 */
function statsBlock(s: Record<string, unknown> | null | undefined): string {
  if (!s) {
    return "    (no stats for this fixture, reason from league and venue only, and lower confidence accordingly)";
  }
  const home = (s.home_season ?? {}) as Record<string, number>;
  const away = (s.away_season ?? {}) as Record<string, number>;
  return [
    `    Form (oldest result first, rightmost is most recent): home ${s.home_form ?? "?"} | away ${s.away_form ?? "?"}`,
    `    H2H totals: ${s.h2h_home_wins ?? 0} home wins, ${s.h2h_draws ?? 0} draws, ${s.h2h_away_wins ?? 0} away wins; avg ${s.h2h_avg_goals ?? "?"} goals, both scored ${s.h2h_btts_rate ?? "?"}`,
    `    Home season: ${home.avgGoalsScored ?? "?"} scored / ${home.avgGoalsConceded ?? "?"} conceded per game, clean sheets ${home.cleanSheetRate ?? "?"}, both scored ${home.bttsRate ?? "?"}`,
    `    Away season: ${away.avgGoalsScored ?? "?"} scored / ${away.avgGoalsConceded ?? "?"} conceded per game, clean sheets ${away.cleanSheetRate ?? "?"}, both scored ${away.bttsRate ?? "?"}`,
  ].join("\n");
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
    .select("id, fixture_date, venue, leagues(name, country), home:teams!fixtures_home_team_id_fkey(name), away:teams!fixtures_away_team_id_fkey(name)")
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
    return `${head}\n${statsBlock(statsByFixture.get(f.id))}`;
  });

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
Only the stats printed under a fixture are available to you. Anything not
printed there, lineups, injuries, odds, standings, weather, travel, referee
history, is absent for every fixture in this batch, so the steps that depend
on it must be skipped rather than estimated.

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

  const modelVersion = `moonodds-quant-v${config.version}-p${ENGINE_PROMPT_VERSION}`;
  const { data: run } = await db
    .from("prediction_runs")
    .insert({ num_picks: qualifying.length, model_version: modelVersion })
    .select("id")
    .single();

  let written = 0;
  let rejected = 0;

  for (const p of qualifying) {
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
        environmentalLog: p.environmentalLog ?? null,
        h2hLog: p.h2hLog ?? null,
        formLog: p.formLog ?? null,
        personnelLog: p.personnelLog ?? null,
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
    }
  }

  return { claimed: jobs.length, done, failed };
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

      for (const r of recipients ?? []) {
        const profile = asOne(r.profiles) as { email: string | null; phone: string | null } | null;
        if (r.email_enabled && profile?.email) {
          await messaging.sendEmail({
            to: profile.email,
            subject: `Today's picks are ready`,
            html: `<p>${job.payload.count} new picks are live on MoonOdds.</p>`,
          });
        }
        if (r.sms_enabled && profile?.phone) {
          await messaging.sendSms({
            to: profile.phone,
            message: `MoonOdds: ${job.payload.count} new picks are live.`,
          });
        }
      }
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

      for (const r of recipients ?? []) {
        const profile = asOne(r.profiles) as { email: string | null; phone: string | null } | null;
        const line = `${p.home} v ${p.away} · ${p.market} · ${Math.round(p.confidence * 10)}% confidence`;
        if (r.email_enabled && profile?.email) {
          await messaging.sendEmail({
            to: profile.email,
            subject: `High-confidence call: ${p.home} v ${p.away}`,
            html: `<p>${line}</p><p>${p.league}</p>`,
          });
        }
        if (r.sms_enabled && profile?.phone) {
          await messaging.sendSms({ to: profile.phone, message: `MoonOdds: ${line}` });
        }
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
        await messaging.sendSms({ to: profile.phone, message: `MoonOdds: ${line}` });
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
        subject: `Your MoonOdds receipt (${p.reference})`,
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
