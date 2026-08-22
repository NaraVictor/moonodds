import { NextResponse } from "next/server";
import { z } from "zod";
import { enforceRateLimit } from "@/lib/rate-limit";
import { reportError } from "@/lib/report-error";

/**
 * Where the client error boundaries report to.
 *
 * The boundaries cannot call reportError themselves: it reads SENTRY_DSN,
 * which is server-only and must stay that way, so a client bundle importing it
 * would report nothing at best and publish the DSN at worst.
 *
 * Deliberately unauthenticated. The errors worth hearing about most are the
 * ones that stop a page rendering, and those can happen before or instead of a
 * session existing. That makes it a public write endpoint, so it is rate
 * limited and everything it accepts is bounded and validated: an unbounded
 * public path into your error tracker is a way to lose a Sentry quota to
 * someone who noticed it.
 */
const Payload = z.object({
  message: z.string().max(500),
  digest: z.string().max(100).nullish(),
  stack: z.string().max(4000).nullish(),
  path: z.string().max(300).nullish(),
  fatal: z.boolean().optional(),
});

export async function POST(request: Request) {
  const limited = await enforceRateLimit(request, {
    scope: "client-error",
    limit: 20,
    windowSeconds: 60,
    message: "Too many reports.",
  });
  if (limited) return limited;

  const parsed = Payload.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Bad payload." }, { status: 400 });
  }

  const { message, digest, stack, path, fatal } = parsed.data;

  const err = new Error(message);
  err.name = fatal ? "ClientFatalError" : "ClientRenderError";
  if (stack) err.stack = stack;

  reportError(err, {
    scope: fatal ? "client/global-error" : "client/error",
    level: fatal ? "fatal" : "error",
    detail: {
      digest: digest ?? null,
      path: path ?? null,
      userAgent: request.headers.get("user-agent")?.slice(0, 200) ?? null,
    },
  });

  return NextResponse.json({ received: true });
}
