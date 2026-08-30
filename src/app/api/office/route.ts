import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/api-auth";
import { refundPayment } from "@/lib/payments";
import { createServiceClient } from "@/lib/supabase/server";
import {
  runAutoGrade,
  runDailyPicks,
  runFetchFixtures,
  runFetchStats,
  gradePrediction,
  slugify,
} from "@/lib/pipeline";
import { getProviders } from "@/lib/providers";
import { leagueBadgeUrl, teamCrestUrl } from "@/lib/providers/types";
import type { Market } from "@/lib/types";
import { runClvCheck, runRecalibration } from "@/lib/tuning";
import {
  VARIABLES_BY_KEY,
  applyVariableEdits,
  resolveEngineVariables,
  validateEngineVariables,
} from "@/lib/engine/variables";
import { clearFxFallbackCache, currentFallback } from "@/lib/pricing-server";
import { MAX_FIXTURES_OVERRIDE } from "@/lib/engine/limits";

/**
 * Next config version.
 *
 * `version` is a semver-shaped text column, not a number, bumping it
 * arithmetically yields NaN and the insert fails silently. Increments the patch
 * segment, and falls back to appending one for anything that isn't dotted.
 */
function nextVersion(current: string): string {
  const parts = current.split(".");
  const patch = Number(parts[parts.length - 1]);
  if (parts.length < 2 || Number.isNaN(patch)) return `${current}.1`;
  return [...parts.slice(0, -1), patch + 1].join(".");
}

/** Initials when the catalogue gives us no team code. */
function autoShortName(name: string): string {
  const words = name
    .replace(/\b(FC|CF|SC|AC|AS|SS|US|CD)\b/gi, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length >= 3) return words.slice(0, 3).map((w) => w[0]).join("");
  if (words.length === 2) return words[0].slice(0, 2) + words[1][0];
  return name.slice(0, 3);
}

/**
 * Office actions.
 *
 * One route with a discriminated action rather than a dozen endpoints, every
 * one of these needs the identical super-admin guard, and putting that in one
 * place means it cannot be forgotten on a new action.
 */

