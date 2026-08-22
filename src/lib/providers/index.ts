import type { Providers } from "./types";
import { liveAi, liveFootball, liveMessaging, livePayments } from "./live";

export * from "./types";

/**
 * The providers. There is only one set.
 *
 * There used to be a mocked set behind a MOCK_PROVIDERS switch, and it
 * defaulted to ON: `process.env.MOCK_PROVIDERS !== "false"` meant any
 * environment that simply forgot the variable served invented fixtures and
 * invented predictions while looking entirely healthy. That is a bad default
 * to carry into production, and the switch is gone rather than re-defaulted.
 *
 * Everything here needs real credentials now: ANTHROPIC_API_KEY,
 * API_FOOTBALL_KEY, PAYSTACK_SECRET_KEY, RESEND_API_KEY and MNOTIFY_KEY. Each
 * provider throws by name when its own key is missing, so the failure says
 * which credential rather than producing plausible nonsense.
 */
export function getProviders(): Providers {
  return {
    football: liveFootball,
    ai: liveAi,
    payments: livePayments,
    messaging: liveMessaging,
    mocked: false,
  };
}
