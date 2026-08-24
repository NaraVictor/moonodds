/**
 * Filter flags, in words a bettor reads.
 *
 * `filters_applied` is a free array of strings by design — the schema comment
 * in output.ts explains why an enum of 35 flags could not survive grammar
 * compilation — so what actually lands in the column is whatever the model
 * chose to call the screen it ran. In practice that is three shapes at once:
 *
 *   chaos_filter                        a canonical flag from the prompt
 *   Step_1e_weighted_h2h_applied        a step-numbered name it invented
 *   Step_5_5b_skipped_no_context_data   a step it did NOT run, and why
 *
 * The detail page used to render all three identically: a green tick and the
 * raw string with its underscores turned to spaces. That is wrong twice over.
 * It shows an operator's identifier to a customer, and — worse — it puts a tick
 * beside "skipped_no_personnel_data", claiming as a completed screen the exact
 * thing the engine could not check. Under a heading that reads "Screens the
 * model applies before it will publish a call", that is a false claim about how
 * much work went into the pick.
 *
 * So parsing happens here, once, and the two kinds come out separated: what the
 * engine checked, and what it could not check and why not.
 */

/** One flag, resolved. */
export type DescribedFilter = {
  /** The raw string, kept for keys and for the Office's own debugging. */
  raw: string;
  kind: "applied" | "unavailable";
  label: string;
  /** Plain-language expansion. Absent when the label already says everything. */
  detail?: string;
};

/**
 * Step numbers to the screen each one performs.
 *
 * These are the headings in the engine prompt, minus the jargon. They matter
 * most for skips, because a skip's own text says only "no context data" — the
 * step number is the only thing carrying WHICH screen went unrun.
 */
const STEP_LABELS: Record<string, string> = {
  "1": "Season averages and head-to-head baseline",
  "1a": "Market movement",
  "1b": "Recent form",
  "1c": "Form adjusted for opposition quality",
  "1d": "Home and away form, separately",
  "1e": "Recency-weighted head-to-head",
  "2": "Systemic filters",
  "2a": "Winless-run filter",
  "2b": "Red card carried over",
  "2c": "Deputy scorer cover",
  "3": "No-bet check",
  "4": "Probability buffer",
  "5": "Travel, rest and pitch",
  "5b": "Weather and referee",
  "6": "Team news",
  "6g": "Penalty ceiling",
  "7": "Composite scoring",
  "8": "Market selection",
  "9": "Staking",
  "9a": "Consistency check",
};

/**
 * Canonical flags to their customer-facing label and, where the name alone
 * does not carry it, what the screen actually did.
 *
 * Keys are the prompt's own snake_case names with any step prefix already
 * stripped, so `chaos_filter` and `Step_2a_chaos_filter` both land here.
 */
