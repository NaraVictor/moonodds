import { SITE_URL } from "./site-url";

/**
 * The one email layout. Everything the app sends is rendered through it.
 *
 * Before this, each job handler wrote its own `<p>` and shipped it. Nothing
 * carried the brand, nothing carried a way back to the site, and each message
 * looked like it came from a different product.
 *
 * The design is deliberately quiet: a left-aligned wordmark, one column of
 * plain prose at a comfortable measure, one action, and a thin footer. No
 * boxes, no coloured panels, no borders around the content. A transactional
 * email earns trust by looking like a letter rather than a landing page, and
 * every extra flourish is another thing to render wrong in Outlook.
 *
 * CONSTRAINTS THAT SHAPE ALL OF THIS, none of them stylistic:
 *   - Tables and inline styles only. Gmail strips <style> blocks, and Outlook
 *     renders with Word, which has never understood flexbox or grid.
 *   - The wordmark is TEXT, not an image. Kicka's mark is type anyway, and most
 *     clients block remote images by default — a logo that vanishes for half
 *     the recipients is worse than one that cannot.
 *   - A preheader is included and hidden. Without it, inboxes preview whatever
 *     the first line happens to be, which for a table of fixtures is "S/N".
 */

const INK = "#111827";
const MUTED = "#6b7280";
const ACCENT = "#15803D";
const RULE = "#e6e8eb";
const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

/** WhatsApp support. wa.me wants the number without a plus or spaces. */
export const WHATSAPP_NUMBER = "+233539475193";
const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER.replace(/[^0-9]/g, "")}`;

/**
 * The WhatsApp mark, hosted.
 *
 * This was a compromise until the asset existed: Gmail strips <svg> outright,
 * and Gmail is most of this audience, so an inline logo rendered as nothing at
 * all for the majority. The chip carried WhatsApp green instead and the glyph
 * only appeared in Apple Mail.
 *
 * A hosted PNG is the one form every client shows. Gmail, Outlook.com and
 * Yahoo all proxy remote images and display them by default, and the ones that
 * block images fall back to the alt text — which is why the alt reads
 * "WhatsApp" rather than being empty: with images off, the chip still says
 * what it is.
 *
 * Absolute URL, necessarily. There is no page for a relative path to resolve
 * against inside an inbox.
 *
 * The chip goes back to the quiet bordered style it had before. The logo
 * carries the colour now, and a green mark on a green chip would have lost the
 * one thing that makes it recognisable.
 */
const WHATSAPP_MARK =
  `<img src="${SITE_URL}/whatsapp.png" alt="WhatsApp" width="16" height="16" ` +
  `style="vertical-align:-3px;margin-right:7px;border:0;">`;

/** HTML-escape. Fixture and team names come from a feed, not from us. */
export function esc(v: string): string {
  return String(v).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );
}

export type EmailCta = { label: string; href: string };

/**
 * Wrap content in the shell.
 *
 * `body` is trusted HTML the caller has already escaped. `preheader` is the
 * grey line inboxes show beside the subject; say something useful there, since
 * it is read more often than the email is opened.
 */
export function renderEmail({
  preheader,
  body,
  cta,
  signOff = true,
}: {
  preheader: string;
  body: string;
  cta?: EmailCta;
  signOff?: boolean;
}): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f7f8f8;">
  <span style="display:none;font-size:1px;color:#f7f8f8;max-height:0;overflow:hidden;">${esc(preheader)}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f7f8f8;">
    <tr><td align="center" style="padding:32px 16px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:16px;">
        <tr><td style="padding:36px 36px 8px;">
          <!-- Left-aligned wordmark, as type rather than an image. -->
          <a href="${SITE_URL}" style="text-decoration:none;font-family:${FONT};font-size:24px;font-weight:800;letter-spacing:-.02em;color:${INK};">Kick<span style="color:${ACCENT};">a</span></a>
        </td></tr>
        <tr><td style="padding:20px 36px 0;font-family:${FONT};font-size:15px;line-height:1.65;color:${INK};">
          ${body}
        </td></tr>
        ${
          cta
            ? `<tr><td style="padding:28px 36px 0;">
                 <a href="${cta.href}" style="display:inline-block;background:${ACCENT};color:#ffffff;text-decoration:none;padding:13px 24px;border-radius:999px;font-family:${FONT};font-size:15px;font-weight:600;">${esc(cta.label)}</a>
               </td></tr>`
            : ""
        }
        ${
          signOff
            ? `<tr><td style="padding:28px 36px 0;font-family:${FONT};font-size:15px;line-height:1.65;color:${MUTED};">
                 The Kicka team
               </td></tr>`
            : ""
        }
        <tr><td style="padding:32px 36px 36px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr><td style="border-top:1px solid ${RULE};padding-top:20px;font-family:${FONT};font-size:13px;color:${MUTED};">
              <a href="${WHATSAPP_URL}" style="display:inline-block;color:${INK};text-decoration:none;font-weight:600;border:1px solid ${RULE};border-radius:999px;padding:9px 16px;">${WHATSAPP_MARK}Chat us on WhatsApp</a>
              <div style="margin-top:16px;">
                <a href="${SITE_URL}" style="color:${MUTED};text-decoration:underline;">kicka.app</a>
                &nbsp;·&nbsp; 18+ only. Predictions are analysis, not guarantees.
              </div>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

/** A paragraph at the shell's measure. */
export function p(html: string): string {
  return `<p style="margin:0 0 16px;">${html}</p>`;
}

/** Small print under the main message. */
export function note(html: string): string {
  return `<p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:${MUTED};">${html}</p>`;
}
