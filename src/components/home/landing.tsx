"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Lock, Sparkles, TrendingUp, ShieldCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  PredictionCard,
  LockedPredictionCard,
} from "@/components/predictions/prediction-card";
import { ReasoningSheet } from "@/components/predictions/reasoning-sheet";
import { LinkButton } from "@/components/ui/link-button";
import { useEngineStats } from "@/lib/queries";
import { formatPercent } from "@/lib/format";
import type { Pick } from "@/lib/types";

type Preview = {
  preview: Pick | null;
  lockedCount: number;
  totalToday: number;
  hasFullAccess: boolean;
  isFirstDay: boolean;
};

function useLandingPreview() {
  return useQuery({
    queryKey: ["landing-preview"],
    queryFn: async (): Promise<Preview> => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("get_landing_preview");
      if (error) throw error;
      return data as Preview;
    },
  });
}

export function Landing() {
  const { data, isPending } = useLandingPreview();
  const { data: stats } = useEngineStats();
  const [reasoning, setReasoning] = useState<Pick | null>(null);

  const locked = Math.min(data?.lockedCount ?? 2, 2);

  return (
    <div className="flex flex-col">
      <ReasoningSheet
        pick={reasoning}
        isOpen={reasoning !== null}
        onClose={() => setReasoning(null)}
      />

      {/* ---------------------------- hero ---------------------------- */}
      <section className="mx-auto w-full max-w-5xl px-5 pt-14 pb-10 sm:pt-20">
        <div className="mx-auto max-w-2xl text-center">
          <span className="label inline-flex items-center gap-1.5 rounded-full border border-accent-edge bg-accent-wash px-3 py-1 text-accent">
            <Sparkles className="h-3 w-3" />
            AI sports intelligence
          </span>

          <h1 className="display mt-5 text-[2.6rem] sm:text-6xl">
            Smarter calls,
            <br />
            backed by the data.
          </h1>

          <p className="mx-auto mt-5 max-w-lg text-[15px] leading-relaxed text-muted sm:text-base">
            MoonOdds reads the numbers behind every fixture — form, expected
            goals, head-to-head, rest and travel — then tells you what it thinks
            and exactly why. You stay in charge of the call.
          </p>

          <div className="mt-7 flex flex-col items-center justify-center gap-2.5 sm:flex-row">
            <LinkButton href="/auth/sign-up" size="lg" variant="primary" className="w-full sm:w-auto">
              Sign up free
            </LinkButton>
            <LinkButton href="/auth/sign-in" size="lg" variant="secondary" className="w-full sm:w-auto">
              Log in
            </LinkButton>
          </div>

          {stats && stats.totalPicks > 0 && (
            <dl className="mt-9 flex items-center justify-center divide-x divide-border">
              <Stat label="Win rate" value={formatPercent(stats.winRate, 0)} />
              <Stat label="Settled picks" value={String(stats.totalPicks)} />
              <Stat label="Markets" value="12" />
            </dl>
          )}
        </div>
      </section>

      {/* ----------------------- today's predictions ----------------------- */}
      <section className="mx-auto w-full max-w-5xl px-5 pb-16">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <h2 className="display text-2xl sm:text-3xl">Today&rsquo;s AI predictions</h2>
            <p className="mt-1 text-sm text-muted">
              {data?.totalToday
                ? `${data.totalToday} calls on today's board.`
                : "Fresh calls every matchday."}
            </p>
          </div>
          <span className="label hidden items-center gap-1.5 sm:inline-flex">
            <TrendingUp className="h-3.5 w-3.5" />
            Updated daily
          </span>
        </div>

        {isPending ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <div className="shimmer h-[26rem] rounded-[1.75rem] bg-surface lg:row-span-2" />
            <div className="shimmer h-[12.5rem] rounded-[1.75rem] bg-surface" />
            <div className="shimmer h-[12.5rem] rounded-[1.75rem] bg-surface" />
          </div>
        ) : !data?.preview ? (
          <div className="rounded-[1.75rem] border border-border bg-surface p-14 text-center">
            <p className="font-semibold">Today&rsquo;s board is being built</p>
            <p className="mx-auto mt-1.5 max-w-sm text-sm text-muted">
              Predictions publish each morning once the engine has run. Check
              back shortly.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
            {/* The one fully-readable prediction — the product preview. */}
            <div className="rise lg:sticky lg:top-24">
              <PredictionCard
                pick={data.preview}
                feature
                onReasoning={setReasoning}
              />
              <p className="mt-3 flex items-center justify-center gap-1.5 text-center text-xs text-muted">
                <ShieldCheck className="h-3.5 w-3.5" />
                Free preview · no account needed
              </p>
            </div>

            {/* The locked pair, with the unlock CTA sitting between them. */}
            <div className="flex flex-col gap-4">
              {Array.from({ length: Math.max(locked, 1) }).map((_, i) => (
                <LockedPredictionCard key={i} seed={i} />
              ))}

              <div className="rounded-[1.75rem] border border-accent-edge bg-accent-wash p-6 text-center">
                <span className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-surface">
                  <Lock className="h-4.5 w-4.5 text-accent" />
                </span>

                <h3 className="display mt-3.5 text-xl">
                  {data.lockedCount > 0
                    ? `${data.lockedCount} more ${data.lockedCount === 1 ? "prediction" : "predictions"} today`
                    : "Unlock the full board"}
                </h3>
                <p className="mx-auto mt-1.5 max-w-xs text-sm leading-relaxed text-muted">
                  Create a free account to see the complete daily feed and the
                  AI analysis behind every call.
                </p>

                <div className="mt-5 flex flex-col gap-2">
                  <LinkButton href="/auth/sign-up" size="lg" variant="primary" fullWidth>
                    Sign up free
                  </LinkButton>
                  <LinkButton href="/auth/sign-in" size="md" variant="ghost" fullWidth>
                    Already have an account? Log in
                  </LinkButton>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* --------------------------- how it works --------------------------- */}
      <section className="border-t border-border bg-surface">
        <div className="mx-auto w-full max-w-5xl px-5 py-16">
          <h2 className="display text-center text-2xl sm:text-3xl">
            Not tips. Analysis.
          </h2>
          <p className="mx-auto mt-2.5 max-w-md text-center text-sm leading-relaxed text-muted">
            Every call comes with the reasoning attached, so you can disagree
            with it on the evidence rather than take it on faith.
          </p>

          <div className="stagger mt-10 grid gap-4 sm:grid-cols-3">
            {[
              {
                n: "01",
                t: "Reads the fixture",
                d: "Form, expected goals, head-to-head, rest days, travel distance and lineup availability.",
              },
              {
                n: "02",
                t: "Scores its confidence",
                d: "A calibrated 0–100 score, with the filters that pulled it up or down shown openly.",
              },
              {
                n: "03",
                t: "Shows its working",
                d: "The factors behind every call, so you can judge the argument, not just the answer.",
              },
            ].map((s) => (
              <div
                key={s.n}
                className="rounded-2xl border border-border bg-background p-6"
              >
                <span className="numeral text-sm text-accent">{s.n}</span>
                <h3 className="mt-3 text-base font-semibold">{s.t}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto w-full max-w-5xl space-y-2 px-5 py-10">
          <p className="text-xs leading-relaxed text-muted">
            18+. MoonOdds provides analysis, not guarantees. Nothing here is a
            certainty — never stake more than you can afford to lose.
          </p>
          <p className="text-xs text-muted">© MoonOdds</p>
        </div>
      </footer>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-6 first:pl-0 last:pr-0">
      <dd className="numeral text-2xl">{value}</dd>
      <dt className="label mt-1">{label}</dt>
    </div>
  );
}