export const FILTER_LABELS: Record<string, { label: string; detail?: string }> = {
  // Systemic
  chaos_filter: {
    label: "Winless-run filter",
    detail: "A side on a long run without a win, so a straight win pick on them was ruled out.",
  },
  red_card_carryover: {
    label: "Red card carried over",
    detail: "A sending-off in the last match, so the suspension carries into this one.",
  },
  valverde_mitigation: {
    label: "Deputy scorer cover",
    detail: "The missing scorer's deputy has been producing, so the absence was penalised less heavily.",
  },
  capitulation_applied: {
    label: "Defensive volatility buffer",
    detail: "Concession and both-teams-scored rates mark a side as liable to collapse.",
  },

  // Market
  market_opposed: {
    label: "Market moved against us",
    detail: "The price shifted away from this call before kickoff, which usually means the market saw something we did not.",
  },

  // Contextual
  travel_penalty: { label: "Long away trip", detail: "The away side is travelling far enough for it to cost them." },
  rest_cap: { label: "Short rest", detail: "Too many matches in too few days for the side to be fresh." },
  surface_boost: { label: "Artificial pitch", detail: "Known artificial surface, which tends to raise the goal count." },
  motivation_gap: { label: "One side has more to play for", detail: "The table gives one side something at stake and the other nothing." },

  // Environmental
  wind_penalty: { label: "Strong wind" },
  extreme_wind: { label: "Extreme wind" },
  altitude_penalty: { label: "High altitude" },
  heat_penalty: { label: "High temperature" },
  cold_penalty: { label: "Low temperature" },
  precipitation_penalty: { label: "Heavy rain or snow" },
  referee_overlay_applied: {
    label: "Referee's card and foul record",
    detail: "This referee's history moves the card, corner and set-piece markets.",
  },

  // Personnel
  keyman_tier1_absent: { label: "Main scorer missing" },
  keyman_tier2_absent: { label: "Defensive anchor missing" },
  keyman_tier3_absent: { label: "First-choice keeper missing" },
  yellow_card_suspension: { label: "Regular starter suspended" },
  return_from_injury: {
    label: "Player back from injury",
    detail: "Named in the side after three weeks or more out, so treated as short of full fitness rather than absent.",
  },
  positional_cascade: {
    label: "Starter and deputy both out",
    detail: "No natural replacement in one position, which changes how the side is likely to play.",
  },
  squad_depth_warning: { label: "Squad stretched by absences" },
  squad_crisis: {
    label: "Squad crisis",
    detail: "Enough absences to move the pick away from a straight win and towards a safer market.",
  },

  // Form and head-to-head
  venue_h2h_risk: {
    label: "Poor recent record at this ground",
    detail: "The home side has lost two of the last three meetings here against this opponent.",
  },
  recent_h2h_dominance: {
    label: "Recent head-to-head dominance",
    detail: "The last three meetings all went the same way.",
  },
  home_form_divergence: {
    label: "Home form differs from overall form",
    detail: "This side's record at home is out of step with its record across all matches.",
  },
  away_form_divergence: {
    label: "Away form differs from overall form",
    detail: "This side's record away is out of step with its record across all matches.",
  },
  quality_form_divergence_home: {
    label: "Home form re-read against opposition quality",
    detail: "The raw run of results flattered or understated them once the standard of opponent was taken into account.",
  },
  quality_form_divergence_away: {
    label: "Away form re-read against opposition quality",
    detail: "The raw run of results flattered or understated them once the standard of opponent was taken into account.",
  },
  low_sample_warning: {
    label: "Thin data",
    detail: "Not enough matches behind one of the signals, so it was given less weight.",
  },

  // Caps and overrides
  anchor_cap_applied: {
    label: "Confidence capped",
    detail: "The raw score cleared a high band without meeting the conditions that band requires, so it was pulled back down.",
  },
  personnel_cap_applied: {
    label: "Absence penalties capped",
    detail: "The team-news deductions hit their combined ceiling.",
  },
  global_cap_applied: {
    label: "Total penalties capped",
    detail: "Every deduction combined hit its ceiling, so the rest were not applied.",
  },
  consistency_override: {
    label: "Call re-derived to match the reasoning",
    detail: "The selection contradicted the written argument, so the selection changed. The reasoning is never rewritten to fit a pick.",
  },

  // Names the model coins for CORE steps it did run. Not in FILTER_FLAGS, but
  // common enough in real output to be worth naming rather than prettifying.
  weighted_h2h_applied: {
    label: "Recency-weighted head-to-head",
    detail: "Recent meetings counted for more than old ones.",
  },
  standard_buffer: {
    label: "Standard probability buffer",
    detail: "The routine margin applied to every pick before any overlay.",
  },
  quality_form_applied: { label: "Form adjusted for opposition quality" },
  chaos_pivot: { label: "Pivoted away from a win pick" },
};

/**
 * Why a screen could not run, in the terms a customer would ask it.
 *
 * Keyed on the tail of a skip string. Each says what is missing and, where it
 * is a permanent property of the feed rather than a today problem, says that
 * too — "not published yet" and "we do not carry it" are different promises.
 */
const REASON_LABELS: Record<string, string> = {
  no_opponent_positions: "The feed lists results but not who they were against, so opponent strength could not be weighed.",
  no_context_data:
    "This feed carries no travel distance, fixture congestion, pitch surface, weather or referee history.",
  no_personnel_data: "Line-ups, injuries and suspensions are not published this far before kickoff.",
  no_lineups: "Line-ups are published about 40 minutes before kickoff.",
  no_odds: "No earlier price to measure the current one against.",
  no_prior_odds: "No earlier price to measure the current one against.",
  no_weather_data: "Weather is not on this feed.",
  no_referee_data: "This referee's card and foul history is not on this feed.",
  no_split_form: "The feed gives one combined form run, not home and away separately.",
  no_h2h_detail: "Head-to-head is given as totals only, not as individual meetings.",
  no_meeting_list: "Head-to-head is given as totals only, not as individual meetings.",
  insufficient_form: "The form run is too short to read a streak from.",
  no_injury_data: "Injury and suspension news is not on this feed.",
};

/**
 * `Step_5_5b_skipped_no_context_data` → `{ steps: ["5", "5b"], rest: "skipped_no_context_data" }`.
 *
 * Every segment, not just the last. `Step_5_5b_` is not one step written twice
 * — it is the model saying it skipped steps 5 AND 5B, which are two different
 * screens over two different inputs. Keeping only 5b would put the travel-and-
 * rest screen back on the page as though it had run.
 *
 * The continuation is consumed ONLY after a real `step_` prefix, so a flag that
 * happens to begin with a number is left alone.
 */
