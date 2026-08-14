import Anthropic from "@anthropic-ai/sdk";
import type {
  AiProvider,
  EnginePick,
  FootballProvider,
  MessagingProvider,
  PaymentProvider,
  RawFixture,
} from "./types";
import { MARKETS } from "@/lib/types";

/* -------------------------------------------------------------------------
 * API-Football
 * ---------------------------------------------------------------------- */

type ApiFixture = {
  fixture: {
    id: number;
    referee: string | null;
    date: string;
    venue: { name: string | null };
    status: { short: string };
  };
  league: {
    id: number;
    name: string;
    country: string;
    season: number;
    round: string;
  };
  teams: {
    home: { id: number; name: string };
    away: { id: number; name: string };
  };
  goals: { home: number | null; away: number | null };
  score: { halftime: { home: number | null; away: number | null } };
};

const LIVE_CODES = ["1H", "HT", "2H", "ET", "BT", "P", "SUSP", "INT", "LIVE"];
const DONE_CODES = ["FT", "AET", "PEN", "AWD", "WO"];

function mapStatus(code: string): RawFixture["status"] {
  if (LIVE_CODES.includes(code)) return "live";
  if (DONE_CODES.includes(code)) return "finished";
  return "scheduled";
}

function shortName(name: string): string {
  const words = name
    .replace(/\b(FC|CF|SC|AC|AS|SS|US|CD)\b/gi, "")
    .trim()
    .split(/\s+/);
  if (words.length >= 3) return words.slice(0, 3).map((w) => w[0]).join("").toUpperCase();
  if (words.length === 2) return (words[0].slice(0, 2) + words[1][0]).toUpperCase();
  return name.slice(0, 3).toUpperCase();
}

function toRaw(f: ApiFixture): RawFixture {
  return {
    externalId: f.fixture.id,
    leagueExternalId: f.league.id,
    leagueName: f.league.name,
    country: f.league.country,
    season: f.league.season,
    round: f.league.round ?? null,
    kickoff: f.fixture.date,
    venue: f.fixture.venue?.name ?? null,
    referee: f.fixture.referee ?? null,
    status: mapStatus(f.fixture.status.short),
    homeGoals: f.goals.home,
    awayGoals: f.goals.away,
    htHomeGoals: f.score?.halftime?.home ?? null,
    htAwayGoals: f.score?.halftime?.away ?? null,
    home: {
      externalId: f.teams.home.id,
      name: f.teams.home.name,
      shortName: shortName(f.teams.home.name),
    },
    away: {
      externalId: f.teams.away.id,
      name: f.teams.away.name,
      shortName: shortName(f.teams.away.name),
    },
  };
}

async function apiFootball(path: string): Promise<ApiFixture[]> {
  const key = process.env.API_FOOTBALL_KEY;
  if (!key) throw new Error("API_FOOTBALL_KEY is not set.");

  const base = process.env.API_FOOTBALL_BASE_URL ?? "https://v3.football.api-sports.io";
  const res = await fetch(`${base}${path}`, {
    headers: { "x-apisports-key": key },
    cache: "no-store",
  });

  if (!res.ok) {
    throw new Error(`API-Football ${res.status}: ${(await res.text()).slice(0, 200)}`);
  }

  const json = (await res.json()) as { response: ApiFixture[] };
  return json.response ?? [];
}

/**
 * Season resolution mirrors the Convex original: guess from the calendar, and
 * try the calendar year too, because tournaments and domestic leagues disagree
 * about what "season" means.
 */
function seasonsFor(date: string): number[] {
  const d = new Date(date);
  const year = d.getUTCFullYear();
  const primary = d.getUTCMonth() <= 5 ? year - 1 : year;
  return [...new Set([primary, year])];
}

export const liveFootball: FootballProvider = {
  async fetchFixtures(date, leagueIds) {
    const seen = new Set<number>();
    const out: RawFixture[] = [];

    for (const leagueId of leagueIds) {
      for (const season of seasonsFor(date)) {
        try {
          const rows = await apiFootball(
            `/fixtures?date=${date}&league=${leagueId}&season=${season}`,
          );
          for (const row of rows) {
            if (seen.has(row.fixture.id)) continue;
            seen.add(row.fixture.id);
            out.push(toRaw(row));
          }
          if (rows.length) break; // right season found
        } catch (err) {
          console.error(`[football] league ${leagueId} season ${season}:`, err);
        }
      }
    }

    return out;
  },

  async fetchResults(externalIds) {
    if (!externalIds.length) return [];
    const out: RawFixture[] = [];

    // The API caps ids per request; chunk conservatively.
    for (let i = 0; i < externalIds.length; i += 20) {
      const chunk = externalIds.slice(i, i + 20);
      try {
        const rows = await apiFootball(`/fixtures?ids=${chunk.join("-")}`);
        out.push(...rows.map(toRaw));
      } catch (err) {
        console.error("[football] results chunk failed:", err);
      }
    }

    return out;
  },
};

/* -------------------------------------------------------------------------
 * Anthropic
 *
 * Three things changed moving off the Hercules OpenAI-compatible gateway:
 *   1. Model ids drop the "anthropic/" prefix — it's `claude-opus-5`.
 *   2. `temperature` is REJECTED on current models. The old code sent 0.25;
 *      steer with the prompt instead.
 *   3. The JSON-coaxing (fence stripping, corrective retry) is replaced by
 *      structured outputs, which removes the failure mode entirely.
 * ---------------------------------------------------------------------- */

