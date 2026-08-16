import { MARKETS, GRADEABLE_MARKETS } from "@/lib/types";

/**
 * The engine's output contract.
 *
 * Defined once, here, and consumed three ways: as the TypeScript type the
 * pipeline reads, as the JSON schema the live provider constrains generation
 * with, and as the shape the mock provider fabricates. Before this file those
 * three disagreed, the schema allowed five camelCase filter flags with
 * `additionalProperties: false`, the prompt asked for thirty-three snake_case
 * ones, and the mock produced a fourth thing. Under structured outputs that
 * does not degrade gracefully; it fails or silently drops the difference.
 */

/**
 * Filter flags, in the order the prompt introduces them.
 *
 * snake_case throughout, matching the prompt text rather than the camelCase
 * the old schema used, because an operator reading `filters_applied` in the
 * database should see the same names they read in the prompt.
 */
export const FILTER_FLAGS = [
  // Systemic
  "chaos_filter",
  "red_card_carryover",
  "valverde_mitigation",
  "capitulation_applied",
  // Market
  "market_opposed",
  // Contextual
  "travel_penalty",
  "rest_cap",
  "surface_boost",
  "motivation_gap",
  // Environmental
  "wind_penalty",
  "extreme_wind",
  "altitude_penalty",
  "heat_penalty",
  "cold_penalty",
  "precipitation_penalty",
  "referee_overlay_applied",
  // Personnel
  "keyman_tier1_absent",
  "keyman_tier2_absent",
  "keyman_tier3_absent",
  "yellow_card_suspension",
  "return_from_injury",
  "positional_cascade",
  "squad_depth_warning",
  "squad_crisis",
  // Form and H2H
  "venue_h2h_risk",
  "recent_h2h_dominance",
  "home_form_divergence",
  "away_form_divergence",
  "quality_form_divergence_home",
  "quality_form_divergence_away",
  "low_sample_warning",
  // Caps and overrides
  "anchor_cap_applied",
  "personnel_cap_applied",
  "global_cap_applied",
  "consistency_override",
] as const;

export type FilterFlag = (typeof FILTER_FLAGS)[number];
export type FiltersApplied = Partial<Record<FilterFlag, boolean>>;

export type Trajectory = "Positive" | "Negative" | "Neutral";
export type MraSignal = "Stable" | "Overperforming" | "Underperforming";
export type PlayerTier = "Tier1" | "Tier2" | "Tier3" | "Starter" | "None";
export type RefereeProfile = "Card-Heavy" | "Lenient" | "Foul-Heavy" | "Neutral" | "Unknown";

export type EnvironmentalLog = {
  windSpeedKmh: number | null;
  altitudeMetres: number | null;
  temperatureCelsius: number | null;
  refereeProfile: RefereeProfile;
  refAvgYellows: number | null;
  refAvgFouls: number | null;
};

export type H2hLog = {
  meetingsAnalysed: number;
  weightedScoreHome: number | null;
  weightedScoreAway: number | null;
  venueH2HRecord: string | null;
  recentH2HDominant: string | null;
  lowSampleWarning: boolean;
};

export type FormLog = {
  homeFormWindow: string | null;
  awayFormWindow: string | null;
  homeTrajectory: Trajectory;
  awayTrajectory: Trajectory;
  homeQualityFormScore: number | null;
  awayQualityFormScore: number | null;
};

export type PersonnelLog = {
  totalAbsencesHome: number;
  totalAbsencesAway: number;
  suspendedPlayerTierHome: PlayerTier;
  suspendedPlayerTierAway: PlayerTier;
  returnFromInjuryHome: boolean;
  returnFromInjuryAway: boolean;
  positionalCascadeHome: boolean;
  positionalCascadeAway: boolean;
  cascadePositionHome: string | null;
  cascadePositionAway: string | null;
  personnelPenaltyRaw: number;
  personnelPenaltyCapped: boolean;
};

export type PenaltyLog = {
  globalPenaltyRaw: number;
  globalPenaltyApplied: number;
  globalPenaltyCapped: boolean;
};

