import { ImageResponse } from "next/og";
import { fetchPredictionMeta, kickoffLine } from "./meta";

/**
 * The share card for a fixture.
 *
 * Generated per prediction rather than falling back to a single site-wide
 * image, because a link to "Bayern Munich v RB Leipzig" that previews as a
 * generic logo tells the reader nothing about what they are being sent. The
 * crests do that work in one glance, before any of the text is read.
 *
 * Crests come from API-Football's CDN and are fetched at generation time.
 * Everything else is drawn here, so the card needs no fonts, no assets and no
 * network beyond those two images.
 *
 * Deliberately absent: the market, the selection, and the confidence score.
 * Those are what a pass buys, and a share card is public by definition.
 */

export const alt = "Kicka prediction";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#0B1020";
const MUTED = "#6B7280";
const ACCENT = "#0F9D58";
const SURFACE = "#F6F8F7";

/** A crest, or the club's initials when the CDN has no artwork for it. */
function Crest({ logo, label }: { logo: string | null; label: string }) {
  if (logo) {
    return (
      // eslint-disable-next-line jsx-a11y/alt-text
      <img src={logo} width={168} height={168} style={{ objectFit: "contain" }} />
    );
  }
  return (
    <div
      style={{
        width: 168,
        height: 168,
        borderRadius: 84,
        background: SURFACE,
        border: `2px solid #E3E8E5`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 56,
        fontWeight: 700,
        color: MUTED,
      }}
    >
      {label.slice(0, 3).toUpperCase()}
    </div>
  );
}

export default async function Image({
  params,
}: {
  // A Promise in Next 16, exactly as in a page. Reading .id off it directly
  // yields undefined, the lookup misses, and every card silently falls back to
  // the bare wordmark, which is a failure that looks like a design decision.
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const meta = await fetchPredictionMeta(id);

  if (!meta) {
    return new ImageResponse(
      (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#fff",
            fontSize: 64,
            fontWeight: 800,
            color: INK,
          }}
        >
          Kick<span style={{ color: ACCENT }}>a</span>
        </div>
      ),
      size,
    );
  }

  const settled = meta.status === "won" || meta.status === "lost";
  const score =
    meta.homeGoals != null && meta.awayGoals != null
      ? `${meta.homeGoals} - ${meta.awayGoals}`
      : null;

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          background: "#FFFFFF",
          padding: "56px 64px",
          justifyContent: "space-between",
        }}
      >
        {/* League, and the state of the match. */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          {meta.leagueLogo && (
            // eslint-disable-next-line jsx-a11y/alt-text
            <img src={meta.leagueLogo} width={44} height={44} style={{ objectFit: "contain" }} />
          )}
          <div style={{ display: "flex", fontSize: 26, color: MUTED, fontWeight: 500 }}>
            {meta.leagueName}
            {meta.leagueCountry ? ` · ${meta.leagueCountry}` : ""}
          </div>

          <div style={{ display: "flex", flex: 1 }} />

          {meta.fixtureStatus === "live" && (
            <div
              style={{
                display: "flex",
                padding: "8px 18px",
                borderRadius: 999,
                background: "#FDECEC",
                color: "#C0392B",
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: 1,
              }}
            >
              LIVE
            </div>
          )}
          {settled && (
            <div
              style={{
                display: "flex",
                padding: "8px 18px",
                borderRadius: 999,
                background: SURFACE,
                color: MUTED,
                fontSize: 22,
                fontWeight: 700,
                letterSpacing: 1,
              }}
            >
              FULL TIME
            </div>
          )}
        </div>

        {/* The match. Crests carry it; the names sit under them. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 56,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 20,
              width: 340,
            }}
          >
            <Crest logo={meta.homeLogo} label={meta.homeShort ?? meta.homeName} />
            <div
              style={{
                display: "flex",
                fontSize: 34,
                fontWeight: 700,
                color: INK,
                textAlign: "center",
              }}
            >
              {meta.homeName}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 10,
            }}
          >
            {score ? (
              <div style={{ display: "flex", fontSize: 76, fontWeight: 800, color: INK }}>
                {score}
              </div>
            ) : (
              <div style={{ display: "flex", fontSize: 44, fontWeight: 700, color: MUTED }}>
                v
              </div>
            )}
            <div style={{ display: "flex", fontSize: 22, color: MUTED }}>
              {kickoffLine(meta)}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 20,
              width: 340,
            }}
          >
            <Crest logo={meta.awayLogo} label={meta.awayShort ?? meta.awayName} />
            <div
              style={{
                display: "flex",
                fontSize: 34,
                fontWeight: 700,
                color: INK,
                textAlign: "center",
              }}
            >
              {meta.awayName}
            </div>
          </div>
        </div>

        {/* Venue on the left, brand on the right. */}
        <div style={{ display: "flex", alignItems: "flex-end" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", fontSize: 24, color: MUTED }}>
              {meta.venue ?? "Venue to be confirmed"}
            </div>
            <div style={{ display: "flex", fontSize: 22, color: MUTED }}>
              AI prediction with the reasoning behind it
            </div>
          </div>

          <div style={{ display: "flex", flex: 1 }} />

          <div style={{ display: "flex", fontSize: 38, fontWeight: 800, color: INK }}>
            Kick<span style={{ color: ACCENT }}>a</span>
          </div>
        </div>
      </div>
    ),
    size,
  );
}