const PICK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["picks"],
  properties: {
    picks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "fixtureIndex",
          "predictionType",
          "predictedValue",
          "confidenceScore",
          "reasoning",
          "reasoningTags",
        ],
        properties: {
          fixtureIndex: { type: "integer" },
          predictionType: { type: "string", enum: [...MARKETS] },
          predictedValue: { type: "string" },
          confidenceScore: { type: "number" },
          reasoning: { type: "string" },
          reasoningTags: { type: "array", items: { type: "string" } },
          altMarket: { type: "string", enum: [...MARKETS] },
          altPredictedValue: { type: "string" },
          altConfidence: { type: "number" },
          mraSignalHome: { type: "string" },
          mraSignalAway: { type: "string" },
          filtersApplied: {
            type: "object",
            additionalProperties: false,
            properties: {
              chaosFilter: { type: "boolean" },
              restRule: { type: "boolean" },
              keyMan: { type: "boolean" },
              travel: { type: "boolean" },
              clvDrift: { type: "boolean" },
            },
          },
        },
      },
    },
  },
} as const;

/**
 * The engine's confidence occasionally comes back on the wrong scale — 0–1 as
 * a probability, or 0–100 as a percentage. Left alone, a 0.92 silently fails
 * the `>= minConfidence` filter and the pick vanishes, which was the single
 * biggest cause of "no picks generated" in the original app.
 */
export function normaliseConfidence(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  let v = raw;
  if (v <= 1) v *= 10;
  else if (v > 10) v /= 10;
  return Math.min(Math.max(v, 0), 10);
}

export const liveAi: AiProvider = {
  async generatePicks({ systemPrompt, userPrompt, maxPicks }) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");

    const client = new Anthropic({ apiKey });

    // Streaming because max_tokens is large; non-streaming risks an HTTP timeout.
    const stream = client.messages.stream({
      model: process.env.ANTHROPIC_MODEL ?? "claude-opus-5",
      max_tokens: 32000,
      system: systemPrompt,
      thinking: { type: "adaptive" },
      output_config: {
        effort: "high",
        format: { type: "json_schema", schema: PICK_SCHEMA },
      },
      messages: [
        {
          role: "user",
          content: `${userPrompt}\n\nReturn at most ${maxPicks} picks. An empty list is a valid answer when you hold no genuine edge.`,
        },
      ],
    } as Parameters<typeof client.messages.stream>[0]);

    const message = await stream.finalMessage();

    // Safety classifiers can decline; check before reading content.
    if (message.stop_reason === "refusal") {
      throw new Error("Model declined the request.");
    }

    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");

    const parsed = JSON.parse(text) as { picks: EnginePick[] };

    return (parsed.picks ?? []).map((p) => ({
      ...p,
      confidenceScore: normaliseConfidence(p.confidenceScore),
      altConfidence:
        p.altConfidence != null ? normaliseConfidence(p.altConfidence) : undefined,
    }));
  },
};

/* -------------------------------------------------------------------------
 * Paystack
 * ---------------------------------------------------------------------- */

const PAYSTACK = "https://api.paystack.co";

export const livePayments: PaymentProvider = {
  async initialize({ email, amountMinor, currency, reference, metadata }) {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    const publicKey = process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY;
    if (!secret || !publicKey) throw new Error("Paystack keys are not set.");

    const res = await fetch(`${PAYSTACK}/transaction/initialize`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email,
        amount: amountMinor,
        currency,
        reference,
        metadata,
      }),
    });

    const json = (await res.json()) as {
      status: boolean;
      message: string;
      data?: { access_code: string; reference: string };
    };

    if (!res.ok || !json.status || !json.data) {
      throw new Error(json.message || "Could not start the payment.");
    }

    return {
      reference: json.data.reference,
      accessCode: json.data.access_code,
      publicKey,
      amountMinor,
      currency,
    };
  },

  async verify(reference) {
    const secret = process.env.PAYSTACK_SECRET_KEY;
    if (!secret) throw new Error("PAYSTACK_SECRET_KEY is not set.");

    const res = await fetch(
      `${PAYSTACK}/transaction/verify/${encodeURIComponent(reference)}`,
      { headers: { Authorization: `Bearer ${secret}` }, cache: "no-store" },
    );

    const json = (await res.json()) as {
      status: boolean;
      message: string;
      data?: { status: string; amount: number; currency: string; reference: string };
    };

    if (!res.ok || !json.status || !json.data) {
      throw new Error(json.message || "Could not verify the payment.");
    }

    return {
      status:
        json.data.status === "success"
          ? "success"
          : json.data.status === "failed"
            ? "failed"
            : "pending",
      reference: json.data.reference,
      amountMinor: json.data.amount,
      currency: json.data.currency,
    };
  },
};

/* -------------------------------------------------------------------------
 * Email + SMS
 * ---------------------------------------------------------------------- */

export const liveMessaging: MessagingProvider = {
  async sendEmail({ to, subject, html }) {
    const key = process.env.RESEND_API_KEY;
    if (!key) throw new Error("RESEND_API_KEY is not set.");

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM ?? "picks@moonodds.app",
        to,
        subject,
        html,
      }),
    });

    if (!res.ok) {
      throw new Error(`Resend ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
  },

  async sendSms({ to, message }) {
    const id = process.env.HUBTEL_CLIENT_ID;
    const secret = process.env.HUBTEL_CLIENT_SECRET;
    if (!id || !secret) throw new Error("Hubtel credentials are not set.");

    const auth = Buffer.from(`${id}:${secret}`).toString("base64");
    const res = await fetch("https://smsc.hubtel.com/v1/messages/send", {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        From: process.env.HUBTEL_SENDER_ID ?? "MoonOdds",
        To: to,
        Content: message,
      }),
    });

    if (!res.ok) {
      throw new Error(`Hubtel ${res.status}: ${(await res.text()).slice(0, 200)}`);
    }
  },
};
