/**
 * The Paystack inline checkout, loaded on demand.
 *
 * The checkout page used to await a 700ms timeout with a comment saying this is
 * where the popup would go, then call verify. Against a live key that charges
 * nobody and activates a pass for free.
 *
 * The script is loaded when the customer actually presses pay, not on every
 * page: it is a third-party script on a page most visitors never reach, and the
 * CSP admits exactly one host for it.
 *
 * No key is read here. The public key comes back from our own initialise call,
 * so the client never holds a build-time copy of it and a rotated key takes
 * effect on the next request rather than the next deploy.
 */

const SCRIPT_SRC = "https://js.paystack.co/v2/inline.js";

type PaystackHandler = {
  resumeTransaction: (accessCode: string, callbacks?: PaystackCallbacks) => void;
};

type PaystackCallbacks = {
  onSuccess?: (tx: { reference: string }) => void;
  onLoad?: () => void;
  onCancel?: () => void;
  onError?: (err: { message?: string }) => void;
};

declare global {
  interface Window {
    PaystackPop?: new () => PaystackHandler;
  }
}

let loading: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Paystack can only load in a browser."));
  }
  if (window.PaystackPop) return Promise.resolve();
  if (loading) return loading;

  loading = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      `script[src="${SCRIPT_SRC}"]`,
    );
    if (existing) {
      existing.addEventListener("load", () => resolve());
      existing.addEventListener("error", () =>
        reject(new Error("Could not load the payment window.")),
      );
      return;
    }

    const el = document.createElement("script");
    el.src = SCRIPT_SRC;
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => {
      loading = null;
      reject(new Error("Could not load the payment window. Check your connection."));
    };
    document.head.appendChild(el);
  });

  return loading;
}

export type PaymentOutcome =
  | { status: "success"; reference: string }
  | { status: "cancelled" };

/**
 * Open the popup and settle when the customer finishes with it.
 *
 * Resolves on success or cancellation, rejects only when the popup itself
 * failed. A cancellation is not an error: the customer changed their mind, and
 * treating that as a failure produces an alarming message for a normal act.
 *
 * Success here means the popup said so. It is not proof of payment: the caller
 * still verifies server-side, and the webhook is what settles it regardless of
 * what happens to this browser afterwards.
 */
export async function openPaystack(accessCode: string): Promise<PaymentOutcome> {
  await loadScript();

  const Pop = window.PaystackPop;
  if (!Pop) throw new Error("The payment window did not initialise.");

  return new Promise<PaymentOutcome>((resolve, reject) => {
    let settled = false;
    const once = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };

    try {
      new Pop().resumeTransaction(accessCode, {
        onSuccess: (tx) => once(() => resolve({ status: "success", reference: tx.reference })),
        onCancel: () => once(() => resolve({ status: "cancelled" })),
        onError: (err) =>
          once(() => reject(new Error(err?.message || "The payment could not be completed."))),
      });
    } catch (err) {
      once(() => reject(err instanceof Error ? err : new Error("The payment window failed to open.")));
    }
  });
}