const Body = z.discriminatedUnion("action", [
  /*
   * `maxFixtures` sizes a manual run.
   *
   * The scheduled jobs never pass it and take the config's own cap. This is for
   * the operator standing in front of the Office who wants a five-fixture pass
   * to check something, or a wider one on a heavy Saturday. Bounded at both
   * ends here as well as in the pipeline, because a request body is not a place
   * to learn what MAX_FIXTURES_OVERRIDE is.
   */
  z.object({
    action: z.literal("fetchFixtures"),
    date: z.string().optional(),
    maxFixtures: z.number().int().min(1).max(MAX_FIXTURES_OVERRIDE).optional(),
  }),
  z.object({
    action: z.literal("fetchStats"),
    maxFixtures: z.number().int().min(1).max(MAX_FIXTURES_OVERRIDE).optional(),
  }),
  z.object({
    action: z.literal("generatePicks"),
    maxFixtures: z.number().int().min(1).max(MAX_FIXTURES_OVERRIDE).optional(),
    // A named selection from the board. Absent means the whole day, which is
    // what the scheduled run sends.
    fixtureIds: z.array(z.uuid()).min(1).max(MAX_FIXTURES_OVERRIDE).optional(),
  }),
  z.object({
    action: z.literal("fetchAndGenerate"),
    date: z.string().optional(),
    maxFixtures: z.number().int().min(1).max(MAX_FIXTURES_OVERRIDE).optional(),
  }),
  z.object({ action: z.literal("deleteFixture"), fixtureId: z.uuid() }),
  /*
   * Bounded at 100 because the board itself is capped at 100 rows, so a larger
   * request could only come from something other than the page — and a delete
   * that takes an unbounded list is a delete that can take the whole table.
   */
  z.object({
    action: z.literal("deleteFixtures"),
    fixtureIds: z.array(z.uuid()).min(1).max(100),
  }),
  z.object({ action: z.literal("deletePrediction"), predictionId: z.uuid() }),
  z.object({
    action: z.literal("setPredictionTier"),
    predictionId: z.uuid(),
    tier: z.enum(["primary", "extra"]),
  }),
  z.object({ action: z.literal("gradeResults") }),
  z.object({ action: z.literal("clvCheck") }),
  z.object({ action: z.literal("recalibrate") }),
  z.object({ action: z.literal("approveReport"), reportId: z.uuid() }),
  z.object({
    action: z.literal("rejectReport"),
    reportId: z.uuid(),
    reason: z.string().max(500).optional(),
  }),
  z.object({
    action: z.literal("setUserFlags"),
    userId: z.uuid(),
    isSuspended: z.boolean().optional(),
    isSuperAdmin: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("setFixtureResult"),
    fixtureId: z.uuid(),
    homeGoals: z.number().int().min(0).max(30),
    awayGoals: z.number().int().min(0).max(30),
    htHomeGoals: z.number().int().min(0).max(30).nullable().optional(),
    htAwayGoals: z.number().int().min(0).max(30).nullable().optional(),
  }),
  z.object({
    action: z.literal("overridePrediction"),
    predictionId: z.uuid(),
    status: z.enum(["won", "lost", "void", "review_needed", "pending"]),
    reason: z.string().min(3).max(500),
  }),
  z.object({
    action: z.literal("updateWeights"),
    configId: z.uuid(),
    rankingWeights: z.record(z.string(), z.number()),
    confidenceThresholds: z.record(z.string(), z.number()).optional(),
  }),
  z.object({
    action: z.literal("updateVariables"),
    configId: z.uuid(),
    values: z.record(z.string(), z.union([z.number(), z.string().min(1).max(60)])),
  }),
  z.object({
    action: z.literal("setFxFallback"),
    // null clears the override and hands control back to the environment.
    rate: z.number().min(1).max(200).nullable(),
  }),

  /* ------------------------------ catalog ------------------------------ */

  z.object({ action: z.literal("searchLeagues"), query: z.string().min(3).max(60) }),
  z.object({ action: z.literal("searchTeams"), query: z.string().min(3).max(60) }),
  z.object({
    action: z.literal("importLeague"),
    externalId: z.number().int().positive(),
    name: z.string().min(1).max(120),
    country: z.string().min(1).max(80),
    season: z.number().int().min(1900).max(2200),
    logo: z.string().max(500).nullable().optional(),
  }),
  z.object({
    action: z.literal("importTeams"),
    leagueId: z.uuid(),
    leagueExternalId: z.number().int().positive(),
    season: z.number().int().min(1900).max(2200),
  }),
  z.object({
    action: z.literal("createLeague"),
    name: z.string().min(1).max(120),
    country: z.string().min(1).max(80),
    season: z.number().int().min(1900).max(2200).nullable().optional(),
  }),
  z.object({
    action: z.literal("updateLeague"),
    leagueId: z.uuid(),
    name: z.string().min(1).max(120).optional(),
    country: z.string().min(1).max(80).optional(),
    season: z.number().int().min(1900).max(2200).nullable().optional(),
    isActive: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("createTeam"),
    leagueId: z.uuid(),
    name: z.string().min(1).max(120),
    shortName: z.string().min(1).max(8).optional(),
  }),
  z.object({
    action: z.literal("updateTeam"),
    teamId: z.uuid(),
    name: z.string().min(1).max(120).optional(),
    shortName: z.string().min(1).max(8).optional(),
    leagueId: z.uuid().optional(),
    isActive: z.boolean().optional(),
  }),
  z.object({ action: z.literal("deleteTeam"), teamId: z.uuid() }),

  /* ------------------------ engine config lifecycle ------------------------ */

  z.object({
    action: z.literal("createDraftConfig"),
    fromConfigId: z.uuid(),
    name: z.string().min(1).max(120),
    notes: z.string().max(2000).optional(),
  }),
  z.object({ action: z.literal("activateConfig"), configId: z.uuid() }),
  z.object({ action: z.literal("archiveConfig"), configId: z.uuid() }),

  /* --------------------------- user management --------------------------- */

  z.object({
    action: z.literal("grantPass"),
    userId: z.uuid(),
    days: z.number().int().min(1).max(30).default(1),
  }),
  z.object({ action: z.literal("revokePass"), userId: z.uuid() }),
  z.object({
    action: z.literal("updateUserProfile"),
    userId: z.uuid(),
    displayName: z.string().max(120).nullable().optional(),
    phone: z.string().max(32).nullable().optional(),
  }),
  z.object({ action: z.literal("deleteUser"), userId: z.uuid() }),
  z.object({
    action: z.literal("refundPayment"),
    reference: z.string().min(8),
    reason: z.string().min(3).max(500),
  }),
  z.object({
    action: z.literal("setSelectedLeagues"),
    configId: z.uuid(),
    leagueExternalIds: z.array(z.number().int().positive()).max(60),
  }),
]);

export const maxDuration = 300;

/**
 * Read-only Office settings that a browser client cannot fetch for itself.
 *
 * The FX fallback lives behind a service-role RPC, so the admin's own Supabase
 * session cannot read it the way it reads ai_engine_config. This is the seam.
 */
export async function GET() {
  const guard = await requireSuperAdmin();
  if ("error" in guard) return guard.error;

  return NextResponse.json({ fx: await currentFallback() });
}

