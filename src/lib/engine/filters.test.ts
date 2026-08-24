import { describe, expect, it } from "vitest";
import { describeFilter, describeFilters, FILTER_LABELS } from "./filters";
import { FILTER_FLAGS } from "./output";

/**
 * What this protects.
 *
 * The detail page ticks every string in `filters_applied` under a heading that
 * claims the model applied it. The model also writes strings saying it did NOT
 * apply something, in a shape nothing here anticipated, and the page ticked
 * those too. These tests pin the separation, and pin that no raw identifier
 * reaches a customer.
 */

describe("describeFilter", () => {
  it("labels a canonical flag without showing its identifier", () => {
    const d = describeFilter("chaos_filter");
    expect(d.kind).toBe("applied");
    expect(d.label).toBe("Winless-run filter");
    expect(d.label).not.toMatch(/_/);
  });

  it("reads a skip as unavailable, not as a screen that ran", () => {
    const d = describeFilter("Step_6_skipped_no_personnel_data");
    expect(d.kind).toBe("unavailable");
    expect(d.label).toBe("Team news");
    expect(d.detail).toMatch(/Line-ups/);
  });

  it("names every step in a compound prefix, not just the last", () => {
    // Step_5_5b_ is two screens over two different inputs. Reporting only 5b
    // would quietly put the travel-and-rest screen back on the page as run.
    expect(describeFilter("Step_5_5b_skipped_no_context_data").label).toBe(
      "Travel, rest and pitch · Weather and referee",
    );
  });

  it("strips the step prefix off a flag that carries one", () => {
    const bare = describeFilter("recent_h2h_dominance");
    const prefixed = describeFilter("Step_1e_recent_h2h_dominance");
    expect(prefixed.label).toBe(bare.label);
    expect(prefixed.kind).toBe("applied");
  });

  it("expands h2h rather than shipping the abbreviation", () => {
    const d = describeFilter("Step_1e_weighted_h2h_applied");
    expect(d.kind).toBe("applied");
    expect(d.label.toLowerCase()).toContain("head-to-head");
  });

  it("still renders a flag nobody has written a label for", () => {
    const d = describeFilter("some_new_h2h_screen");
    expect(d.label).toBe("Some new head-to-head screen");
    expect(d.kind).toBe("applied");
  });

  it("recognises a bare no_ prefix as a skip", () => {
    expect(describeFilter("no_odds").kind).toBe("unavailable");
  });

  it("gives every shipped flag a written label", () => {
    for (const flag of FILTER_FLAGS) {
      // Not "it renders something" — the fallback renders something for any
      // string. A flag the prompt ships must have been written for by hand.
      expect(FILTER_LABELS[flag], `no label written for ${flag}`).toBeDefined();
      const d = describeFilter(flag);
      expect(d.kind).toBe("applied");
      expect(d.label).not.toMatch(/_/);
    }
  });
});

describe("describeFilters", () => {
  it("splits a real mixed payload into ran and could-not-run", () => {
    const { applied, unavailable } = describeFilters([
      "Step_1e_weighted_h2h_applied",
      "Recent_h2h_dominance",
      "Step_1c_skipped_no_opponent_positions",
      "Step_5_5b_skipped_no_context_data",
      "Step_6_skipped_no_personnel_data",
      "Step_4_standard_buffer",
    ]);

    expect(applied.map((d) => d.label)).toEqual([
      "Recency-weighted head-to-head",
      "Recent head-to-head dominance",
      "Standard probability buffer",
    ]);
    expect(unavailable).toHaveLength(3);
    expect(unavailable.every((d) => d.kind === "unavailable")).toBe(true);
  });

  it("counts one screen once however many ways it was written", () => {
    const { applied } = describeFilters([
      "recent_h2h_dominance",
      "Step_1e_recent_h2h_dominance",
    ]);
    expect(applied).toHaveLength(1);
  });

  it("reads the legacy object form, and false is not a tick", () => {
    const { applied, unavailable } = describeFilters({
      chaos_filter: true,
      squad_crisis: false,
    });
    expect(applied.map((d) => d.label)).toEqual(["Winless-run filter"]);
    expect(unavailable.map((d) => d.label)).toEqual(["Squad crisis"]);
  });

  it("survives null, empty and junk", () => {
    expect(describeFilters(null).applied).toEqual([]);
    expect(describeFilters([]).unavailable).toEqual([]);
    expect(describeFilters([""]).applied).toEqual([]);
  });
});
