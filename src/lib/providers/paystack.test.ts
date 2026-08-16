import { afterEach, describe, expect, it, vi } from "vitest";
import { livePayments } from "./live";

/**
 * The key guard.
 *
 * A live secret paired with a test public key initialises fine and then fails
 * at the popup with a message that blames the customer's card. These assert the
 * mismatch is caught where it can say what is actually wrong.
 *
 * No network: every case here fails before fetch is reached.
 */

const KEYS = {
  liveSecret: "sk_live_" + "a".repeat(40),
  testSecret: "sk_test_" + "b".repeat(40),
  livePublic: "pk_live_" + "c".repeat(40),
  testPublic: "pk_test_" + "d".repeat(40),
};

function setKeys(secret?: string, publicKey?: string) {
  vi.stubEnv("PAYSTACK_SECRET_KEY", secret ?? "");
  vi.stubEnv("NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY", publicKey ?? "");
}

const init = () =>
  livePayments.initialize({
    email: "a@b.test",
    amountMinor: 4500,
    currency: "GHS",
    reference: "ref-1",
    metadata: {},
  });

afterEach(() => vi.unstubAllEnvs());

describe("paystack key handling", () => {
  it("refuses a missing secret key", async () => {
    setKeys(undefined, KEYS.livePublic);
    await expect(init()).rejects.toThrow(/PAYSTACK_SECRET_KEY is not set/);
  });

  it("refuses a missing public key", async () => {
    setKeys(KEYS.liveSecret, undefined);
    await expect(init()).rejects.toThrow(/PUBLIC_KEY is not set/);
  });

  it("refuses a live secret paired with a test public key", async () => {
    setKeys(KEYS.liveSecret, KEYS.testPublic);
    await expect(init()).rejects.toThrow(/secret key is live and the public key is test/);
  });

  it("refuses a test secret paired with a live public key", async () => {
    setKeys(KEYS.testSecret, KEYS.livePublic);
    await expect(init()).rejects.toThrow(/secret key is test and the public key is live/);
  });

  it("refuses keys that are not Paystack keys at all", async () => {
    setKeys("not-a-key", KEYS.livePublic);
    await expect(init()).rejects.toThrow(/does not look like a Paystack secret key/);

    setKeys(KEYS.liveSecret, "not-a-key");
    await expect(init()).rejects.toThrow(/does not look like a Paystack public key/);
  });

  it("never puts the secret into the error it throws", async () => {
    setKeys(KEYS.liveSecret, KEYS.testPublic);
    const err = await init().catch((e: Error) => e);
    expect(String(err)).not.toContain(KEYS.liveSecret);
  });
});
