/**
 * The engine's variable table.
 *
 * The v2.1 system prompt carries ~130 tunable numbers. Before this file they
 * lived in two incompatible places: as prose defaults inside the prompt text,
 * and as JSON in `ai_engine_config` under *different key names on a different
 * scale*. The prompt said `tier1Penalty 20` (percent); the config said
 * `keymanTier1Penalty: 0.12` (fraction). Nothing reconciled them, so the engine
 * ran on its prose defaults and the Office weight editor changed nothing.
 *
 * One table now defines every variable: its canonical key, its unit, its
 * default, and what it means. The prompt references keys as `{{key}}` and is
 * rendered before it reaches the model, so config resolution is deterministic
 * code rather than something the model is asked to do in its head.
 *
 * UNITS ARE LOAD-BEARING. Every penalty and boost is a **percent** (20 = 20%),
 * matching the v2.1 prompt text. A fraction where a percent belongs turns a 5%
 * penalty into 0.05%, which is indistinguishable from no penalty at all, so
 * `validateEngineVariables` flags it rather than guessing what was meant.
 */

export type VariableUnit =
  | "weight" // 0–1, must sum to 1 across the ranking weights
  | "percent" // 0–100, a confidence adjustment
  | "score" // 0–10, on the confidence scale
  | "count" // whole things: games, players, meetings
  | "days"
  | "km"
  | "metres"
  | "kmh"
  | "celsius"
  | "ratio" // 0–1, not a percent
  | "odds"
  | "market"; // a market id, not a number

export type VariableGroup =
  | "weights"
  | "systemic"
  | "personnel"
  | "market"
  | "contextual"
  | "environmental"
  | "referee"
  | "form"
  | "h2h"
  | "anchoring"
  | "staking"
  | "caps";

export type EngineVariable = {
  key: string;
  group: VariableGroup;
  unit: VariableUnit;
  /** Used when the active config does not supply the key. */
  fallback: number | string;
  note: string;
  /**
   * True when the variable gates an [OPTIONAL] overlay, one that fires only if
   * the fixture payload actually carries the input. These stay in the table so
   * they are tunable the day the data arrives, but on the current feed the
   * overlays they govern never run.
   */
  optionalOverlay?: boolean;
};

