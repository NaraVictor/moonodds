import { describe, expect, it } from "vitest";
import { renderPrompt, placeholdersIn, PromptRenderError } from "./template";
import {
  resolveEngineVariables,
  validateEngineVariables,
  ENGINE_VARIABLES,
} from "./variables";
import { ENGINE_PROMPT_TEMPLATE } from "./prompt";
import { normalisePredictedValue, FILTER_FLAGS } from "./output";

/**
 * The engine's contract with itself.
 *
 * Two silent failures live here. A placeholder with no variable behind it would
 * ship the literal "{{tier1Penalty}}" to the model, and a percent written as a
 * fraction turns a 5% penalty into 0.05% while looking entirely plausible in
 * the config editor.
 */

describe("prompt rendering", () => {
  it("resolves every placeholder in the shipped prompt", () => {
    const rendered = renderPrompt(ENGINE_PROMPT_TEMPLATE, null);
    expect(rendered.text).not.toMatch(/\{\{/);
    expect(rendered.used.length).toBeGreaterThan(100);
  });

  it("throws rather than shipping an unresolved placeholder", () => {
    expect(() => renderPrompt("penalty is {{notAVariable}}", null)).toThrow(
      PromptRenderError,
    );
  });

  it("prefers the config over the built-in default", () => {
    const config = { filter_thresholds: { tier1Penalty: 42 } };
    const rendered = renderPrompt("tier one costs {{tier1Penalty}} percent", config);
    expect(rendered.text).toContain("42");
    expect(rendered.overrides).toContain("tier1Penalty");
    expect(rendered.fallbacks).not.toContain("tier1Penalty");
  });

  it("falls back and says so when the config omits a key", () => {
    const rendered = renderPrompt("tier one costs {{tier1Penalty}} percent", {});
    expect(rendered.text).toContain("20");
    expect(rendered.fallbacks).toContain("tier1Penalty");
  });

  it("reports fallbacks only for variables the template actually uses", () => {
    const rendered = renderPrompt("just {{tier1Penalty}}", {});
    expect(rendered.fallbacks).toEqual(["tier1Penalty"]);
  });

  it("ignores a config value of the wrong type", () => {
    const rendered = renderPrompt("{{tier1Penalty}}", {
      filter_thresholds: { tier1Penalty: "twenty" },
    });
    expect(rendered.text).toBe("20");
    expect(rendered.fallbacks).toContain("tier1Penalty");
  });

  it("does not search slip_building or api_budget for engine variables", () => {
    // Those buckets configure slip assembly and API quota. Treating their keys
    // as engine variables made correct config look like a typo.
    const { unknownKeys } = resolveEngineVariables({
      slip_building: { maxPicksPerSlip: 5 },
      api_budget: { dailyTotal: 500 },
    });
    expect(unknownKeys).toEqual([]);
  });
});

describe("variable validation", () => {
  it("flags a percent written as a fraction", () => {
    const { values } = resolveEngineVariables({
      filter_thresholds: { redCardCarryoverPenalty: 0.05 },
    });
    const warnings = validateEngineVariables(values);
    const hit = warnings.find((w) => w.key === "redCardCarryoverPenalty");
    expect(hit).toBeDefined();
    expect(hit?.message).toMatch(/fraction/);
  });

  it("passes a correctly scaled config", () => {
    const { values } = resolveEngineVariables(null);
    const warnings = validateEngineVariables(values);
    expect(warnings).toEqual([]);
  });

  it("catches ranking weights that do not sum to one", () => {
    const { values } = resolveEngineVariables({
      ranking_weights: { xgWeight: 0.9, formWeight: 0.9 },
    });
    const warnings = validateEngineVariables(values);
    expect(warnings.some((w) => w.key === "rankingWeights")).toBe(true);
  });

  it("catches anchoring bands that overlap", () => {
    const { values } = resolveEngineVariables({
      confidence_thresholds: { anchorDefaultRangeMax: 6.9, anchorTier3CapIfUnmet: 6.5 },
    });
    const warnings = validateEngineVariables(values);
    expect(warnings.some((w) => w.key === "anchorDefaultRangeMax")).toBe(true);
  });

  it("defines every variable the shipped prompt references", () => {
    const defined = new Set(ENGINE_VARIABLES.map((v) => v.key));
    const missing = placeholdersIn(ENGINE_PROMPT_TEMPLATE).filter(
      (k) => !defined.has(k),
    );
    expect(missing).toEqual([]);
  });
});

describe("normalisePredictedValue", () => {
  it("accepts the canonical selections", () => {
    expect(normalisePredictedValue("1x2", "1")).toBe("1");
    expect(normalisePredictedValue("1x2", "X")).toBe("X");
    expect(normalisePredictedValue("double_chance", "1X")).toBe("1X");
    expect(normalisePredictedValue("btts", "yes")).toBe("yes");
    expect(normalisePredictedValue("over_under_2_5", "over")).toBe("over");
  });

  it("forgives case and whitespace, returning the canonical form", () => {
    expect(normalisePredictedValue("1x2", " x ")).toBe("X");
    expect(normalisePredictedValue("double_chance", "1x")).toBe("1X");
    expect(normalisePredictedValue("over_under_2_5", "OVER")).toBe("over");
  });

  it("rejects a selection the grader could never settle", () => {
    // The failure this exists for: "Home" grades review_needed forever.
    expect(normalisePredictedValue("1x2", "Home")).toBeNull();
    expect(normalisePredictedValue("btts", "maybe")).toBeNull();
    expect(normalisePredictedValue("over_under_2_5", "")).toBeNull();
  });

  it("parses a handicap line and rejects a malformed one", () => {
    expect(normalisePredictedValue("handicap", "home -1.5")).toBe("home -1.5");
    expect(normalisePredictedValue("handicap", "AWAY +0.5")).toBe("away +0.5");
    expect(normalisePredictedValue("handicap", "home")).toBeNull();
    expect(normalisePredictedValue("handicap", "home -")).toBeNull();
  });

  it("parses a correct score and rejects anything else", () => {
    expect(normalisePredictedValue("correct_score", "2-1")).toBe("2-1");
    expect(normalisePredictedValue("correct_score", "2:1")).toBeNull();
  });
});

describe("filter flags", () => {
  it("are snake_case, matching the prompt rather than the old schema", () => {
    for (const flag of FILTER_FLAGS) {
      expect(flag).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it("has no duplicates", () => {
    expect(new Set(FILTER_FLAGS).size).toBe(FILTER_FLAGS.length);
  });
});
