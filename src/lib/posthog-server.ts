import { PostHog } from "posthog-node";

/**
 * Server-side PostHog client.
 *
 * Shared singleton for server components and route handlers that do not need
 * per-request isolation. For per-request handlers (serverless / edge functions),
 * call flush() before returning so the enqueued event is sent before the
 * process tears down.
 *
 * flushAt 1 / flushInterval 0 makes every capture send immediately, which is
 * required in short-lived route handlers where the process exits before a
 * batched flush can run.
 */

let posthogClient: PostHog | null = null;

export function getPostHogClient(): PostHog {
  const token = process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN;
  const host = process.env.NEXT_PUBLIC_POSTHOG_HOST;

  if (!token) {
    if (process.env.NODE_ENV !== "production") {
      console.error(
        "NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN variable required by PostHog is missing or un-configured, " +
          "this causes events to be silently missed. This error stops appearing once NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN is configured",
      );
    }
  }

  if (!posthogClient) {
    posthogClient = new PostHog(token ?? "", {
      host,
      flushAt: 1,
      flushInterval: 0,
      enableExceptionAutocapture: true,
    });
  }
  return posthogClient;
}

/**
 * Capture and flush, and never let analytics break the request it is measuring.
 *
 * The routes these calls sit in are the ones where a thrown error costs real
 * money. A `capture` plus `await flush()` in the Paystack webhook is a network
 * round trip to a third party inside the handler's try block: if PostHog is
 * slow the webhook is slow, and if it throws, the catch returns 500 — which
 * tells Paystack to RETRY a payment that has already been settled. In the
 * checkout route the same throw would 500 a request that had already written a
 * payment row and opened a transaction, stranding it.
 *
 * The flush stays, because without it a serverless handler is torn down before
 * the batched send runs and the event is silently lost. What changes is that a
 * failure is reported and swallowed rather than propagated. Analytics is the
 * least important thing happening in any of these functions and it should fail
 * like it.
 */
export async function captureServerEvent(event: {
  distinctId: string;
  event: string;
  properties?: Record<string, unknown>;
}): Promise<void> {
  try {
    const client = getPostHogClient();
    client.capture(event);
    await client.flush();
  } catch (err) {
    console.warn(`[posthog] could not record ${event.event}:`, err);
  }
}
