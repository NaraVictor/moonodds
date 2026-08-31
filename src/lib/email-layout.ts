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

/**
 * A bordered table, because email cannot be trusted with a borderless one.
 *
 * `border-collapse: collapse` is the usual way to get single-pixel rules
 * between cells, and it silently disables border-radius — the corners simply
 * do not round. So this uses `separate` with zero spacing and paints the rules
 * per cell instead: every cell carries a right and bottom edge, the last
 * column drops its right, the last row drops its bottom, and the outer border
 * and radius live on the table itself.
 *
 * Outlook renders with Word, which ignores border-radius entirely. It shows
 * the same table with square corners, which is the correct thing to degrade
 * to — all the rules are still there, and the grid is what carries the meaning.
 *
 * One helper rather than two tables written by hand, so the results email and
 * the picks email cannot drift into different grids.
 */
export function emailTable(t: {
  head: string[];
  rows: string[][];
  /** Per-column alignment; defaults to left. */
  align?: Array<"left" | "right" | "center">;
}): string {
  const cols = t.head.length;
  const at = (i: number) => t.align?.[i] ?? "left";
  const edge = (last: boolean) => (last ? "" : `border-right:1px solid ${RULE};`);

  const head = t.head
    .map(
      (h, i) =>
        `<th style="padding:9px 12px;${edge(i === cols - 1)}border-bottom:1px solid ${RULE};` +
        `background:#fafbfb;font-family:${FONT};font-size:10px;letter-spacing:.06em;` +
        `text-transform:uppercase;color:${MUTED};text-align:${at(i)};font-weight:700;">${h}</th>`,
    )
    .join("");

  const body = t.rows
    .map((r, ri) => {
      const lastRow = ri === t.rows.length - 1;
      const cells = r
        .map(
          (c, i) =>
            `<td style="padding:10px 12px;${edge(i === cols - 1)}` +
            `${lastRow ? "" : `border-bottom:1px solid ${RULE};`}` +
            `font-family:${FONT};font-size:14px;color:${INK};text-align:${at(i)};` +
            `vertical-align:middle;">${c}</td>`,
        )
        .join("");
      return `<tr>${cells}</tr>`;
    })
    .join("");

  return (
    `<table role="presentation" cellpadding="0" cellspacing="0" ` +
    `style="border-collapse:separate;border-spacing:0;width:100%;margin-top:20px;` +
    `border:1px solid ${RULE};border-radius:10px;overflow:hidden;">` +
    `<thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`
  );
}

/**
 * Won or lost, as the badge the site uses.
 *
 * The same wash-and-ink pair as /history and the board's table view, so a
 * result means the same thing wherever somebody meets it.
 *
 * No glyph. On the site the badge carries a tick or a cross alongside the
 * word, and in mail that is the one part that cannot be relied on: an inline
 * SVG is stripped by Gmail, and the ✓ character renders as a colour emoji on
 * some Android clients, which would put a cartoon in the middle of a results
 * table. Colour plus the word says it unambiguously and renders everywhere.
 */
export function resultBadge(status: string): string {
  const tone =
    status === "won"
      ? { bg: "#e7f6ec", ink: "#15803D", label: "WON" }
      : status === "lost"
        ? { bg: "#fdeceb", ink: "#b42318", label: "LOST" }
        : { bg: "#f1f3f4", ink: MUTED, label: "VOID" };

  return (
    `<span style="display:inline-block;background:${tone.bg};color:${tone.ink};` +
    `border-radius:999px;padding:3px 9px;font-family:${FONT};font-size:10px;` +
    `font-weight:700;letter-spacing:.06em;">${tone.label}</span>`
  );
}


/** A paragraph at the shell's measure. */
export function p(html: string): string {
  return `<p style="margin:0 0 16px;">${html}</p>`;
}

/** Small print under the main message. */
export function note(html: string): string {
  return `<p style="margin:16px 0 0;font-size:13px;line-height:1.6;color:${MUTED};">${html}</p>`;
}
