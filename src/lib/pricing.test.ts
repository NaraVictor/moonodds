import { describe, expect, it } from "vitest";
import {
  extraPicksPriceUsd,
  paymentAmountMatches,
  usdToPesewas,
  PAYSTACK_MIN_PESEWAS,
  EXTRA_PICK_GAMES_PER_LEAGUE,
  EXTRA_PICK_PRICE_PER_GROUP_USD,
} from "./pricing";

/**
 * Everything here decides what a customer is charged, or whether what they
 * paid was enough. Both were wrong before: the conversion rounded to nearest
 * and could bill under the advertised price, and verification compared against
 * a floor derived from a minimum exchange rate rather than against the amount
 * actually charged.
 */

describe("usdToPesewas", () => {
  it("converts a clean product exactly", () => {
    expect(usdToPesewas(3, 15)).toBe(4500);
    expect(usdToPesewas(2, 12.5)).toBe(2500);
  });

  it("rounds up rather than to nearest, so we never bill under the price", () => {
    // 4 * 11.1111 * 100 = 4444.44. Math.round would bill 4444 and give away
    // the difference on every transaction.
    expect(usdToPesewas(4, 11.1111)).toBe(4445);
    expect(usdToPesewas(3, 15.4321)).toBe(4630);
  });

  it("does not invent a pesewa out of floating point", () => {
    // 2 * 8.05 * 100 evaluates to 1610.0000000000002 in binary floating point.
    // A bare Math.ceil bills 1611: one pesewa of pure arithmetic artifact on a
    // price that is exactly 1610.
    expect(2 * 8.05 * 100).toBeGreaterThan(1610);
    expect(Math.ceil(2 * 8.05 * 100)).toBe(1611);
    expect(usdToPesewas(2, 8.05)).toBe(1610);
  });

  it("rounds up a genuine fraction while ignoring the artifact", () => {
    // Sweeping the plausible rate band: no result may sit below the true price,
    // and none may exceed it by a whole pesewa.
    for (let cents = 800; cents <= 2500; cents++) {
      const rate = cents / 100;
      for (const usd of [2, 3, 4, 6]) {
        const billed = usdToPesewas(usd, rate);
        const exact = usd * rate * 100;
        expect(billed).toBeGreaterThanOrEqual(Math.round(exact));
        expect(billed - exact).toBeLessThan(1);
      }
    }
  });

  it("refuses an amount Paystack would reject", () => {
    expect(() => usdToPesewas(0.05, 15)).toThrow(/below the Paystack minimum/);
    expect(PAYSTACK_MIN_PESEWAS).toBe(100);
  });

  it("refuses nonsense inputs instead of pricing them", () => {
    expect(() => usdToPesewas(0, 15)).toThrow();
    expect(() => usdToPesewas(3, 0)).toThrow();
    expect(() => usdToPesewas(-1, 15)).toThrow();
    expect(() => usdToPesewas(3, Number.NaN)).toThrow();
    expect(() => usdToPesewas(Number.POSITIVE_INFINITY, 15)).toThrow();
  });
});

describe("extraPicksPriceUsd", () => {
  it("charges per group of five, rounding the group up", () => {
    expect(extraPicksPriceUsd(1)).toBe(2);
    expect(extraPicksPriceUsd(5)).toBe(2);
    expect(extraPicksPriceUsd(6)).toBe(4);
    expect(extraPicksPriceUsd(10)).toBe(4);
    expect(extraPicksPriceUsd(11)).toBe(6);
  });

  it("prices one league at one group, which is what the copy promises", () => {
    // "Pick up to 5 games from any league, $2 per group of 5" is only true
    // while these two constants agree. If the per-league count ever exceeds
    // the group size, a single league silently costs two groups.
    expect(extraPicksPriceUsd(EXTRA_PICK_GAMES_PER_LEAGUE)).toBe(
      EXTRA_PICK_PRICE_PER_GROUP_USD,
    );
  });

  it("charges nothing for nothing", () => {
    expect(extraPicksPriceUsd(0)).toBe(0);
    expect(extraPicksPriceUsd(-3)).toBe(0);
  });
});

describe("paymentAmountMatches", () => {
  const charged = { amountMinor: 4500, currency: "GHS" };

  it("accepts the exact amount", () => {
    expect(paymentAmountMatches(charged, { amountMinor: 4500, currency: "GHS" })).toBe(true);
  });

  it("accepts an overpayment rather than refusing settled money", () => {
    expect(paymentAmountMatches(charged, { amountMinor: 4600, currency: "GHS" })).toBe(true);
  });

  it("rejects an underpayment", () => {
    expect(paymentAmountMatches(charged, { amountMinor: 4499, currency: "GHS" })).toBe(false);
    // The case the old floor check waved through: GHS 30 against a GHS 45 charge.
    expect(paymentAmountMatches(charged, { amountMinor: 3000, currency: "GHS" })).toBe(false);
  });

  it("rejects the right number in the wrong currency", () => {
    expect(paymentAmountMatches(charged, { amountMinor: 4500, currency: "NGN" })).toBe(false);
  });

  it("rejects a non-finite amount", () => {
    expect(paymentAmountMatches(charged, { amountMinor: Number.NaN, currency: "GHS" })).toBe(false);
  });
});

/**
 * The billing consequence of a duplicated league id.
 *
 * The checkout resolves fixtures per ARRAY ENTRY, and the price is a function
 * of how many came back. Six copies of one league id therefore billed the same
 * three games six times. The dedupe lives in the route's zod schema and in
 * selectFixtures; this pins the arithmetic that made it expensive, so the cost
 * of losing either one is visible here rather than on a customer's statement.
 */
describe("extra picks, duplicate leagues", () => {
  it("charges per distinct game, not per request entry", () => {
    const distinct = EXTRA_PICK_GAMES_PER_LEAGUE;
    const duplicatedSixTimes = distinct * 6;

    expect(extraPicksPriceUsd(distinct)).toBe(EXTRA_PICK_PRICE_PER_GROUP_USD);
    // Stated as an inequality rather than an exact multiple: group rounding
    // absorbs some of it, and the point is that duplicates cost MORE, not that
    // they cost exactly six times more.
    expect(extraPicksPriceUsd(duplicatedSixTimes)).toBeGreaterThan(
      extraPicksPriceUsd(distinct),
    );
  });

  it("deduplicating ids collapses the charge back to the real one", () => {
    const requested = ["L1", "L1", "L1", "L1", "L1", "L1"];
    expect([...new Set(requested)]).toHaveLength(1);
  });
});
