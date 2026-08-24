import { describe, expect, it } from "vitest";
import { PICK_SCHEMA } from "./output";

/**
 * The schema Anthropic will actually accept.
 *
 * A 400 from the model is the most expensive failure this pipeline has: it
 * produces no picks, on a schedule, and the run reports an error nobody reads
 * until a customer asks where the day's calls went. The API refused this
 * schema outright for having 77 optional parameters, and nothing caught it
 * because the feed could not supply a fixture to analyse, so the request was
 * never made.
 *
 * This is the regression test for that. It counts rather than asserts a
 * literal, so adding a field cannot quietly reintroduce the problem.
 */
type Node = {
  type?: string | string[];
  properties?: Record<string, Node>;
  required?: string[];
  items?: Node;
};

function optionalCount(node: Node, acc = { total: 0 }): number {
  if (!node || typeof node !== "object") return acc.total;
  if (node.type === "object" && node.properties) {
    const props = Object.keys(node.properties);
    acc.total += props.length - (node.required?.length ?? 0);
    for (const child of Object.values(node.properties)) optionalCount(child, acc);
  }
  if (node.type === "array" && node.items) optionalCount(node.items, acc);
  return acc.total;
}

describe("PICK_SCHEMA", () => {
  it("has no optional parameters at all", () => {
    expect(optionalCount(PICK_SCHEMA as unknown as Node)).toBe(0);
  });

  it("stays inside the union-type limit", () => {
    // The SECOND limit the API enforces, found only after the first was fixed:
    // "too many parameters with union types (19 ... limit: 16)". Nullable
    // numbers are worth their slots because null and zero differ; nullable
    // reason strings were not, and became empty strings.
    let unions = 0;
    const walk = (n: Node) => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n.type)) unions++;
      if (n.properties) Object.values(n.properties).forEach(walk);
      if (n.items) walk(n.items);
    };
    walk(PICK_SCHEMA as unknown as Node);
    expect(unions).toBeLessThanOrEqual(16);
  });

  it("keeps null for numbers, where zero is a different claim", () => {
    const pick = (PICK_SCHEMA as unknown as Node).properties!.picks.items!;
    // environmentalLog was removed with the feedless logs, so this now checks
    // a nullable number that survives: a quality-adjusted form score of 0 is a
    // rating, and no rating is an absence.
    const score = pick.properties!.formLog.properties!.homeQualityFormScore;
    expect(score.type).toContain("null");
  });

  it("requires every key of every nested log", () => {
    const pick = (PICK_SCHEMA as unknown as Node).properties!.picks.items!;
    for (const [name, child] of Object.entries(pick.properties!)) {
      if (child.type !== "object" || !child.properties) continue;
      expect(
        child.required?.length,
        `${name} must require all ${Object.keys(child.properties).length} of its keys`,
      ).toBe(Object.keys(child.properties).length);
    }
  });
});

describe("blankToNull", () => {
  it("turns the schema's empty strings into nulls", async () => {
    const { blankToNull } = await import("./output");
    expect(blankToNull({ overrideReason: "", reasoning: "kept" })).toEqual({
      overrideReason: null,
      reasoning: "kept",
    });
  });

  it("reaches into the nested logs", async () => {
    const { blankToNull } = await import("./output");
    expect(blankToNull({ formLog: { homeFormWindow: "   " } })).toEqual({
      formLog: { homeFormWindow: null },
    });
  });

  it("leaves a reason the model actually gave alone", async () => {
    const { blankToNull } = await import("./output");
    expect(blankToNull({ overrideReason: "none", anchorCapReason: "0" })).toEqual({
      overrideReason: "none",
      anchorCapReason: "0",
    });
  });
});
