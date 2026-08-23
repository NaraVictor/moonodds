import { ImageResponse } from "next/og";
import { soraBold } from "@/lib/icon-font";

/**
 * The browser-tab icon.
 *
 * Was create-next-app's Next.js logo, 25KB of somebody else's branding, which
 * is the kind of leftover nobody sees because a favicon is the one part of a
 * product you look at least and recognise fastest.
 *
 * It is the tail of the wordmark: "ka", with the accent on the final letter,
 * the same treatment the header uses. Cropping to the end rather than the
 * start is deliberate — "Ki" reads as an abbreviation of nothing, while the
 * accented "a" is the piece of the mark that is actually distinctive, and at
 * 16 pixels distinctiveness beats completeness.
 *
 * Sora 700 is embedded rather than assumed. ImageResponse's default face has
 * no bold, so `fontWeight: 700` was being accepted and ignored, and the mark
 * came out lighter than the wordmark it is cropped from. See lib/icon-font.
 */
export const size = { width: 32, height: 32 };
export const contentType = "image/png";

export default async function Icon() {
  const font = await soraBold();

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          // The app's own ground, not pure white: a white tile disappears into
          // a light browser chrome, and this carries the same green cast as
          // every surface in the product.
          background: "#f8faf8",
          fontSize: 25,
          fontFamily: font ? "Sora" : undefined,
          fontWeight: 700,
          letterSpacing: "-0.05em",
          // Optical centring. The default sans sits its baseline low in the
          // box, so a mathematically centred pair reads as bottom-heavy.
          paddingBottom: 2,
        }}
      >
        <span style={{ color: "#111a2e" }}>k</span>
        <span style={{ color: "#1f8a5b" }}>a</span>
      </div>
    ),
    {
      ...size,
      fonts: font
        ? [{ name: "Sora", data: font, weight: 700 as const, style: "normal" as const }]
        : undefined,
    },
  );
}
