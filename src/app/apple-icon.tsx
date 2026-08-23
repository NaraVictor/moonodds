import { ImageResponse } from "next/og";
import { soraBold } from "@/lib/icon-font";

/**
 * The home-screen icon.
 *
 * iOS renders this at 180px on a surface it chooses, and it does NOT round the
 * corners of a transparent image or composite it onto anything — whatever is
 * drawn here is what sits on the home screen. So it paints its own ground and
 * gives the mark real breathing room, because a wordmark sized to fill a
 * 32-pixel tab looks cramped scaled up to a phone icon.
 */
export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default async function AppleIcon() {
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
          background: "#f8faf8",
          fontSize: 118,
          fontFamily: font ? "Sora" : undefined,
          fontWeight: 700,
          letterSpacing: "-0.05em",
          paddingBottom: 10,
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
