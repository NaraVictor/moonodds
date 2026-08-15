import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSuperAdmin } from "@/lib/api-auth";
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
import type { Market } from "@/lib/types";
import { runClvCheck, runRecalibration } from "@/lib/tuning";

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
 * One route with a discriminated action rather than a dozen endpoints — every
 * one of these needs the identical super-admin guard, and putting that in one
 * place means it cannot be forgotten on a new action.
 */

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("fetchFixtures"), date: z.string().optional() }),
  z.object({ action: z.literal("fetchStats") }),
  z.object({ action: z.literal("generatePicks") }),
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
  z.object({
    action: z.literal("setSelectedLeagues"),
    configId: z.uuid(),
    leagueExternalIds: z.array(z.number().int().positive()).max(60),
  }),
]);

export const maxDuration = 300;

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

  try {
    switch (body.action) {
      case "fetchFixtures":
        return NextResponse.json(
          await runFetchFixtures(body.date ?? new Date().toISOString().slice(0, 10)),
        );

      case "fetchStats":
        return NextResponse.json(await runFetchStats());

      case "generatePicks":
        return NextResponse.json(await runDailyPicks());

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
        // prediction on it, using the same grader the cron uses — so a manual
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
        // Records WHO and WHY — an override with no audit trail is worse than
        // no override, because nobody can tell later whether it was justified.
        const { error } = await db
          .from("predictions")
          .update({
            status: body.status,
            manual_override: true,
            override_reason: `${body.reason} — ${actor}`,
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
            { error: `Weights must sum to 1.0 — yours sum to ${sum.toFixed(3)}.` },
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

      /* ---------------------------- catalog ---------------------------- */

      case "searchLeagues":
        return NextResponse.json({
          results: await getProviders().football.searchLeagues(body.query.trim()),
        });

      case "searchTeams":
        return NextResponse.json({
          results: await getProviders().football.searchTeams(body.query.trim()),
        });

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
              logo: body.logo ?? null,
              is_active: true,
            },
            { onConflict: "external_id" },
          )
          .select("id, name")
          .single();
        if (error) throw new Error(error.message);
        return NextResponse.json({ league: data });
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
            logo: t.logo,
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
              error: `This team has ${count} fixture${count === 1 ? "" : "s"} on record. Deactivate it instead — deleting would take that history with it.`,
            },
            { status: 409 },
          );
        }

        const { error } = await db.from("teams").delete().eq("id", body.teamId);
        if (error) throw new Error(error.message);
        return NextResponse.json({ deleted: true });
      }

      case "setSelectedLeagues": {
        // These are API-Football league ids, not our uuids — the daily fetch
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
    }
  } catch (err) {
    console.error("[office]", body.action, err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Action failed." },
      { status: 500 },
    );
  }
}
