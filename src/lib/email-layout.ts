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
 * The WhatsApp mark, and the compromise behind it.
 *
 * The chip used to carry 💬 — a generic speech balloon, which is not the
 * thing. The mark itself cannot simply be dropped in: Gmail strips <svg>
 * outright, and Gmail is most of this audience, so an inline logo would render
 * as nothing at all for the majority. A hosted PNG is the only way to show a
 * pixel-accurate logo to everyone, and that needs an asset in public/ and a
 * URL, which this does not have yet.
 *
 * So the recognisable part that survives everywhere carries it: the chip is
 * WhatsApp green with white type, which reads as WhatsApp at a glance in any
 * client. The glyph is included as inline SVG for the clients that do render
 * it — Apple Mail and iOS Mail, which is not a small share on a product sold
 * in Ghana — and where it is stripped, the green chip is still unmistakably
 * the right thing to press.
 */
const WHATSAPP_GREEN = "#25D366";

const WHATSAPP_MARK =
  `<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="#ffffff" ` +
  `style="vertical-align:-2px;margin-right:7px;">` +
  `<path d="M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.47-1.75-1.64-2.05-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.53.15-.18.2-.3.3-.5.1-.2.05-.38-.02-.53-.08-.15-.67-1.6-.92-2.2-.24-.58-.49-.5-.67-.5h-.57c-.2 0-.52.07-.79.38-.27.3-1.04 1.01-1.04 2.47s1.06 2.86 1.21 3.06c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.7.63.71.23 1.36.2 1.87.12.57-.09 1.75-.72 2-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35z"/>` +
  `<path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.86 9.86 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.17 8.17 0 0 1-1.25-4.38c0-4.54 3.7-8.23 8.24-8.23a8.17 8.17 0 0 1 5.82 2.42 8.17 8.17 0 0 1 2.41 5.82c0 4.54-3.7 8.23-8.23 8.23z"/>` +
  `</svg>`;

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
              <a href="${WHATSAPP_URL}" style="display:inline-block;color:#ffffff;text-decoration:none;font-weight:600;background:${WHATSAPP_GREEN};border-radius:999px;padding:9px 16px;">${WHATSAPP_MARK}Chat us on WhatsApp</a>
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