export const ENGINE_VARIABLES: readonly EngineVariable[] = [
  // --- Ranking weights. Must sum to 1.0. --------------------------------
  { key: "xgWeight", group: "weights", unit: "weight", fallback: 0.15, note: "Chance quality vs. goals actually scored." },
  { key: "formWeight", group: "weights", unit: "weight", fallback: 0.2, note: "Quality-adjusted form over the rolling window." },
  { key: "h2hWeight", group: "weights", unit: "weight", fallback: 0.1, note: "Recency-weighted head-to-head, venue-blended." },
  { key: "homeAdvantageWeight", group: "weights", unit: "weight", fallback: 0.1, note: "Venue effect." },
  { key: "shotsOnTargetWeight", group: "weights", unit: "weight", fallback: 0.15, note: "Shot volume and quality." },
  { key: "lineupWeight", group: "weights", unit: "weight", fallback: 0.1, note: "Confirmed XI vs. predicted XI." },
  { key: "keyManWeight", group: "weights", unit: "weight", fallback: 0.1, note: "Availability of tiered players." },
  { key: "marketEfficiencyWeight", group: "weights", unit: "weight", fallback: 0.05, note: "Distance between our number and the market's." },
  { key: "oppositionQualityWeight", group: "weights", unit: "weight", fallback: 0.05, note: "Strength of the opponents the form was built against." },

  // --- Systemic filters --------------------------------------------------
  { key: "chaosFilterWinlessGames", group: "systemic", unit: "count", fallback: 8, note: "Winless run that prohibits a 1x2 win bet on that side." },
  { key: "chaosPivotMarket", group: "systemic", unit: "market", fallback: "over_under_1_5", note: "Where a chaos-filtered fixture pivots to." },
  { key: "chaosPivotValue", group: "systemic", unit: "market", fallback: "over", note: "Selection on the chaos pivot market." },
  { key: "redCardCarryoverPenalty", group: "systemic", unit: "percent", fallback: 15, note: "Applied to any 1x2 involving a side that saw red last match." },

  // --- Personnel ---------------------------------------------------------
  { key: "tier1Penalty", group: "personnel", unit: "percent", fallback: 20, note: "Primary scorer absent." },
  { key: "tier1MitigatedPenalty", group: "personnel", unit: "percent", fallback: 5, note: "Primary scorer absent but a deputy is scoring." },
  { key: "tier1MitigationRate", group: "personnel", unit: "ratio", fallback: 0.8, note: "Deputy's scoring uplift over 2–3 games that counts as mitigation." },
  { key: "tier2Penalty", group: "personnel", unit: "percent", fallback: 10, note: "Defensive anchor absent." },
  { key: "tier3GKPenalty", group: "personnel", unit: "percent", fallback: 8, note: "Elite keeper absent." },
  { key: "suspendedStarterPenaltyPct", group: "personnel", unit: "percent", fallback: 3, note: "Untiered regular starter suspended." },
  { key: "returnFromInjuryPenaltyPct", group: "personnel", unit: "percent", fallback: 4, note: "Fitness doubt on a player back in the XI." },
  { key: "returnFromInjuryTier1PenaltyPct", group: "personnel", unit: "percent", fallback: 6, note: "Same, for a Tier 1 player." },
  { key: "positionalCascadePenaltyPct", group: "personnel", unit: "percent", fallback: 5, note: "Starter and natural deputy both out." },
  { key: "positionalCascadeAltBoostPct", group: "personnel", unit: "percent", fallback: 6, note: "Boost to the opposite goals market when a cascade hits." },
  { key: "squadDepthThreshold", group: "personnel", unit: "count", fallback: 4, note: "Absences that trigger a depth warning." },
  { key: "squadDepthPenaltyPct", group: "personnel", unit: "percent", fallback: 5, note: "Depth-warning penalty on a 1x2 win." },
  { key: "squadCrisisThreshold", group: "personnel", unit: "count", fallback: 6, note: "Absences that escalate to a crisis." },
  { key: "squadCrisisPenaltyPct", group: "personnel", unit: "percent", fallback: 10, note: "Replaces the depth penalty; not additive." },
  { key: "cumulativePenaltyCapPct", group: "caps", unit: "percent", fallback: 15, note: "Ceiling on personnel reductions combined." },
  { key: "globalPenaltyCapPct", group: "caps", unit: "percent", fallback: 35, note: "Ceiling on every reduction from every source combined." },

  // --- Market / odds -----------------------------------------------------
  { key: "lowOddsThreshold", group: "market", unit: "odds", fallback: 1.25, note: "Below this price a 1x2 win must pivot." },
  { key: "lowOddsPivotMarket", group: "market", unit: "market", fallback: "over_under_1_5", note: "Where a short-priced favourite pivots to." },
  { key: "lowOddsPivotValue", group: "market", unit: "market", fallback: "over", note: "Selection on the low-odds pivot market." },
  { key: "clvMovementThresholdPct", group: "market", unit: "percent", fallback: 5, note: "Adverse odds drift inside 2h that flags market-opposed." },
  { key: "clvPenalty", group: "market", unit: "percent", fallback: 10, note: "Applied when market-opposed fires." },
  { key: "mraOverperformThresholdPct", group: "market", unit: "percent", fallback: 30, note: "Scoring above chance quality by this much implies regression." },
  { key: "varianceTieBandScore", group: "market", unit: "score", fallback: 0.3, note: "Within this gap, the lower-variance market wins." },

  // --- Buffers and context ----------------------------------------------
  { key: "standardBufferPct", group: "contextual", unit: "percent", fallback: 7, note: "Safety buffer on stable sides." },
  { key: "capitulationBufferPct", group: "contextual", unit: "percent", fallback: 12.5, note: "Safety buffer on sides that collapse late." },
  { key: "travelDistanceThreshold", group: "contextual", unit: "km", fallback: 360, note: "Away trip beyond this draws a travel penalty." },
  { key: "travelPenaltyPct", group: "contextual", unit: "percent", fallback: 10, note: "Travel penalty on an away favourite." },
  { key: "restGameCount", group: "contextual", unit: "count", fallback: 3, note: "Matches inside the rest window that trigger fatigue." },
  { key: "restDayWindow", group: "contextual", unit: "days", fallback: 8, note: "Window the rest rule counts over." },
  { key: "restPenaltyPct", group: "contextual", unit: "percent", fallback: 5, note: "Fatigue penalty." },
  { key: "artificialTurfBoost", group: "contextual", unit: "percent", fallback: 5, note: "Goals-over boost on a known artificial pitch." },
  { key: "motivationGapBoostPct", group: "contextual", unit: "percent", fallback: 5, note: "Boost to the motivated side in a single-sided dead rubber." },

  // --- Environmental. [OPTIONAL], only fire if the value was injected. ---
  { key: "windThresholdKmh", group: "environmental", unit: "kmh", fallback: 40, note: "Wind that suppresses goals.", optionalOverlay: true },
  { key: "windOver25PenaltyPct", group: "environmental", unit: "percent", fallback: 10, note: "Over 2.5 reduction in wind.", optionalOverlay: true },
  { key: "windSetPiecePenaltyPct", group: "environmental", unit: "percent", fallback: 8, note: "Set-piece market reduction in wind.", optionalOverlay: true },
  { key: "extremeWindThresholdKmh", group: "environmental", unit: "kmh", fallback: 60, note: "Wind that suppresses goals hard.", optionalOverlay: true },
  { key: "extremeWindExtraPenaltyPct", group: "environmental", unit: "percent", fallback: 10, note: "Further reduction above the extreme threshold.", optionalOverlay: true },
  { key: "altitudeThresholdMetres", group: "environmental", unit: "metres", fallback: 1800, note: "Altitude that favours the acclimatised home side.", optionalOverlay: true },
  { key: "altitudeAwayPenaltyPct", group: "environmental", unit: "percent", fallback: 8, note: "Away-win reduction at altitude.", optionalOverlay: true },
  { key: "altitudeHomeBoostPct", group: "environmental", unit: "percent", fallback: 10, note: "Home-advantage boost at altitude, this fixture only.", optionalOverlay: true },
  { key: "altitudeUnacclimatizedPenaltyPct", group: "environmental", unit: "percent", fallback: 5, note: "Extra away reduction with no recent altitude match.", optionalOverlay: true },
  { key: "heatThresholdCelsius", group: "environmental", unit: "celsius", fallback: 32, note: "Heat that blunts a pressing side.", optionalOverlay: true },
  { key: "heatPressPenaltyPct", group: "environmental", unit: "percent", fallback: 8, note: "Reduction on the high-press side in heat.", optionalOverlay: true },
  { key: "heatOver25PenaltyPct", group: "environmental", unit: "percent", fallback: 6, note: "Over 2.5 reduction in heat.", optionalOverlay: true },
  { key: "coldThresholdCelsius", group: "environmental", unit: "celsius", fallback: 2, note: "Cold that suppresses open play.", optionalOverlay: true },
  { key: "coldOver25PenaltyPct", group: "environmental", unit: "percent", fallback: 5, note: "Over 2.5 reduction in cold.", optionalOverlay: true },
  { key: "coldSetPieceBoostPct", group: "environmental", unit: "percent", fallback: 5, note: "Set-piece boost in cold.", optionalOverlay: true },
  { key: "humidityThreshold", group: "environmental", unit: "percent", fallback: 60, note: "Humidity that pivots the primary market.", optionalOverlay: true },
  // v2.1 pivoted humidity to corners over 8.5. Corners cannot be graded by this
  // system, so that pivot produced picks that could never settle. Under 2.5 is
  // the same directional call, fewer goals in heavy air, on a market we grade.
  { key: "humidityPivotMarket", group: "environmental", unit: "market", fallback: "over_under_2_5", note: "Where a humid fixture pivots to.", optionalOverlay: true },
  { key: "humidityPivotValue", group: "environmental", unit: "market", fallback: "under", note: "Selection on the humidity pivot market.", optionalOverlay: true },
  { key: "precipitationPenalty", group: "environmental", unit: "percent", fallback: 15, note: "Over 2.5 reduction in heavy rain or snow.", optionalOverlay: true },

  // --- Referee. [OPTIONAL] ----------------------------------------------
  { key: "refCardHeavyYellowThreshold", group: "referee", unit: "count", fallback: 4.5, note: "Average yellows that make a referee card-heavy.", optionalOverlay: true },
  { key: "refCardHeavyCardsBoostPct", group: "referee", unit: "percent", fallback: 10, note: "Cards-over boost under a card-heavy referee.", optionalOverlay: true },
  { key: "refLenientYellowThreshold", group: "referee", unit: "count", fallback: 2.5, note: "Average yellows that make a referee lenient.", optionalOverlay: true },
  { key: "refLenientCardsPenaltyPct", group: "referee", unit: "percent", fallback: 8, note: "Cards-over reduction under a lenient referee.", optionalOverlay: true },
  { key: "refFoulHeavyThreshold", group: "referee", unit: "count", fallback: 28, note: "Average fouls that make a referee foul-heavy.", optionalOverlay: true },
  { key: "refFoulHeavyBoostPct", group: "referee", unit: "percent", fallback: 6, note: "Corner and set-piece boost under a foul-heavy referee.", optionalOverlay: true },

  // --- Form --------------------------------------------------------------
  { key: "formDivergenceResultsThreshold", group: "form", unit: "count", fallback: 2, note: "Result gap between split form and overall form that counts as divergence." },
  { key: "qualityFormWinTopHalf", group: "form", unit: "score", fallback: 1.5, note: "Credit for beating a top-half side." },
  { key: "qualityFormWinBottomHalf", group: "form", unit: "score", fallback: 0.75, note: "Credit for beating a bottom-half side." },
  { key: "qualityFormDrawTopHalf", group: "form", unit: "score", fallback: 0.75, note: "Credit for drawing with a top-half side." },
  { key: "qualityFormDrawBottomHalf", group: "form", unit: "score", fallback: 0.4, note: "Credit for drawing with a bottom-half side." },
  { key: "qualityFormLossTopHalf", group: "form", unit: "score", fallback: 0.5, note: "Penalty for losing to a top-half side." },
  { key: "qualityFormLossBottomHalf", group: "form", unit: "score", fallback: 1.5, note: "Penalty for losing to a bottom-half side." },
  { key: "qualityFormDivergenceThresholdPct", group: "form", unit: "percent", fallback: 15, note: "Gap from raw form that flags quality divergence." },

  // --- Head-to-head ------------------------------------------------------
  { key: "h2hRecencyWeight1", group: "h2h", unit: "score", fallback: 3.0, note: "Weight on the most recent meeting." },
  { key: "h2hRecencyWeight2", group: "h2h", unit: "score", fallback: 2.5, note: "Weight on the second-most-recent meeting." },
  { key: "h2hRecencyWeight3", group: "h2h", unit: "score", fallback: 2.0, note: "Weight on the third." },
  { key: "h2hRecencyWeight4", group: "h2h", unit: "score", fallback: 1.5, note: "Weight on the fourth." },
  { key: "h2hRecencyWeight5", group: "h2h", unit: "score", fallback: 1.0, note: "Weight on the fifth." },
  { key: "h2hRecencyWeightRest", group: "h2h", unit: "score", fallback: 0.5, note: "Weight on meetings six to ten." },
  { key: "venueH2hLowSampleGames", group: "h2h", unit: "count", fallback: 3, note: "Venue meetings below which the sample is thin." },
  { key: "venueH2hLowSampleReductionPct", group: "h2h", unit: "percent", fallback: 50, note: "Venue H2H weight cut on a thin sample." },
  { key: "venueH2hBlendPct", group: "h2h", unit: "percent", fallback: 30, note: "Venue share of the H2H composite." },
  { key: "overallH2hBlendPct", group: "h2h", unit: "percent", fallback: 70, note: "Overall share of the H2H composite." },

  // --- Anchoring ---------------------------------------------------------
  { key: "anchorTier1Score", group: "anchoring", unit: "score", fallback: 9.0, note: "Ceiling that needs the tier 1 condition count." },
  { key: "anchorTier1ConditionsRequired", group: "anchoring", unit: "count", fallback: 5, note: "Conditions that must hold to score at tier 1." },
  { key: "anchorTier1ConditionsTotal", group: "anchoring", unit: "count", fallback: 7, note: "Conditions checked at tier 1." },
  { key: "anchorTier1CapIfUnmet", group: "anchoring", unit: "score", fallback: 8.5, note: "Cap when tier 1 conditions fall short." },
  { key: "anchorTier2Score", group: "anchoring", unit: "score", fallback: 8.0, note: "Ceiling that needs every tier 2 condition." },
  { key: "anchorTier2CapIfUnmet", group: "anchoring", unit: "score", fallback: 7.5, note: "Cap when a tier 2 condition fails." },
  { key: "anchorTier3Score", group: "anchoring", unit: "score", fallback: 7.0, note: "Ceiling that needs one tier 3 condition." },
  { key: "anchorTier3CapIfUnmet", group: "anchoring", unit: "score", fallback: 6.5, note: "Cap when no tier 3 condition holds." },
  { key: "anchorDefaultRangeMin", group: "anchoring", unit: "score", fallback: 5.0, note: "Floor of the mixed-data band." },
  { key: "anchorDefaultRangeMax", group: "anchoring", unit: "score", fallback: 6.4, note: "Top of the mixed-data band. Sits below anchorTier3CapIfUnmet so the bands do not overlap." },

  // --- Staking and cutoffs ----------------------------------------------
  { key: "stakingUnit1Threshold", group: "staking", unit: "score", fallback: 5.0, note: "One unit." },
  { key: "stakingUnit2Threshold", group: "staking", unit: "score", fallback: 6.0, note: "Two units." },
  { key: "stakingUnit3Threshold", group: "staking", unit: "score", fallback: 7.0, note: "Three units." },
  { key: "stakingUnit4Threshold", group: "staking", unit: "score", fallback: 8.0, note: "Four units." },
  { key: "stakingUnit5Threshold", group: "staking", unit: "score", fallback: 9.0, note: "Five units." },
  { key: "absoluteMinimumFloor", group: "staking", unit: "score", fallback: 5.0, note: "Nothing below this is ever published." },
  { key: "primarySlipFloor", group: "staking", unit: "score", fallback: 7.0, note: "Cutoff the app applies after the engine has scored honestly." },
] as const;

