"use client";

import { useState } from "react";

/**
 * Team crest.
 *
 * The references make logos substantially larger than dashboard icons, they
 * are how you identify the match at a glance, so they get the space. When a
 * logo is missing we fall back to a monogram rather than a broken image or a
 * grey circle, so the card never looks unfinished.
 */

const TINTS = [
  ["#EEF2FF", "#3538CD"],
  ["#FEF3F2", "#B42318"],
  ["#ECFDF3", "#027A48"],
  ["#FFFAEB", "#B54708"],
  ["#F0EDFF", "#5A3FD6"],
  ["#EFF8FF", "#175CD3"],
] as const;

function tintFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return TINTS[h % TINTS.length];
}

export function TeamCrest({
  name,
  logo,
  size = 64,
  onFeature = false,
}: {
  name: string;
  logo?: string | null;
  size?: number;
  onFeature?: boolean;
}) {
  // Crest URLs are derived from an id, so a team the CDN doesn't carry yields a
  // 404. Falling back to the monogram keeps the card intact; a broken-image
  // glyph would not.
  const [failed, setFailed] = useState(false);

  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  if (logo && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logo}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        onError={() => setFailed(true)}
        className="flex-none object-contain"
        style={{ width: size, height: size }}
      />
    );
  }

  const [bg, fg] = tintFor(name);

  return (
    <div
      aria-hidden
      className="flex flex-none items-center justify-center rounded-full font-bold"
      style={{
        width: size,
        height: size,
        background: onFeature ? "rgba(255,255,255,0.1)" : bg,
        color: onFeature ? "#fff" : fg,
        fontSize: size * 0.34,
        letterSpacing: "-0.02em",
      }}
    >
      {initials}
    </div>
  );
}
