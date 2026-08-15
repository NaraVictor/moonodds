"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Flame } from "lucide-react";
import { PredictionCard } from "@/components/predictions/prediction-card";
import type { Pick, UnlockedPick } from "@/lib/types";

/**
 * The day's strongest calls, in a slider.
 *
 * Kalshi front the same way — a small carousel of the markets worth your
 * attention, with an explicit "3 of 7" pager so you know how much you haven't
 * seen. That counter matters more than the arrows: without it a carousel hides
 * its own extent and people assume they've reached the end.
 *
 * Three, not more. This is a shortlist, and a shortlist that keeps going stops
 * being one — the full board is directly underneath.
 */
export function HeroSlider({
  picks,
  onSummary,
}: {
  picks: Pick[];
  onSummary?: (p: UnlockedPick) => void;
}) {
  const [i, setI] = useState(0);
  if (!picks.length) return null;

  const count = picks.length;
  const go = (next: number) => setI(((next % count) + count) % count);

  return (
    <section className="mb-8" aria-roledescription="carousel" aria-label="Top predictions today">
      <div className="mb-3 flex items-end justify-between gap-4">
        <div>
          <span className="label flex items-center gap-1.5">
            <Flame className="h-3 w-3" />
            Strongest calls today
          </span>
          <h2 className="display mt-1 text-xl">Top {count}</h2>
        </div>

        <div className="flex flex-none items-center gap-2">
          <span className="numeral text-[13px] text-muted" aria-live="polite">
            {i + 1} of {count}
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => go(i - 1)}
              aria-label="Previous prediction"
              className="press flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface text-muted hover:text-foreground"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => go(i + 1)}
              aria-label="Next prediction"
              className="press flex h-9 w-9 items-center justify-center rounded-full border border-border bg-surface text-muted hover:text-foreground"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Track slides; overflow is clipped so only the active card is visible. */}
      <div className="overflow-hidden rounded-[1.5rem]">
        <div
          className="flex transition-transform duration-500"
          style={{
            transform: `translateX(-${i * 100}%)`,
            transitionTimingFunction: "var(--ease-out-soft)",
          }}
        >
          {picks.map((p, idx) => (
            <div
              key={p.id}
              className="w-full flex-none"
              aria-hidden={idx !== i}
              // Inactive slides must not be reachable by keyboard: they're
              // off-screen, and tabbing into one strands focus outside the view.
              // React 19 takes `inert` as a real boolean prop.
              inert={idx !== i}
            >
              <PredictionCard pick={p} feature onSummary={onSummary} />
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 flex justify-center gap-1.5">
        {picks.map((p, idx) => (
          <button
            key={p.id}
            type="button"
            onClick={() => go(idx)}
            aria-label={`Show prediction ${idx + 1}`}
            aria-current={idx === i}
            className="h-1.5 rounded-full transition-all duration-300"
            style={{
              width: idx === i ? 20 : 6,
              background: idx === i ? "var(--accent)" : "var(--surface-tertiary)",
            }}
          />
        ))}
      </div>
    </section>
  );
}