/** What the engine returns for one fixture. Shape enforced by structured outputs. */
export type EnginePick = {
  fixtureIndex: number;
  predictionType: (typeof MARKETS)[number];
  predictedValue: string;
  confidenceScore: number;
  /** Pre-anchoring. The gap between this and confidenceScore is the calibration. */
  confidenceRaw?: number;
  anchorCapApplied?: boolean;
  anchorCapReason?: string | null;
  consistencyOverride?: boolean;
  originalPredictedValue?: string | null;
  overrideReason?: string | null;
  stakingUnit?: number;
  /**
   * Set when Step 3 identified a no-bet zone. The fixture is still returned,
   * a missing index is indistinguishable from a truncated response, but the
   * pipeline discards it rather than publishing.
   */
  noBetZone?: boolean;
  noBetZoneReason?: string | null;
  reasoning: string;
  reasoningTags: string[];
  mraSignalHome?: MraSignal;
  mraSignalAway?: MraSignal;
  filtersApplied?: FiltersApplied;
  environmentalLog?: EnvironmentalLog;
  h2hLog?: H2hLog;
  formLog?: FormLog;
  personnelLog?: PersonnelLog;
  penaltyLog?: PenaltyLog;
  altMarket?: (typeof MARKETS)[number];
  altPredictedValue?: string;
  altConfidence?: number;
};

/* -------------------------------------------------------------------------
 * JSON schema
 *
 * Generated from the same constants as the types above, so a flag added to
 * FILTER_FLAGS reaches the model without a second edit. Only the fields the
 * pipeline cannot work without are `required`; the logs are optional so a
 * fixture with nothing to report is not forced to invent structure.
 * ---------------------------------------------------------------------- */

const bool = { type: "boolean" } as const;
const nullableNumber = { type: ["number", "null"] } as const;
const nullableString = { type: ["string", "null"] } as const;

function objectOf(properties: Record<string, unknown>, required: string[]) {
  return { type: "object", additionalProperties: false, required, properties } as const;
}

export const PICK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["picks"],
  properties: {
    picks: {
      type: "array",
      items: objectOf(
        {
          fixtureIndex: { type: "integer" },
          predictionType: { type: "string", enum: [...GRADEABLE_MARKETS] },
          predictedValue: { type: "string" },
          confidenceScore: { type: "number" },
          confidenceRaw: { type: "number" },
          anchorCapApplied: bool,
          anchorCapReason: nullableString,
          consistencyOverride: bool,
          originalPredictedValue: nullableString,
          overrideReason: nullableString,
          stakingUnit: { type: "integer" },
          noBetZone: bool,
          noBetZoneReason: nullableString,
          reasoning: { type: "string" },
          reasoningTags: { type: "array", items: { type: "string" } },
          mraSignalHome: { type: "string", enum: ["Stable", "Overperforming", "Underperforming"] },
          mraSignalAway: { type: "string", enum: ["Stable", "Overperforming", "Underperforming"] },
          filtersApplied: objectOf(
            Object.fromEntries(FILTER_FLAGS.map((f) => [f, bool])),
            [],
          ),
          environmentalLog: objectOf(
            {
              windSpeedKmh: nullableNumber,
              altitudeMetres: nullableNumber,
              temperatureCelsius: nullableNumber,
              refereeProfile: {
                type: "string",
                enum: ["Card-Heavy", "Lenient", "Foul-Heavy", "Neutral", "Unknown"],
              },
              refAvgYellows: nullableNumber,
              refAvgFouls: nullableNumber,
            },
            ["refereeProfile"],
          ),
          h2hLog: objectOf(
            {
              meetingsAnalysed: { type: "integer" },
              weightedScoreHome: nullableNumber,
              weightedScoreAway: nullableNumber,
              venueH2HRecord: nullableString,
              recentH2HDominant: nullableString,
              lowSampleWarning: bool,
            },
            ["meetingsAnalysed", "lowSampleWarning"],
          ),
          formLog: objectOf(
            {
              homeFormWindow: nullableString,
              awayFormWindow: nullableString,
              homeTrajectory: { type: "string", enum: ["Positive", "Negative", "Neutral"] },
              awayTrajectory: { type: "string", enum: ["Positive", "Negative", "Neutral"] },
              homeQualityFormScore: nullableNumber,
              awayQualityFormScore: nullableNumber,
            },
            ["homeTrajectory", "awayTrajectory"],
          ),
          personnelLog: objectOf(
            {
              totalAbsencesHome: { type: "integer" },
              totalAbsencesAway: { type: "integer" },
              suspendedPlayerTierHome: { type: "string", enum: ["Tier1", "Tier2", "Tier3", "Starter", "None"] },
              suspendedPlayerTierAway: { type: "string", enum: ["Tier1", "Tier2", "Tier3", "Starter", "None"] },
              returnFromInjuryHome: bool,
              returnFromInjuryAway: bool,
              positionalCascadeHome: bool,
              positionalCascadeAway: bool,
              cascadePositionHome: nullableString,
              cascadePositionAway: nullableString,
              personnelPenaltyRaw: { type: "number" },
              personnelPenaltyCapped: bool,
            },
            ["totalAbsencesHome", "totalAbsencesAway", "personnelPenaltyRaw"],
          ),
          penaltyLog: objectOf(
            {
              globalPenaltyRaw: { type: "number" },
              globalPenaltyApplied: { type: "number" },
              globalPenaltyCapped: bool,
            },
            ["globalPenaltyRaw", "globalPenaltyApplied", "globalPenaltyCapped"],
          ),
          altMarket: { type: "string", enum: [...GRADEABLE_MARKETS] },
          altPredictedValue: { type: "string" },
          altConfidence: { type: "number" },
        },
        [
          "fixtureIndex",
          "predictionType",
          "predictedValue",
          "confidenceScore",
          "reasoning",
          "reasoningTags",
        ],
      ),
    },
  },
} as const;

