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
/**
 * The flags that fired on a fixture.
 *
 * An array, not a Partial<Record<flag, boolean>>. The record form required the
 * model to emit a value for every flag whether or not it applied, and stored
 * three dozen `false`s per pick to say nothing happened.
 */
export type FiltersApplied = FilterFlag[];

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
 * FILTER_FLAGS reaches the model without a second edit.
 *
 * EVERY PROPERTY IS REQUIRED, and that is not a tightening — it is the fix for
 * a schema the API refused outright:
 *
 *   400 invalid_request_error: Schemas contains too many optional parameters
 *   (77), which would make grammar compilation inefficient.
 *
 * Seventy-seven exactly, counted: 35 in filtersApplied alone, which declared
 * every flag optional and required none. The engine could not produce a single
 * pick, and nothing had noticed because the API plan could not fetch a fixture
 * to analyse, so daily-picks returned "no upcoming fixtures today" and never
 * reached the model at all. The first day the feed worked would have been the
 * first day this surfaced.
 *
 * Requiring them costs nothing, because absence was already representable
 * without optionality: the log fields are nullable, so "nothing to report" is
 * an explicit null rather than a missing key. That is the stronger contract
 * anyway — a null says the model considered the step and had nothing, while a
 * missing key cannot be told apart from a truncated response.
 * ---------------------------------------------------------------------- */

/*
 * WHAT IS NOT IN THIS SCHEMA, and why.
 *
 * environmentalLog and personnelLog are gone. They described Steps 5B and 6,
 * which are [GATED] on weather, referee history, lineups and injuries — none
 * of which this feed supplies at any plan tier, so the model skipped them on
 * every fixture and returned eighteen nulls per pick to say so. They were
 * stored in a metadata blob nothing reads.
 *
 * That mattered because of the third limit the API enforces, after the
 * optional-parameter and union-type ones:
 *
 *   400 invalid_request_error: The compiled grammar is too large.
 *
 * Grammar size is not a count of anything in particular; it is the whole
 * schema. Trimming eighteen properties describing data we do not have is the
 * cut that costs nothing, and it is the one to reverse first if those feeds
 * ever arrive.
 */

const bool = { type: "boolean" } as const;
const nullableNumber = { type: ["number", "null"] } as const;

/**
 * A string that may be empty, rather than a string that may be null.
 *
 * The second limit this schema hit, once the optional-parameter one was fixed:
 *
 *   400 invalid_request_error: Schemas contains too many parameters with union
 *   types (19 ...). Reduce the number of nullable or union-typed parameters
 *   (limit: 16 parameters with unions).
 *
 * Every `["string","null"]` counts as a union, and there were ten of them. The
 * split is not arbitrary: for a NUMBER, null and zero are different claims —
 * nought kilometres of wind is a measurement, no wind reading is an absence —
 * so those stay nullable and are worth the union budget. For a REASON string,
 * empty and absent say the same thing, so "" carries it at no cost.
 *
 * The pipeline turns "" back into null before storing, so the database keeps
 * one representation of absent and only the wire format differs.
 */
const emptyableString = { type: "string" } as const;

/**
 * Every key required, always.
 *
 * The `required` argument is ignored and kept only so the call sites read as
 * documentation of what the pipeline genuinely cannot work without. Passing a
 * subset is what produced 77 optional parameters and a rejected request, so
 * the choice is deliberately not available here.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function objectOf(properties: Record<string, unknown>, _required: readonly string[]) {
  return {
    type: "object",
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  } as const;
}

/**
 * Turn the schema's empty strings back into nulls.
 *
 * The model is asked for "" where a reason does not apply, because a nullable
 * string costs one of sixteen union slots the API allows. The database has no
 * such limit and should hold one representation of absent, so the two are
 * reconciled here rather than leaving `""` and `null` both meaning nothing in
 * the same column.
 *
 * Only blanks are touched. A reason of "0" or "none" is a reason the model
 * chose to give and is stored as written.
 */
export function blankToNull<T extends Record<string, unknown>>(pick: T): T {
  const out = { ...pick } as Record<string, unknown>;
  for (const [k, v] of Object.entries(out)) {
    if (typeof v === "string" && v.trim() === "") out[k] = null;
    else if (v && typeof v === "object" && !Array.isArray(v)) {
      out[k] = blankToNull(v as Record<string, unknown>);
    }
  }
  return out as T;
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
          anchorCapReason: emptyableString,
          consistencyOverride: bool,
          originalPredictedValue: emptyableString,
          overrideReason: emptyableString,
          stakingUnit: { type: "integer" },
          noBetZone: bool,
          noBetZoneReason: emptyableString,
          reasoning: { type: "string" },
          reasoningTags: { type: "array", items: { type: "string" } },
          mraSignalHome: { type: "string", enum: ["Stable", "Overperforming", "Underperforming"] },
          mraSignalAway: { type: "string", enum: ["Stable", "Overperforming", "Underperforming"] },
          /*
           * The flags that FIRED, not a boolean for every flag there is.
           *
           * This was an object of 35 required booleans, which is 35 properties
           * in the grammar and 35 values the model had to emit per fixture,
           * almost all of them false. It is the single largest contributor to
           * "the compiled grammar is too large", the third limit this schema
           * hit, and it was also the least informative shape: a list of what
           * applied says the same thing in one field.
           */
          filtersApplied: {
            type: "array",
            // Plain strings, not an enum of all 35 flags. Every enum member is
            // an alternation in the compiled grammar, and a 35-way alternation
            // inside an array inside an array is what tipped this over "the
            // compiled grammar is too large". The prompt names the flags and
            // the values are checked on the way in, so the constraint moved
            // from the grammar to the parser rather than disappearing.
            items: { type: "string" },
          },
          h2hLog: objectOf(
            {
              meetingsAnalysed: { type: "integer" },
              weightedScoreHome: nullableNumber,
              weightedScoreAway: nullableNumber,
              venueH2HRecord: emptyableString,
              recentH2HDominant: emptyableString,
              lowSampleWarning: bool,
            },
            ["meetingsAnalysed", "lowSampleWarning"],
          ),
          formLog: objectOf(
            {
              homeFormWindow: emptyableString,
              awayFormWindow: emptyableString,
              homeTrajectory: { type: "string", enum: ["Positive", "Negative", "Neutral"] },
              awayTrajectory: { type: "string", enum: ["Positive", "Negative", "Neutral"] },
              homeQualityFormScore: nullableNumber,
              awayQualityFormScore: nullableNumber,
            },
            ["homeTrajectory", "awayTrajectory"],
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