export async function POST(request: Request) {
  const guard = await requireSuperAdmin();
  if ("error" in guard) return guard.error;

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Unrecognised action.", detail: parsed.error.issues[0]?.message },
      { status: 400 },
    );
  }

  const body = parsed.data;
  const db = createServiceClient();
  const actor = guard.user.email ?? guard.user.id;

  /**
   * Every Office action is written to an append-only log before it runs.
   *
   * Before this, only prediction overrides recorded who did them: comping a
   * pass, deleting an account, promoting a config and rewriting the system
   * prompt all left nothing behind. Logged up front rather than on success,
   * because an action that failed halfway is exactly the one you want to find
   * afterwards.
   */
  await db.rpc("record_admin_action", {
    p_actor_id: guard.user.id,
    p_actor_email: guard.user.email ?? null,
    p_action: body.action,
    p_target_type: targetTypeOf(body.action),
    p_target_id: targetIdOf(body),
    p_detail: redactForAudit(body),
  });

  try {
    switch (body.action) {
      case "fetchFixtures":
        return NextResponse.json(
          await runFetchFixtures(body.date ?? new Date().toISOString().slice(0, 10), {
            withStats: true,
            maxFixtures: body.maxFixtures,
          }),
        );

      case "fetchStats":
        return NextResponse.json(await runFetchStats({ maxFixtures: body.maxFixtures }));

      case "generatePicks":
        return NextResponse.json(
          await runDailyPicks({
            maxFixtures: body.maxFixtures,
            fixtureIds: body.fixtureIds,
          }),
        );

      /**
       * The whole board in one call: fixtures, their stats, then the engine.
       *
       * Sequential because it has to be — the engine reads the rows the fetch
       * just wrote. That makes this the longest request the app can issue, so
       * a pull that returns nothing stops here rather than paying for a model
       * call over an empty board.
       */
      case "fetchAndGenerate": {
        const fetched = await runFetchFixtures(
          body.date ?? new Date().toISOString().slice(0, 10),
          { withStats: true, maxFixtures: body.maxFixtures },
        );

        if (fetched.upserted === 0) {
          return NextResponse.json({
            fetch: fetched,
            picks: { skipped: "no fixtures came back, nothing to run the engine over" },
          });
        }

        return NextResponse.json({
          fetch: fetched,
          picks: await runDailyPicks({ maxFixtures: body.maxFixtures }),
        });
      }

      /**
       * Drop a fixture off the board before the engine sees it.
       *
       * Nothing here is soft: `fixtures` cascades to its stats, predictions and
       * odds snapshots, which is the right shape for a row pulled in by mistake
       * and the wrong shape for one the engine has already published against.
       * So a fixture carrying predictions is refused — take the prediction out
       * first, deliberately, and the refusal names the count doing the refusing.
       */
      /*
       * A fixture can go whether or not it has been predicted. What stops it is
       * somebody HOLDING one of those predictions.
       *
       * This used to refuse any fixture carrying a prediction at all, which was
       * the wrong line: a pick nobody has added to a slip is ours to withdraw,
       * and forcing the operator to delete the pick first only added a step.
       * The real hazard is narrower and worse — slip_legs cascades from
       * predictions, which cascade from fixtures, so dropping a fixture a
       * customer has backed empties their slip with no trace and no record that
       * it ever contained anything.
       *
       * The board only carries upcoming, unstarted fixtures, so nothing settled
       * is reachable from here and the published record is not at risk.
       */
      case "deleteFixture": {
        const held = await slippedFixtures(db, [body.fixtureId]);

        if (held.size > 0) {
          const legs = held.get(body.fixtureId) ?? 0;
          return NextResponse.json(
            {
              error: `${legs} customer slip${legs === 1 ? " has" : "s have"} a pick from this fixture on ${legs === 1 ? "it" : "them"}. Removing the fixture would take that pick off ${legs === 1 ? "the slip" : "those slips"} with no trace.`,
            },
            { status: 409 },
          );
        }

        const { error } = await db.from("fixtures").delete().eq("id", body.fixtureId);
        if (error) throw new Error(error.message);
        return NextResponse.json({ deleted: true });
      }

      /**
       * The same rule as deleteFixture, applied to a selection.
       *
       * ONE request rather than one per fixture, and that is not only about
       * round trips. Every action here is written to the append-only audit log
       * before it runs, so a loop on the client would record twenty entries for
       * one decision and lose the fact that it WAS one decision. It also makes
       * the refusal coherent: the whole selection is checked against the same
       * snapshot of predictions rather than each fixture against a table that
       * may have changed between calls.
       *
       * Partial success is the expected outcome, not an error. A fixture that
       * has picked up a prediction is refused and the rest still go, because
       * the alternative — failing all twenty because one is spoken for — makes
       * the operator hunt for the offender by hand. The response names which
       * ones were kept and why, so the UI can say so precisely.
       */
      case "deleteFixtures": {
        const blocked = await slippedFixtures(db, body.fixtureIds);
        const deletable = body.fixtureIds.filter((id) => !blocked.has(id));

        if (deletable.length) {
          const { error } = await db.from("fixtures").delete().in("id", deletable);
          if (error) throw new Error(error.message);
        }

        return NextResponse.json({
          deleted: deletable.length,
          requested: body.fixtureIds.length,
          refused: [...blocked.entries()].map(([fixtureId, slips]) => ({
            fixtureId,
            slips,
          })),
        });
      }

      /**
       * Remove a prediction outright.
       *
       * Two things it must not become. It must not be a way to tidy a losing
       * record: a settled pick is in the hit rate customers were shown and in
       * every ROI number computed since, so won/lost are refused and `void`
       * through the override is the honest retraction. And it must not silently
       * empty someone's slip, `slip_legs` cascades, so a pick a customer is
       * holding is refused too. What is left is the actual case: a bad pick,
       * caught before anyone acted on it.
       */
      case "deletePrediction": {
        const { data: pred } = await db
          .from("predictions")
          .select("id, status")
          .eq("id", body.predictionId)
          .maybeSingle();

        if (!pred) {
          return NextResponse.json({ error: "That prediction is already gone." }, { status: 404 });
        }

        if (pred.status === "won" || pred.status === "lost") {
          return NextResponse.json(
            {
              error: "That pick is settled and counts towards the published record. Void it in Grade instead, which keeps the trail.",
            },
            { status: 409 },
          );
        }

        const { count: legs } = await db
          .from("slip_legs")
          .select("id", { count: "exact", head: true })
          .eq("prediction_id", body.predictionId);

        if (legs && legs > 0) {
          return NextResponse.json(
            {
              error: `${legs} customer slip${legs === 1 ? " has" : "s have"} this pick on ${legs === 1 ? "it" : "them"}. Void it in Grade instead, deleting would remove it from ${legs === 1 ? "that slip" : "those slips"} with no trace.`,
            },
            { status: 409 },
          );
        }

        const { error } = await db.from("predictions").delete().eq("id", body.predictionId);
        if (error) throw new Error(error.message);
        return NextResponse.json({ deleted: true });
      }

      /*
       * Move one pick across the paywall.
       *
       * Three refusals, and each of them protects a promise already made:
       *
       *   settled     its tier is in the published record. get_history_stats
       *               counts the board and ignores extras, so moving a graded
       *               pick silently rewrites the hit rate on /history.
       *   sold        a buyer was dealt this fixture. get_my_extra_picks
       *               filters on tier = 'extra', so promoting it removes the
       *               pick from their list as completely as deleting the row.
       *   on a slip   somebody added it to a slip while it was on the free
       *               board. Demoting it puts what they are holding behind a
       *               paywall they have not paid.
       *
       * The engine's own settleTiers applies the same freezes, so a run cannot
       * undo an operator's move on a sold or slipped pick either.
       */
      case "setPredictionTier": {
        if (body.tier !== "primary" && body.tier !== "extra") {
          return NextResponse.json({ error: "Unknown tier." }, { status: 400 });
        }

        const { data: pred } = await db
          .from("predictions")
          .select("id, status, tier, fixture_id")
          .eq("id", body.predictionId)
          .maybeSingle();

        if (!pred) {
          return NextResponse.json({ error: "No such pick." }, { status: 404 });
        }

        if (pred.status !== "pending") {
          return NextResponse.json(
            {
              error: "That pick is settled and its tier is part of the published record. Moving it would rewrite the hit rate on /history.",
            },
            { status: 409 },
          );
        }

        const { data: orders } = await db
          .from("extra_pick_orders")
          .select("id")
          .eq("status", "active")
          .contains("fixture_ids", [pred.fixture_id]);

        if (orders?.length) {
          return NextResponse.json(
            {
              error: `${orders.length} customer${orders.length === 1 ? " has" : "s have"} paid for this game. Moving it would take it off ${orders.length === 1 ? "their" : "their"} list with no trace.`,
            },
            { status: 409 },
          );
        }

        const { count: legs } = await db
          .from("slip_legs")
          .select("id", { count: "exact", head: true })
          .eq("prediction_id", body.predictionId);

        if (legs && legs > 0 && body.tier === "extra") {
          return NextResponse.json(
            {
              error: `${legs} customer slip${legs === 1 ? " has" : "s have"} this pick. Moving it to extras would put something they are already holding behind the paywall.`,
            },
            { status: 409 },
          );
        }

        const { error } = await db
          .from("predictions")
          .update({ tier: body.tier })
          .eq("id", body.predictionId);
        if (error) throw new Error(error.message);

        return NextResponse.json({ moved: true, tier: body.tier });
      }

      case "gradeResults":
        return NextResponse.json(await runAutoGrade());

      case "clvCheck":
        return NextResponse.json(await runClvCheck());

      case "recalibrate":
        return NextResponse.json(await runRecalibration());

      case "approveReport": {
        // Proposals are read off the stored report, so the client can't slip in
        // changes that were never reviewed.
        const { error } = await db.rpc("apply_tuning_report", {
          p_report_id: body.reportId,
          p_approver: actor,
        });
        if (error) throw new Error(error.message);
        return NextResponse.json({ approved: true });
      }

      case "rejectReport": {
        const { error } = await db
          .from("tuning_reports")
          .update({
            status: "rejected",
            approved_by: actor,
            approved_at: new Date().toISOString(),
            rejection_reason: body.reason ?? null,
          })
          .eq("id", body.reportId)
          .eq("status", "pending");
        if (error) throw new Error(error.message);
        return NextResponse.json({ rejected: true });
      }

      case "setUserFlags": {
        // An admin must not be able to strip their own admin flag and lock
        // everyone out of the Office.
        if (body.userId === guard.user.id && body.isSuperAdmin === false) {
          return NextResponse.json(
            { error: "You can't remove your own admin access." },
            { status: 400 },
          );
        }

        const patch: Record<string, boolean> = {};
        if (body.isSuspended !== undefined) patch.is_suspended = body.isSuspended;
        if (body.isSuperAdmin !== undefined) patch.is_super_admin = body.isSuperAdmin;

        const { error } = await db.from("profiles").update(patch).eq("id", body.userId);
        if (error) throw new Error(error.message);
        return NextResponse.json({ updated: true });
      }

      case "setFixtureResult": {
        // Entering a score settles the fixture AND re-grades every pending
        // prediction on it, using the same grader the cron uses, so a manual
        // correction can't diverge from automatic grading.
        const { error: fErr } = await db
          .from("fixtures")
          .update({
            status: "finished",
            home_goals: body.homeGoals,
            away_goals: body.awayGoals,
            ht_home_goals: body.htHomeGoals ?? null,
            ht_away_goals: body.htAwayGoals ?? null,
            ended_at: new Date().toISOString(),
          })
          .eq("id", body.fixtureId);
        if (fErr) throw new Error(fErr.message);

        const { data: preds } = await db
          .from("predictions")
          .select("id, prediction_type, predicted_value")
          .eq("fixture_id", body.fixtureId)
          .in("status", ["pending", "review_needed"]);

        let graded = 0;
        for (const p of preds ?? []) {
          const outcome = gradePrediction(
            p.prediction_type as Market,
            p.predicted_value,
            body.homeGoals,
            body.awayGoals,
            body.htHomeGoals ?? null,
            body.htAwayGoals ?? null,
          );
          await db
            .from("predictions")
            .update({
              status: outcome,
              settled_at: new Date().toISOString(),
              actual_result: {
                homeGoals: body.homeGoals,
                awayGoals: body.awayGoals,
                htHomeGoals: body.htHomeGoals ?? null,
                htAwayGoals: body.htAwayGoals ?? null,
              },
              manual_override: true,
              override_reason: `Result entered manually by ${actor}`,
            })
            .eq("id", p.id);
          graded++;
        }

        return NextResponse.json({ settled: true, graded });
      }

      case "overridePrediction": {
        // Records WHO and WHY, an override with no audit trail is worse than
        // no override, because nobody can tell later whether it was justified.
        const { error } = await db
          .from("predictions")
          .update({
            status: body.status,
            manual_override: true,
            override_reason: `${body.reason}, ${actor}`,
            settled_at:
              body.status === "pending" ? null : new Date().toISOString(),
            void_reason: body.status === "void" ? body.reason : null,
          })
          .eq("id", body.predictionId);
        if (error) throw new Error(error.message);
        return NextResponse.json({ overridden: true });
      }

      case "updateWeights": {
        const sum = Object.values(body.rankingWeights).reduce((a, b) => a + b, 0);
        if (Math.abs(sum - 1) > 0.001) {
          return NextResponse.json(
            { error: `Weights must sum to 1.0, yours sum to ${sum.toFixed(3)}.` },
            { status: 400 },
          );
        }

        const patch: Record<string, unknown> = {
          ranking_weights: body.rankingWeights,
          last_updated_at: new Date().toISOString(),
          approved_by: actor,
        };
        if (body.confidenceThresholds) {
          patch.confidence_thresholds = body.confidenceThresholds;
        }

        const { error } = await db
          .from("ai_engine_config")
          .update(patch)
          .eq("id", body.configId);
        if (error) throw new Error(error.message);
        return NextResponse.json({ updated: true });
      }

      /**
       * Edit the gated overlay thresholds.
       *
       * Ranking weights are refused here on purpose: they must sum to 1.0 and
       * updateWeights is the action that enforces it. Letting a second path
       * write them would make that invariant depend on which screen you used.
       */
      case "updateVariables": {
        const unknown = Object.keys(body.values).filter((k) => !VARIABLES_BY_KEY.has(k));
        if (unknown.length) {
          return NextResponse.json(
            { error: `Not engine variables: ${unknown.join(", ")}` },
            { status: 400 },
          );
        }

        const weightKeys = Object.keys(body.values).filter(
          (k) => VARIABLES_BY_KEY.get(k)!.unit === "weight",
        );
        if (weightKeys.length) {
          return NextResponse.json(
            { error: "Ranking weights are edited on the weights panel, which checks they sum to 1." },
            { status: 400 },
          );
        }

        // Unit mismatches are rejected rather than coerced. A market id that
        // arrives as a number, or a percent as a string, is a bug upstream and
        // writing it would surface later as an unrenderable prompt.
        for (const [key, value] of Object.entries(body.values)) {
          const variable = VARIABLES_BY_KEY.get(key)!;
          const wantsString = variable.unit === "market";
          if (wantsString !== (typeof value === "string")) {
            return NextResponse.json(
              {
                error: `${key} expects ${wantsString ? "a market id" : "a number"}, got ${typeof value}.`,
              },
              { status: 400 },
            );
          }
        }

        const { data: config, error: readErr } = await db
          .from("ai_engine_config")
          .select("*")
          .eq("id", body.configId)
          .maybeSingle();
        if (readErr) throw new Error(readErr.message);
        if (!config) {
          return NextResponse.json({ error: "No such config." }, { status: 404 });
        }
        if (config.status === "archived") {
          return NextResponse.json(
            { error: "That config is archived. Roll it back before editing it." },
            { status: 409 },
          );
        }

        // Validate against the whole resolved table, not just the edits: a
        // scale error is only visible next to the variables it sits among.
        const merged = applyVariableEdits(config, body.values);
        const { values: resolved } = resolveEngineVariables({ ...config, ...merged });
        const blocking = validateEngineVariables(resolved).filter((w) => w.key in body.values);
        if (blocking.length) {
          return NextResponse.json(
            { error: blocking.map((w) => `${w.key}: ${w.message}`).join(" ") },
            { status: 400 },
          );
        }

        const { error } = await db
          .from("ai_engine_config")
          .update({
            ...merged,
            last_updated_at: new Date().toISOString(),
            approved_by: actor,
          })
          .eq("id", body.configId);
        if (error) throw new Error(error.message);

        return NextResponse.json({
          updated: true,
          changed: Object.keys(body.values).length,
          buckets: Object.keys(merged),
        });
      }

      case "setFxFallback": {
        const { error } = await db.rpc("set_fx_fallback", { p_rate: body.rate });
        if (error) throw new Error(error.message);

        // The reader caches for a minute; without this the operator changes the
        // rate, reloads, and sees the old one staring back.
        clearFxFallbackCache();
        return NextResponse.json({ updated: true, fx: await currentFallback() });
      }

      /* ---------------------------- catalog ---------------------------- */

      case "searchLeagues":
        return NextResponse.json({
          results: await getProviders().football.searchLeagues(body.query.trim()),
        });

      case "searchTeams":
        return NextResponse.json({
          results: await getProviders().football.searchTeams(body.query.trim()),
        });

      /*
       * Import a league AND its squad list in one action.
       *
       * These used to be two clicks: "Import" wrote the league row, then "Pull
       * teams" had to be found and pressed afterwards. A league with no teams
       * is not a usable catalogue entry — fixtures reference teams, so the
       * daily fetch has nothing to attach a match to — which made the second
       * click mandatory and easy to forget. Nobody imports a league because
       * they want an empty one.
       *
       * The team pull is deliberately NOT fatal. If the league saved and the
       * squad call failed, the league is still legitimately imported and the
       * operator can retry the teams; throwing here would roll the whole thing
       * back in the UI while the row sat in the database, which is the worst of
       * both. The response says which half happened.
       */
      case "importLeague": {
        const { data, error } = await db
          .from("leagues")
          .upsert(
            {
              external_id: body.externalId,
              name: body.name.trim(),
              slug: slugify(body.name),
              country: body.country.trim(),
              season: body.season,
              logo: body.logo ?? leagueBadgeUrl(body.externalId),
              is_active: true,
            },
            { onConflict: "external_id" },
          )
          .select("id, name")
          .single();
        if (error) throw new Error(error.message);

        let teamsImported = 0;
        let teamsError: string | null = null;

        if (body.season) {
          try {
            const teams = await getProviders().football.fetchTeamsByLeague(
              body.externalId,
              body.season,
            );
            if (teams.length) {
              const { error: teamErr } = await db.from("teams").upsert(
                teams.map((t) => ({
                  external_id: t.externalId,
                  league_id: data.id,
                  name: t.name,
                  short_name: (t.shortName || autoShortName(t.name)).toUpperCase(),
                  slug: slugify(t.name),
                  logo: t.logo ?? teamCrestUrl(t.externalId),
                  is_active: true,
                })),
                { onConflict: "external_id" },
              );
              if (teamErr) throw new Error(teamErr.message);
              teamsImported = teams.length;
            }
          } catch (err) {
            teamsError = err instanceof Error ? err.message : "Could not pull teams.";
            console.error("[office] importLeague: team pull failed:", err);
          }
        }

        return NextResponse.json({ league: data, teamsImported, teamsError });
      }

      case "importTeams": {
        // Composes the catalogue lookup with the upsert, because importing one
        // team at a time is not a thing anyone wants to do 20 times.
        const teams = await getProviders().football.fetchTeamsByLeague(
          body.leagueExternalId,
          body.season,
        );
        if (!teams.length) {
          return NextResponse.json({ imported: 0, found: 0 });
        }

        const { error } = await db.from("teams").upsert(
          teams.map((t) => ({
            external_id: t.externalId,
            league_id: body.leagueId,
            name: t.name,
            short_name: (t.shortName || autoShortName(t.name)).toUpperCase(),
            slug: slugify(t.name),
            // Fall back to the CDN path derived from the id. It needs no key
            // and no request, so a provider that omits artwork still yields a
            // crest rather than a monogram.
            logo: t.logo ?? teamCrestUrl(t.externalId),
            is_active: true,
          })),
          { onConflict: "external_id" },
        );
        if (error) throw new Error(error.message);
        return NextResponse.json({ imported: teams.length, found: teams.length });
      }

      case "createLeague": {
        const { data, error } = await db
          .from("leagues")
          .insert({
            name: body.name.trim(),
            slug: slugify(body.name),
            country: body.country.trim(),
            season: body.season ?? null,
            is_active: true,
          })
          .select("id, name")
          .single();
        if (error) throw new Error(error.message);
        return NextResponse.json({ league: data });
      }

      case "updateLeague": {
        const patch: Record<string, unknown> = {};
        if (body.name !== undefined) {
          patch.name = body.name.trim();
          patch.slug = slugify(body.name);
        }
        if (body.country !== undefined) patch.country = body.country.trim();
        if (body.season !== undefined) patch.season = body.season;
        if (body.isActive !== undefined) patch.is_active = body.isActive;

        const { error } = await db.from("leagues").update(patch).eq("id", body.leagueId);
        if (error) throw new Error(error.message);
        return NextResponse.json({ updated: true });
      }

      case "createTeam": {
        const { data, error } = await db
          .from("teams")
          .insert({
            league_id: body.leagueId,
            name: body.name.trim(),
            short_name: (body.shortName?.trim() || autoShortName(body.name)).toUpperCase(),
            slug: slugify(body.name),
            is_active: true,
          })
          .select("id, name")
          .single();
        if (error) throw new Error(error.message);
        return NextResponse.json({ team: data });
      }

      case "updateTeam": {
        const patch: Record<string, unknown> = {};
        if (body.name !== undefined) {
          patch.name = body.name.trim();
          patch.slug = slugify(body.name);
        }
        if (body.shortName !== undefined) {
          patch.short_name = body.shortName.trim().toUpperCase();
        }
        if (body.leagueId !== undefined) patch.league_id = body.leagueId;
        if (body.isActive !== undefined) patch.is_active = body.isActive;

        const { error } = await db.from("teams").update(patch).eq("id", body.teamId);
        if (error) throw new Error(error.message);
        return NextResponse.json({ updated: true });
      }

      case "deleteTeam": {
        // Fixtures reference teams with no ON DELETE rule, so a team with
        // history can't be removed. Say that plainly instead of letting a raw
        // foreign-key violation reach the operator.
        const { count } = await db
          .from("fixtures")
          .select("id", { count: "exact", head: true })
          .or(`home_team_id.eq.${body.teamId},away_team_id.eq.${body.teamId}`);

        if (count && count > 0) {
          return NextResponse.json(
            {
              error: `This team has ${count} fixture${count === 1 ? "" : "s"} on record. Deactivate it instead, deleting would take that history with it.`,
            },
            { status: 409 },
          );
        }

        const { error } = await db.from("teams").delete().eq("id", body.teamId);
        if (error) throw new Error(error.message);
        return NextResponse.json({ deleted: true });
      }

      case "setSelectedLeagues": {
        // These are API-Football league ids, not our uuids, the daily fetch
        // passes them straight through to the provider.
        const { error } = await db
          .from("ai_engine_config")
          .update({
            selected_league_ids: body.leagueExternalIds,
            last_updated_at: new Date().toISOString(),
            approved_by: actor,
          })
          .eq("id", body.configId);
        if (error) throw new Error(error.message);
        return NextResponse.json({ updated: true, count: body.leagueExternalIds.length });
      }

      /* -------------------- engine config lifecycle -------------------- */

      case "createDraftConfig": {
        // Copy the source row wholesale rather than naming each column: the
        // config is thirty-odd tuning fields and a draft that silently omits
        // one is worse than no draft at all.
        const { data: source, error: readErr } = await db
          .from("ai_engine_config")
          .select("*")
          .eq("id", body.fromConfigId)
          .single();
        if (readErr) throw new Error(readErr.message);

        // Drop only the columns the new row must own: its identity and its
        // birthday. Everything else is deliberately carried across.
        const rest = { ...(source as Record<string, unknown>) };
        delete rest.id;
        delete rest.created_at;

        const { data, error } = await db
          .from("ai_engine_config")
          .insert({
            ...rest,
            name: body.name.trim(),
            version: nextVersion(String(rest.version ?? "1.0.0")),
            status: "draft",
            notes: body.notes ?? null,
            approved_by: actor,
            last_updated_at: new Date().toISOString(),
          })
          .select("id, name, version")
          .single();
        if (error) throw new Error(error.message);
        return NextResponse.json({ draft: data });
      }

      case "activateConfig": {
        // A partial unique index enforces one active row, so the incumbent has
        // to step down before the successor steps up. Two statements, and a
        // failure between them leaves nothing active, which the daily job
        // treats as "no config" and skips, rather than running on the wrong one.
        const { error: demote } = await db
          .from("ai_engine_config")
          .update({ status: "archived" })
          .eq("status", "active")
          .neq("id", body.configId);
        if (demote) throw new Error(demote.message);

        const { error } = await db
          .from("ai_engine_config")
          .update({
            status: "active",
            approved_by: actor,
            last_updated_at: new Date().toISOString(),
          })
          .eq("id", body.configId);
        if (error) throw new Error(error.message);
        return NextResponse.json({ activated: true });
      }

      case "archiveConfig": {
        const { data: target } = await db
          .from("ai_engine_config")
          .select("status")
          .eq("id", body.configId)
          .single();

        if (target?.status === "active") {
          return NextResponse.json(
            { error: "That's the live config. Activate another one first." },
            { status: 409 },
          );
        }

        const { error } = await db
          .from("ai_engine_config")
          .update({ status: "archived" })
          .eq("id", body.configId);
        if (error) throw new Error(error.message);
        return NextResponse.json({ archived: true });
      }

      /* ---------------------- user management ---------------------- */

      case "grantPass": {
        // Comped passes carry no payment_id, that column is what ties a pass
        // to money, and a gift has none. Amount 0 keeps revenue reporting
        // honest rather than inflating it with passes nobody paid for.
        const rows = Array.from({ length: body.days }, (_, i) => {
          const d = new Date();
          d.setUTCDate(d.getUTCDate() + i);
          return {
            user_id: body.userId,
            date_key: d.toISOString().slice(0, 10),
            amount_usd: 0,
            status: "active" as const,
          };
        });

        const { error } = await db.from("daily_passes").upsert(rows, {
          onConflict: "user_id,date_key",
        });
        if (error) throw new Error(error.message);
        return NextResponse.json({ granted: body.days });
      }

      case "revokePass": {
        const { error } = await db
          .from("daily_passes")
          .update({ status: "expired" })
          .eq("user_id", body.userId)
          .eq("status", "active");
        if (error) throw new Error(error.message);
        return NextResponse.json({ revoked: true });
      }

      case "updateUserProfile": {
        const patch: Record<string, unknown> = {};
        if (body.displayName !== undefined) patch.display_name = body.displayName;
        if (body.phone !== undefined) patch.phone = body.phone;

        const { error } = await db.from("profiles").update(patch).eq("id", body.userId);
        if (error) throw new Error(error.message);
        return NextResponse.json({ updated: true });
      }

      case "refundPayment": {
        // The Terms commit to a refund when a pass is charged in error or when
        // we fail to publish on a day someone paid for. Until now both were a
        // manual Paystack operation with nothing linking it back to the
        // payments row, so our revenue figures drifted the first time one
        // happened. Access is revoked in the same call.
        const out = await refundPayment(body.reference, {
          reason: body.reason,
          actor,
        });
        if (!out.ok) {
          return NextResponse.json({ error: out.reason }, { status: out.status });
        }
        return NextResponse.json({
          refunded: true,
          alreadyRefunded: out.alreadyActive,
          purpose: out.purpose,
        });
      }

      case "deleteUser": {
        // Refuse to delete an admin, including yourself. Locking every operator
        // out of the Office is not a mistake anyone should be able to make in
        // one click, and the recovery is a database console.
        const { data: target } = await db
          .from("profiles")
          .select("is_super_admin, email")
          .eq("id", body.userId)
          .single();

        if (target?.is_super_admin) {
          return NextResponse.json(
            { error: "That account is an admin. Remove the flag in the database first." },
            { status: 409 },
          );
        }

        // Deleting the auth user cascades to profiles, slips, passes and
        // payments through the foreign keys.
        const { error } = await db.auth.admin.deleteUser(body.userId);
        if (error) throw new Error(error.message);
        return NextResponse.json({ deleted: true, email: target?.email ?? null });
      }
    }
  } catch (err) {
    console.error("[office]", body.action, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Action failed." },
      { status: 500 },
    );
  }
}


