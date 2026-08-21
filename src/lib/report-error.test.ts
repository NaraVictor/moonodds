import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reportError } from "./report-error";

/**
 * The Sentry forwarder.
 *
 * Every failure path in this module is swallowed on purpose, so nothing about
 * a malformed request surfaces at runtime: a broken envelope, a wrong content
 * type or a bad auth header all look exactly like a working reporter that
 * happens to have seen no errors. These assertions are the only place the
 * difference is observable.
 */

const DSN = "https://pub1234567890abcdef@o123.ingest.de.sentry.io/456";

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn().mockResolvedValue({ ok: true });
  vi.stubGlobal("fetch", fetchSpy);
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  process.env.SENTRY_DSN = DSN;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.SENTRY_DSN;
});

const sent = () => {
  const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
  const lines = (init.body as string).split("\n");
  return {
    url,
    init,
    header: JSON.parse(lines[0]),
    itemHeader: JSON.parse(lines[1]),
    payload: JSON.parse(lines[2]),
    lineCount: lines.length,
  };
};

describe("reportError forwarding", () => {
  it("posts to the envelope endpoint, not the retired store endpoint", () => {
    reportError(new Error("boom"), { scope: "cron/daily-picks" });
    expect(sent().url).toBe("https://o123.ingest.de.sentry.io/api/456/envelope/");
  });

  it("frames the envelope as three newline-delimited JSON lines", () => {
    // The framing is positional: an extra or missing line silently changes
    // which object Sentry reads as the payload.
    reportError(new Error("boom"), { scope: "cron/daily-picks" });
    expect(sent().lineCount).toBe(3);
    expect(sent().itemHeader).toEqual({ type: "event" });
  });

  it("uses the same event_id in the header and the payload", () => {
    reportError(new Error("boom"), { scope: "cron/daily-picks" });
    const s = sent();
    expect(s.header.event_id).toBe(s.payload.event_id);
    expect(s.header.event_id).toMatch(/^[0-9a-f]{32}$/);
  });

  it("authenticates with the DSN's public key", () => {
    reportError(new Error("boom"), { scope: "cron/daily-picks" });
    const headers = sent().init.headers as Record<string, string>;
    expect(headers["X-Sentry-Auth"]).toContain("sentry_key=pub1234567890abcdef");
    expect(headers["Content-Type"]).toBe("application/x-sentry-envelope");
  });

  it("redacts credentials from detail before they leave the process", () => {
    reportError(new Error("boom"), {
      scope: "checkout",
      detail: { reference: "ref_1", paystackSecretKey: "sk_live_dangerous", userId: "u1" },
    });
    const extra = sent().payload.extra;
    expect(extra.paystackSecretKey).toBe("[redacted]");
    expect(extra.reference).toBe("ref_1");
  });

  it("sends nothing at all when no DSN is configured", () => {
    delete process.env.SENTRY_DSN;
    reportError(new Error("boom"), { scope: "cron/daily-picks" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not throw when the DSN is malformed", () => {
    process.env.SENTRY_DSN = "not-a-url";
    expect(() => reportError(new Error("boom"), { scope: "x" })).not.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("does not throw when the transport rejects", async () => {
    fetchSpy.mockRejectedValue(new Error("sentry is down"));
    expect(() => reportError(new Error("boom"), { scope: "x" })).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
  });
});
