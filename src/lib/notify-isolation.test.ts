import { describe, expect, it, vi } from "vitest";
import { deliver, settleBroadcast } from "./pipeline";

/**
 * Broadcast delivery.
 *
 * The bug these cover: sends were bare `await`s inside the recipient loop, so
 * the first failure threw out of the loop and everyone after it got nothing,
 * including on channels that were working. The job then retried the whole list,
 * re-sending to everyone already reached. None of that produced an error a
 * person would see, because the outbox recorded it as an ordinary job failure.
 */

describe("deliver", () => {
  it("reports success without throwing", async () => {
    expect(await deliver("jobs/test", "email", async () => {})).toBe(true);
  });

  it("contains a failure instead of letting it escape the loop", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const ok = await deliver("jobs/test", "sms", async () => {
      throw new Error("unreachable number");
    });
    expect(ok).toBe(false);
    vi.restoreAllMocks();
  });

  it("reports the failure rather than swallowing it", async () => {
    // A contained failure that says nothing is indistinguishable from a send
    // that never happened, on the path that tells people their picks are ready.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await deliver("jobs/daily_picks_ready", "sms", async () => {
      throw new Error("unreachable number");
    });
    const logged = warn.mock.calls.map((c) => c.join(" ")).join("\n");
    vi.restoreAllMocks();
    expect(logged).toContain("jobs/daily_picks_ready");
    expect(logged).toContain("unreachable number");
    expect(logged).toContain('"channel":"sms"');
  });
});

describe("settleBroadcast", () => {
  it("stays quiet when everything was delivered", () => {
    expect(() => settleBroadcast("jobs/test", 5, 0)).not.toThrow();
  });

  it("does NOT fail the job on partial delivery", () => {
    // Retrying would re-send to the four who already received it.
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(() => settleBroadcast("jobs/test", 4, 1)).not.toThrow();
    vi.restoreAllMocks();
  });

  it("fails the job when nothing got through, so the outbox retries", () => {
    // Zero delivered is a credential or provider problem, which is what retry
    // exists for, and nobody was reached so nobody gets a duplicate.
    expect(() => settleBroadcast("jobs/test", 0, 3)).toThrow(/every delivery failed/);
  });

  it("stays quiet when there were no recipients at all", () => {
    expect(() => settleBroadcast("jobs/test", 0, 0)).not.toThrow();
  });
});