/* -------------------------------------------------------------------------
 * Validation
 * ---------------------------------------------------------------------- */

/**
 * Selection strings the grader can actually settle.
 *
 * The prompt lists these explicitly, but a model that emits "Home" instead of
 * "1" produces a pick that grades `review_needed` forever, it never wins, never
 * loses, and sits in the Office queue waiting for a human. Cheaper to catch it
 * on the way in.
 */
const VALID_VALUES: Partial<Record<(typeof MARKETS)[number], readonly string[]>> = {
  "1x2": ["1", "X", "2"],
  double_chance: ["1X", "X2", "12"],
  draw_no_bet: ["1", "2"],
  over_under_1_5: ["over", "under"],
  over_under_2_5: ["over", "under"],
  over_under_3_5: ["over", "under"],
  first_half_goals: ["over", "under"],
  second_half_goals: ["over", "under"],
  // Deliberately absent: corners cannot be graded, so a corners selection is
  // rejected at the door rather than written and left unsettleable.
  btts: ["yes", "no"],
};

const HANDICAP = /^(home|away) [+-]\d+(\.\d+)?$/;
const CORRECT_SCORE = /^\d+-\d+$/;

/**
 * Normalise a selection to what `gradePrediction` parses, or reject it.
 *
 * Case and whitespace are forgiven, "Over" and "1x" are unambiguous. Anything
 * genuinely outside the vocabulary returns null and the pick is dropped.
 */
export function normalisePredictedValue(
  market: (typeof MARKETS)[number],
  raw: string,
): string | null {
  const value = raw.trim();
  if (!value) return null;

  if (market === "handicap") {
    const v = value.toLowerCase();
    return HANDICAP.test(v) ? v : null;
  }
  if (market === "correct_score") {
    return CORRECT_SCORE.test(value) ? value : null;
  }

  const allowed = VALID_VALUES[market];
  if (!allowed) return null;

  // 1x2 and double chance are the only case-sensitive ones ("X", "1X"), and
  // matching case-insensitively then returning the canonical form handles both.
  const match = allowed.find((a) => a.toLowerCase() === value.toLowerCase());
  return match ?? null;
}