export const VARIABLES_BY_KEY: ReadonlyMap<string, EngineVariable> = new Map(
  ENGINE_VARIABLES.map((v) => [v.key, v]),
);

/**
 * Config buckets searched for a variable, in order.
 *
 * Tolerant across these four on purpose: forcing an operator to remember which
 * column holds `clvPenalty` is a good way to get a silently ignored edit. First
 * bucket that carries the key wins.
 *
 * `slip_building` and `api_budget` are deliberately NOT searched. Nothing in
 * them is a prompt variable, they configure slip assembly and API quota, and
 * the app reads them directly. Including them made every one of their keys look
 * like an unrecognised engine variable, which is a warning about correct config.
 */
const LOOKUP_ORDER = [
  "ranking_weights",
  "confidence_thresholds",
  "filter_thresholds",
  "market_pivots",
] as const;

export type ConfigLike = Partial<Record<(typeof LOOKUP_ORDER)[number], unknown>> &
  Record<string, unknown>;

export type ResolvedVariables = {
  /** Every key in the table, resolved. Safe to index without a null check. */
  values: Record<string, number | string>;
  /** Keys that came from the active config. */
  overrides: string[];
  /** Keys that fell back to the table default. */
  fallbacks: string[];
  /** Config keys that match no variable, almost always a typo or a stale name. */
  unknownKeys: string[];
};

