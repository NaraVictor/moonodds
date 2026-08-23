/**
 * Analytics consent.
 *
 * Google Analytics sets cookies and assigns an identifier, which under the
 * UK/EU GDPR and Ghana's Data Protection Act is opt-in before it happens, not
 * disclosed afterwards. The privacy policy already described it honestly;
 * describing something is not consenting to it.
 *
 * What this is NOT is a modal. There is already an age gate standing between a
 * visitor and the board, and a second blocking interruption to reach a page of
 * football predictions would cost more than the analytics are worth. The bar
 * is non-blocking: the product is fully usable behind it, and ignoring it
 * leaves analytics denied, which is the safe default rather than a dark
 * pattern in reverse.
 *
 * Vercel Web Analytics runs regardless. It sets no cookies, stores no
 * identifier and builds no profile, which is the recognised basis for
 * measuring page views without consent. Only Google is gated.
 */

export const CONSENT_KEY = "kicka.analytics-consent";

export type ConsentChoice = "granted" | "denied";

/**
 * Consent Mode defaults, inlined into <head>.
 *
 * MUST run before gtag.js loads, which is why it is a blocking inline script
 * rather than a component: Consent Mode works by having the defaults already
 * in the dataLayer when the tag initialises. Set them afterwards and the tag
 * has already written a cookie, at which point the banner is theatre.
 *
 * The ad_* signals are denied permanently and never asked about, because this
 * product does not advertise and asking for something you will not use is its
 * own kind of dishonesty. Only analytics_storage is ever updated.
 */
export const CONSENT_INIT_SCRIPT = `
(function () {
  window.dataLayer = window.dataLayer || [];
  function gtag(){dataLayer.push(arguments);}
  window.gtag = window.gtag || gtag;

  var stored = null;
  try { stored = localStorage.getItem(${JSON.stringify(CONSENT_KEY)}); } catch (e) {}

  gtag('consent', 'default', {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: stored === 'granted' ? 'granted' : 'denied',
    wait_for_update: 500
  });
})();
`.trim();

/** Tell Google the answer changed, without reloading the page. */
export function updateConsent(choice: ConsentChoice) {
  const g = (window as unknown as { gtag?: (...args: unknown[]) => void }).gtag;
  if (typeof g === "function") {
    g("consent", "update", { analytics_storage: choice });
  }
}