function splitStepPrefix(name: string): { steps: string[]; rest: string } {
  let rest = name;

  const prefix = /^step[_-]?(\d+[a-z]?)[_-]/;
  const m = prefix.exec(rest);
  if (!m) return { steps: [], rest };

  const steps = [m[1]];
  rest = rest.slice(m[0].length);

  const continuation = /^(\d+[a-z]?)[_-]/;
  for (let c = continuation.exec(rest); c; c = continuation.exec(rest)) {
    steps.push(c[1]);
    rest = rest.slice(c[0].length);
  }

  return { steps, rest };
}

/** Every named step in one label, or nothing if none of them are named. */
function stepLabel(steps: string[]): string | undefined {
  const named = steps.map((s) => STEP_LABELS[s]).filter(Boolean);
  if (!named.length) return undefined;
  // A middot rather than "and": these labels contain their own "and"s, and
  // "Travel, rest and pitch and weather and referee" parses as one long list.
  return [...new Set(named)].join(" · ");
}

/** Sentence case from a snake_case tail, with the abbreviations expanded. */
function prettify(name: string): string {
  const words = name
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim()
    .split(/\s+/)
    .map((w) => {
      const l = w.toLowerCase();
      if (l === "h2h") return "head-to-head";
      if (l === "btts") return "both teams to score";
      if (l === "1x2") return "match result";
      if (l === "xg") return "chance quality";
      return l;
    });

  const joined = words.join(" ");
  return joined.charAt(0).toUpperCase() + joined.slice(1);
}

/**
 * One raw flag, resolved.
 *
 * Never throws and never returns nothing: an unrecognised string is prettified
 * rather than dropped, because a screen the engine says it ran should not
 * vanish from the page just because nobody has written a label for it yet.
 */
export function describeFilter(raw: string): DescribedFilter {
  const normalised = String(raw).trim().toLowerCase();
  const { steps, rest } = splitStepPrefix(normalised);

  // A skip can be written as skipped_no_x, no_x_data, or x_unavailable. All
  // three mean the same thing and all three have appeared in real output.
  const skipMatch = /^(?:skipped|skip)[_-]?(.*)$/.exec(rest);
  const isSkip =
    skipMatch !== null || /^(?:no|missing)[_-]/.test(rest) || /(unavailable|_absent_feed)$/.test(rest);

  if (isSkip) {
    const reasonKey = (skipMatch?.[1] || rest).replace(/^_+/, "");
    const label =
      stepLabel(steps) ?? FILTER_LABELS[reasonKey]?.label ?? prettify(reasonKey);

    return {
      raw,
      kind: "unavailable",
      label,
      detail: REASON_LABELS[reasonKey] ?? `Not run: ${prettify(reasonKey).toLowerCase()}.`,
    };
  }

  const known = FILTER_LABELS[rest] ?? FILTER_LABELS[normalised];
  if (known) return { raw, kind: "applied", ...known };

  // No entry for it. The step's own name is a better label than the model's
  // identifier, where the step is one we have a name for.
  const named = stepLabel(steps);
  return {
    raw,
    kind: "applied",
    label: named ?? prettify(rest),
    detail: named ? prettify(rest) : undefined,
  };
}

/**
 * The whole column, split and de-duplicated.
 *
 * Accepts both stored shapes. The object form is the pre-array schema, where a
 * `false` value is a flag that did NOT fire — which is not the same claim as a
 * screen that could not run, but is closer to it than to a screen that did, so
 * it lands in `unavailable` rather than being shown with a tick.
 *
 * De-duplication is by resolved label, not by raw string: `recent_h2h_dominance`
 * and `Step_1e_recent_h2h_dominance` are one screen written twice, and a page
 * listing both looks like the engine did the work twice.
 */
export function describeFilters(
  filters: string[] | Record<string, boolean> | null | undefined,
): { applied: DescribedFilter[]; unavailable: DescribedFilter[] } {
  const entries: Array<[string, boolean]> = Array.isArray(filters)
    ? filters.map((f) => [String(f), true])
    : filters && typeof filters === "object"
      ? Object.entries(filters)
      : [];

  const applied = new Map<string, DescribedFilter>();
  const unavailable = new Map<string, DescribedFilter>();

  for (const [raw, fired] of entries) {
    if (!raw) continue;
    const described = describeFilter(raw);
    const kind = fired ? described.kind : "unavailable";
    const bucket = kind === "applied" ? applied : unavailable;
    if (!bucket.has(described.label)) bucket.set(described.label, { ...described, kind });
  }

  // A screen cannot be both. If the model emitted it as run anywhere, run wins.
  for (const label of applied.keys()) unavailable.delete(label);

  return { applied: [...applied.values()], unavailable: [...unavailable.values()] };
}