/** Resolve every variable in the table against an engine config row. */
export function resolveEngineVariables(config: ConfigLike | null | undefined): ResolvedVariables {
  const supplied = new Map<string, unknown>();

  // Later buckets must not clobber earlier ones, first hit wins.
  for (const bucket of LOOKUP_ORDER) {
    const raw = config?.[bucket];
    if (!raw || typeof raw !== "object") continue;
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (!supplied.has(k)) supplied.set(k, v);
    }
  }

  const values: Record<string, number | string> = {};
  const overrides: string[] = [];
  const fallbacks: string[] = [];

  for (const variable of ENGINE_VARIABLES) {
    const given = supplied.get(variable.key);
    if (isUsable(given, variable)) {
      values[variable.key] = given as number | string;
      overrides.push(variable.key);
    } else {
      values[variable.key] = variable.fallback;
      fallbacks.push(variable.key);
    }
  }

  const unknownKeys = [...supplied.keys()].filter((k) => !VARIABLES_BY_KEY.has(k));

  return { values, overrides, fallbacks, unknownKeys };
}

function isUsable(given: unknown, variable: EngineVariable): boolean {
  if (given == null) return false;
  if (variable.unit === "market") return typeof given === "string" && given.length > 0;
  return typeof given === "number" && Number.isFinite(given);
}

