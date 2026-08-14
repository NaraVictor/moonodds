import { createServiceClient } from "./supabase/server";

/**
 * CLV check and self-tuning, ported from convex/cron_jobs/clv_check.ts and
 * convex/ai_engine/self_tuning.ts.
 */

/**
 * Flag picks where the closing line has moved against our position by more
 * than the configured threshold. A pick the market disagreed with after we
 * took it is the clearest signal we mispriced something.
 */
export async function runClvCheck() {
  const db = createServiceClient();

  const { data: config } = await db
    .from("ai_engine_config")
    .select("filter_thresholds")
    .eq("status", "active")
    .maybeSingle();

  const thresholdPct = config?.filter_thresholds?.clvMovementThresholdPct ?? 5;

  const { data: snapshots } = await db
    .from("odds_snapshots")
    .select("id, pick_odds, closing_odds, prediction_id")
    .not("prediction_id", "is", null)
    .not("closing_odds", "is", null)
    .not("pick_odds", "is", null)
    .limit(200);

  let flagged = 0;

  for (const s of snapshots ?? []) {
    const pick = Number(s.pick_odds);
    const close = Number(s.closing_odds);
    if (!pick || !close) continue;

    // Odds drifting OUT means the market thinks our side is less likely.
    const driftPct = ((close - pick) / pick) * 100;
    const opposed = driftPct > thresholdPct;
    const delta = Number((((pick - close) / close)).toFixed(4));

    await db
      .from("odds_snapshots")
      .update({ clv_delta: delta, market_opposed: opposed })
      .eq("id", s.id);

    if (opposed) flagged++;
  }

  return { reviewed: snapshots?.length ?? 0, flagged, thresholdPct };
}

type Bucket = { total: number; wins: number; losses: number; winRate: number };

function bucket(): Bucket {
  return { total: 0, wins: 0, losses: 0, winRate: 0 };
}

function tally(map: Record<string, Bucket>, key: string, won: boolean) {
  const b = (map[key] ??= bucket());
  b.total++;
  if (won) b.wins++;
  else b.losses++;
  b.winRate = Number((b.wins / b.total).toFixed(3));
}

/**
 * Analyse recently settled picks and propose weight changes.
 *
 * As in the original, this writes a report for a human to approve rather than
 * mutating the live config — unless selfTuning.autoApply is on.
 */
