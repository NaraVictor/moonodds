import { describe, expect, it } from "vitest";
import { enabledMarkets, pickSchema } from "./output";
import { GRADEABLE_MARKETS } from "@/lib/types";

/**
 * The market list is the only thing standing between an operator's decision
 * and the model's output, so both halves are pinned: what an unset config
 * resolves to, and that the schema the model generates against actually
 * narrows.
 */
describe("enabledMarkets", () => {
  it("treats an unset config as every gradeable market", () => {
    expect(enabledMarkets(null)).toEqual([...GRADEABLE_MARKETS]);
    expect(enabledMarkets({})).toEqual([...GRADEABLE_MARKETS]);
    expect(enabledMarkets({ enabled_markets: [] })).toEqual([...GRADEABLE_MARKETS]);
  });

  it("never lets corners back in, whatever the config says", () => {
    // It cannot be graded, so a corners pick would sit unresolved on a
    // customer's slip forever. The config narrows GRADEABLE_MARKETS; it
    // cannot widen it.
    expect(enabledMarkets({ enabled_markets: ["corners_over_under"] })).toEqual([
      ...GRADEABLE_MARKETS,
    ]);
    expect(
      enabledMarkets({ enabled_markets: ["1x2", "corners_over_under"] }),
    ).toEqual(["1x2"]);
  });

  it("drops values that are not markets at all", () => {
    expect(enabledMarkets({ enabled_markets: ["1x2", "nonsense", 7] })).toEqual([
      "1x2",
    ]);
  });
});

describe("pickSchema", () => {
  it("narrows both the primary and the alternative market", () => {
    const s = pickSchema(["1x2", "double_chance"]);
    const props = s.properties.picks.items.properties as Record<
      string,
      { enum?: string[] }
    >;
    expect(props.predictionType.enum).toEqual(["1x2", "double_chance"]);
    // The alternative is a real pick that can reach a slip, so restricting one
    // and not the other would leak a disabled market through the back door.
    expect(props.altMarket.enum).toEqual(["1x2", "double_chance"]);
  });

  it("does not mutate the shared schema between runs", () => {
    pickSchema(["1x2"]);
    const after = pickSchema([...GRADEABLE_MARKETS]);
    const props = after.properties.picks.items.properties as Record<
      string,
      { enum?: string[] }
    >;
    expect(props.predictionType.enum).toEqual([...GRADEABLE_MARKETS]);
  });
});
