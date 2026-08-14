import type { Providers } from "./types";
import { mockAi, mockFootball, mockMessaging, mockPayments } from "./mock";
import { liveAi, liveFootball, liveMessaging, livePayments } from "./live";

export * from "./types";

/**
 * One switch decides whether anything touches the network.
 *
 * Defaults to mocked. Going live is: set MOCK_PROVIDERS=false and supply
 * ANTHROPIC_API_KEY, API_FOOTBALL_KEY, PAYSTACK_SECRET_KEY, RESEND_API_KEY and
 * the Hubtel pair. No call sites change.
 */
export function getProviders(): Providers {
  const mocked = process.env.MOCK_PROVIDERS !== "false";

  return mocked
    ? {
        football: mockFootball,
        ai: mockAi,
        payments: mockPayments,
        messaging: mockMessaging,
        mocked: true,
      }
    : {
        football: liveFootball,
        ai: liveAi,
        payments: livePayments,
        messaging: liveMessaging,
        mocked: false,
      };
}