/* ------------------------------ audit helpers ------------------------------ */

/** What the action acts on, for grouping the log by subject. */
/**
 * Which of these fixtures have a pick sitting on somebody's slip.
 *
 * Two hops, because there is no direct link: slip_legs points at a prediction
 * and a prediction points at a fixture. Done as two queries rather than a join
 * so the second one is skipped entirely when no fixture in the set has been
 * predicted, which is the common case for a board being pruned before a run.
 *
 * Returns fixture id -> number of slip legs, so a refusal can say how many
 * people are actually affected rather than just that someone is.
 */
async function slippedFixtures(
  db: ReturnType<typeof createServiceClient>,
  fixtureIds: string[],
): Promise<Map<string, number>> {
  const blocked = new Map<string, number>();
  if (!fixtureIds.length) return blocked;

  const { data: preds } = await db
    .from("predictions")
    .select("id, fixture_id")
    .in("fixture_id", fixtureIds);

  if (!preds?.length) return blocked;

  const fixtureOf = new Map(preds.map((p) => [p.id as string, p.fixture_id as string]));

  const { data: legs } = await db
    .from("slip_legs")
    .select("prediction_id")
    .in("prediction_id", [...fixtureOf.keys()]);

  for (const leg of legs ?? []) {
    const fixtureId = fixtureOf.get(leg.prediction_id as string);
    if (!fixtureId) continue;
    blocked.set(fixtureId, (blocked.get(fixtureId) ?? 0) + 1);
  }

  return blocked;
}