export type VariableWarning = {
  key: string;
  value: number | string;
  message: string;
};

/**
 * Catch values that are the right key on the wrong scale.
 *
 * The failure this exists for: the pre-2.1 config stored penalties as fractions
 * (`0.05` meaning 5%). Renamed into the v2.1 table without conversion, that
 * becomes a 0.05% penalty, arithmetically valid, functionally absent, and
 * invisible in every log. Better to say so.
 */
export function validateEngineVariables(values: Record<string, number | string>): VariableWarning[] {
  const warnings: VariableWarning[] = [];

  for (const variable of ENGINE_VARIABLES) {
    const value = values[variable.key];
    if (typeof value !== "number") continue;

    if (variable.unit === "percent" && value > 0 && value <= 1) {
      warnings.push({
        key: variable.key,
        value,
        message: `Reads as a fraction. This variable is a percent, 5% is 5, not 0.05. As written it applies ${value}%, which is effectively nothing.`,
      });
    }
    if (variable.unit === "percent" && value > 100) {
      warnings.push({ key: variable.key, value, message: "Above 100%." });
    }
    if (variable.unit === "score" && (value < 0 || value > 10)) {
      warnings.push({ key: variable.key, value, message: "Outside the 0–10 confidence scale." });
    }
    if (variable.unit === "weight" && (value < 0 || value > 1)) {
      warnings.push({ key: variable.key, value, message: "Ranking weights are 0–1." });
    }
  }

  const weightSum = ENGINE_VARIABLES.filter((v) => v.unit === "weight").reduce(
    (sum, v) => sum + (typeof values[v.key] === "number" ? (values[v.key] as number) : 0),
    0,
  );
  if (Math.abs(weightSum - 1) > 0.005) {
    warnings.push({
      key: "rankingWeights",
      value: Number(weightSum.toFixed(3)),
      message: `Ranking weights sum to ${weightSum.toFixed(3)}, not 1.0. Relative ranking still works, but the 0–10 confidence mapping is stretched.`,
    });
  }

  // Anchoring bands must not overlap, or two rules give a fixture two ceilings.
  const t3Cap = num(values.anchorTier3CapIfUnmet);
  const defaultMax = num(values.anchorDefaultRangeMax);
  if (t3Cap != null && defaultMax != null && defaultMax >= t3Cap) {
    warnings.push({
      key: "anchorDefaultRangeMax",
      value: defaultMax,
      message: `Overlaps anchorTier3CapIfUnmet (${t3Cap}). A mixed-data fixture would sit above the cap meant to hold it down.`,
    });
  }

  // Publishing above where staking starts means the cutoff discards bands the
  // anchoring rules spent their effort calibrating.
  const floor = num(values.primarySlipFloor);
  const unit1 = num(values.stakingUnit1Threshold);
  if (floor != null && unit1 != null && floor > unit1 + 2) {
    warnings.push({
      key: "primarySlipFloor",
      value: floor,
      message: `Staking starts at ${unit1} but nothing below ${floor} is published, so the ${unit1}–${floor} band is scored and then discarded.`,
    });
  }

  return warnings;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