export async function runRecalibration() {
  const db = createServiceClient();

  const { data: config } = await db
    .from("ai_engine_config")
    .select("*")
    .eq("status", "active")
    .maybeSingle();

  if (!config) return { skipped: "no active config" };

  const { data: lastReport } = await db
    .from("tuning_reports")
    .select("generated_at")
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const since =
    lastReport?.generated_at ??
    new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();

  const { data: settled } = await db
    .from("predictions")
    .select("prediction_type, status, confidence_score, filters_applied, mra_signal_home, settled_at, fixtures(leagues(name))")
    .in("status", ["won", "lost"])
    .gte("settled_at", since)
    .limit(500);

  const batchSize = config.self_tuning?.batchSize ?? 50;
  if (!settled || settled.length < batchSize) {
    return { skipped: `only ${settled?.length ?? 0} settled since last report (need ${batchSize})` };
  }

  const byMarket: Record<string, Bucket> = {};
  const byLeague: Record<string, Bucket> = {};
  const byBand: Record<string, Bucket> = {};
  const byFilter: Record<string, Bucket> = {};
  const byMra: Record<string, Bucket> = {};

  let wins = 0;

  for (const p of settled) {
    const won = p.status === "won";
    if (won) wins++;

    tally(byMarket, p.prediction_type, won);

    const fixture = Array.isArray(p.fixtures) ? p.fixtures[0] : p.fixtures;
    const league = fixture
      ? (Array.isArray(fixture.leagues) ? fixture.leagues[0] : fixture.leagues)
      : null;
    if (league?.name) tally(byLeague, league.name, won);

    const c = Number(p.confidence_score);
    const band =
      c >= 9.5 ? "9.5+" : c >= 9 ? "9.0-9.5" : c >= 8.5 ? "8.5-9.0" : c >= 8 ? "8.0-8.5" : "7.0-8.0";
    tally(byBand, band, won);

    for (const [name, on] of Object.entries(p.filters_applied ?? {})) {
      if (on) tally(byFilter, name, won);
    }

    if (p.mra_signal_home) tally(byMra, p.mra_signal_home, won);
  }

  const overallWinRate = Number((wins / settled.length).toFixed(4));
  const target = config.self_tuning?.performanceTargetWinRate ?? 0.62;
  const under = config.self_tuning?.underperformThreshold ?? 0.52;
  const maxDelta = config.weight_constraints?.maxDeltaPerCycle ?? 0.05;

  // Propose shifting weight from the weakest bucket toward the strongest,
  // bounded by the configured per-cycle delta.
  const markets = Object.entries(byMarket).filter(([, b]) => b.total >= 5);
  markets.sort((a, b) => b[1].winRate - a[1].winRate);

  const weightChanges: unknown[] = [];
  const thresholdChanges: unknown[] = [];

  if (markets.length >= 2) {
    const [bestName, best] = markets[0];
    const [worstName, worst] = markets[markets.length - 1];

    if (best.winRate - worst.winRate > 0.15) {
      const current = config.ranking_weights?.xgWeight ?? 0.22;
      weightChanges.push({
        parameter: "xgWeight",
        current_value: current,
        proposed_value: Number((current + maxDelta * 0.6).toFixed(3)),
        delta: Number((maxDelta * 0.6).toFixed(3)),
        rationale: `${bestName} is the strongest market at ${(best.winRate * 100).toFixed(1)}% while ${worstName} sits at ${(worst.winRate * 100).toFixed(1)}%. Weighting the underlying signal more heavily should narrow that gap.`,
      });
    }
  }

  const weakBand = byBand["7.0-8.0"];
  if (weakBand && weakBand.total >= 5 && weakBand.winRate < under) {
    const floor = config.confidence_thresholds?.primarySlipFloor ?? 8.5;
    thresholdChanges.push({
      parameter: "primarySlipFloor",
      current_value: floor,
      proposed_value: Number((floor + 0.2).toFixed(2)),
      delta: 0.2,
      rationale: `The 7.0-8.0 confidence band returned ${(weakBand.winRate * 100).toFixed(1)}% across ${weakBand.total} picks, below the ${(under * 100).toFixed(0)}% underperformance threshold. Raising the floor removes that tail.`,
    });
  }

  if (!weightChanges.length && !thresholdChanges.length) {
    return {
      reviewed: settled.length,
      overallWinRate,
      proposals: 0,
      note: `performance is within target (${(target * 100).toFixed(0)}%)`,
    };
  }

  const autoApply = config.self_tuning?.autoApply === true;

  const { data: report } = await db
    .from("tuning_reports")
    .insert({
      config_id: config.id,
      review_period: {
        from: since,
        to: new Date().toISOString(),
        predictionsReviewed: settled.length,
        settled: settled.length,
        voids: 0,
        overallWinRate,
      },
      performance_by_market: byMarket,
      performance_by_league: byLeague,
      performance_by_confidence_band: byBand,
      performance_by_filter: byFilter,
      performance_by_mra_signal: byMra,
      proposed_weight_changes: weightChanges,
      proposed_threshold_changes: thresholdChanges,
      proposed_filter_changes: [],
      status: autoApply ? "approved" : "pending",
    })
    .select("id")
    .single();

  return {
    reviewed: settled.length,
    overallWinRate,
    proposals: weightChanges.length + thresholdChanges.length,
    reportId: report?.id,
    autoApplied: autoApply,
  };
}