function targetTypeOf(action: string): string {
  if (action.endsWith("User") || action === "grantPass" || action === "revokePass") {
    return "user";
  }
  if (action.includes("Config") || action.includes("Weights") || action.includes("Prompt")) {
    return "engine_config";
  }
  if (action.includes("Prediction") || action === "gradeFixture") return "prediction";
  if (action.includes("Fixture")) return "fixture";
  if (action.includes("Report")) return "tuning_report";
  if (action.includes("League") || action.includes("Team")) return "catalog";
  return "other";
}

function targetIdOf(body: Record<string, unknown>): string | null {
  for (const key of ["userId", "configId", "predictionId", "fixtureId", "reportId", "leagueId", "teamId"]) {
    const v = body[key];
    if (typeof v === "string") return v;
  }
  return null;
}

/**
 * The action's payload, minus anything that should not be duplicated into a log.
 *
 * The system prompt is the obvious one: writing every draft of it into an
 * append-only table would copy the product's core IP into a second place for no
 * investigative benefit. The fact that it changed, and who changed it, is the
 * part worth keeping.
 */
function redactForAudit(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === "action") continue;
    if (k === "systemPrompt" || k === "code") {
      out[k] = typeof v === "string" ? `[redacted, ${v.length} chars]` : "[redacted]";
      continue;
    }
    out[k] = v;
  }
  return out;
}
