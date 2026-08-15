import type { Market, Pick } from "./types";

/**
 * Turn a market + selection into something a person reads without decoding.
 * "over_under_2_5" + "over" is a database row; "Over 2.5 goals" is a pick.
 */
/**
 * The call, in words.
 *
 * Both arguments are optional because a locked pick carries neither. The market
 * used to survive locking as a teaser — "there's a handicap call here" — but
 * that gives away where we think the mispricing is, which is the substance of
 * what a subscriber pays for. So a locked pick now says only that a call
 * exists.
 */
export function formatMarket(market?: Market, value?: string): string {
  if (market === undefined) return "Prediction hidden";
  if (value === undefined) return MARKET_LABELS[market] ?? "Prediction";
  const v = value.toLowerCase();

  switch (market) {
    case "1x2":
      return v === "1" ? "Home win" : v === "x" ? "Draw" : "Away win";
    case "double_chance":
      return value === "1X"
        ? "Home or draw"
        : value === "X2"
          ? "Draw or away"
          : "Home or away";
    case "draw_no_bet":
      return v === "1" ? "Home (draw no bet)" : "Away (draw no bet)";
    case "btts":
      return v === "yes" ? "Both teams to score" : "Both teams not to score";
    case "over_under_1_5":
      return `${cap(v)} 1.5 goals`;
    case "over_under_2_5":
      return `${cap(v)} 2.5 goals`;
    case "over_under_3_5":
      return `${cap(v)} 3.5 goals`;
    case "first_half_goals":
      return `${cap(v)} 0.5 first-half goals`;
    case "second_half_goals":
      return `${cap(v)} 0.5 second-half goals`;
    case "corners_over_under":
      return `${cap(v)} corners`;
    case "correct_score":
      return `Correct score ${value}`;
    case "handicap":
      return `Handicap ${value}`;
    default:
      return value;
  }
}

/** Short label for tight spaces — pick cards, table cells. */
export function formatMarketShort(market: Market, value: string): string {
  const v = value.toLowerCase();
  switch (market) {
    case "1x2":
      return v === "1" ? "1" : v === "x" ? "X" : "2";
    case "over_under_1_5":
      return `${v === "over" ? "O" : "U"} 1.5`;
    case "over_under_2_5":
      return `${v === "over" ? "O" : "U"} 2.5`;
    case "over_under_3_5":
      return `${v === "over" ? "O" : "U"} 3.5`;
    case "btts":
      return v === "yes" ? "BTTS" : "No BTTS";
    case "double_chance":
      return value;
    case "draw_no_bet":
      return `DNB ${value}`;
    case "correct_score":
      return value;
    case "handicap":
      return value;
    case "corners_over_under":
      return `${v === "over" ? "O" : "U"} corners`;
    case "first_half_goals":
      return `1H ${v === "over" ? "O" : "U"} 0.5`;
    case "second_half_goals":
      return `2H ${v === "over" ? "O" : "U"} 0.5`;
    default:
      return value;
  }
}

export const MARKET_LABELS: Record<Market, string> = {
  "1x2": "Match result",
  over_under_2_5: "Over/Under 2.5",
  over_under_1_5: "Over/Under 1.5",
  over_under_3_5: "Over/Under 3.5",
  btts: "Both teams to score",
  double_chance: "Double chance",
  handicap: "Handicap",
  corners_over_under: "Corners",
  correct_score: "Correct score",
  draw_no_bet: "Draw no bet",
  first_half_goals: "First half goals",
  second_half_goals: "Second half goals",
};

/** The engine works on 0–10; people read percentages. */
export function confidencePercent(score: number): number {
  return Math.round(score * 10);
}

/** Outcome colour is fixed across the app: teal wins, red loses. */
export function statusColor(
  status: Pick["status"],
): "success" | "danger" | "warning" | "default" {
  switch (status) {
    case "won":
      return "success";
    case "lost":
      return "danger";
    case "pending":
      return "warning";
    default:
      return "default";
  }
}

export function stakeLabel(unit: number): string {
  return `${unit}u`;
}

/** Kickoff, relative when it's close enough to matter. */
export function formatKickoff(iso: string): string {
  const date = new Date(iso);
  const now = Date.now();
  const diffMin = Math.round((date.getTime() - now) / 60_000);

  if (diffMin > 0 && diffMin < 60) return `in ${diffMin}m`;
  if (diffMin >= 60 && diffMin < 60 * 12)
    return `in ${Math.round(diffMin / 60)}h`;

  return date.toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export function formatDateShort(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
  });
}

export function teamName(t: Pick["homeTeam"]): string {
  return t?.name ?? t?.shortName ?? "TBD";
}

export function teamShort(t: Pick["homeTeam"]): string {
  return t?.shortName ?? t?.name ?? "TBD";
}

/** UTC day window — every access rule in the app is keyed to the UTC day. */
export function utcDayWindow(base = new Date()) {
  const start = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate()),
  );
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { startISO: start.toISOString(), endISO: end.toISOString() };
}

export function formatPercent(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatSigned(value: number, digits = 1): string {
  const pct = value * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(digits)}%`;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
