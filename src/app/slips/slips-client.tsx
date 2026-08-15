"use client";

import { Card } from "@heroui/react/card";
import { Chip } from "@heroui/react/chip";
import { Skeleton } from "@heroui/react/skeleton";
import { Separator } from "@heroui/react/separator";
import { Receipt } from "lucide-react";
import { useSlips } from "@/lib/queries";
import { LinkButton } from "@/components/ui/link-button";
import { formatDateShort } from "@/lib/format";

type Leg = {
  id: string;
  prediction_id: string;
  odds: number;
  status: "pending" | "won" | "lost" | "void";
};

type Slip = {
  id: string;
  slip_type: "single" | "accumulator";
  status: "open" | "confirmed" | "won" | "lost" | "partial" | "void";
  combined_odds: number;
  leg_count: number;
  confirmed_at: string;
  slip_legs: Leg[];
};

const SLIP_COLOR = {
  won: "success",
  lost: "danger",
  partial: "warning",
  void: "default",
  confirmed: "accent",
  open: "default",
} as const;

export function SlipsClient() {
  const { data, isPending } = useSlips();
  const slips = (data ?? []) as unknown as Slip[];

  const settled = slips.filter((s) => s.status === "won" || s.status === "lost");
  const won = settled.filter((s) => s.status === "won").length;

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-5 py-8">
      <header className="flex items-end justify-between gap-4">
        <div>
          <p className="label">Your record</p>
          <h1 className="display text-2xl">My slips</h1>
        </div>
        {settled.length > 0 && (
          <Chip size="sm" color="success" variant="soft" className="numeral">
            {won}/{settled.length} won
          </Chip>
        )}
      </header>

      {isPending ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-xl" />
          ))}
        </div>
      ) : !slips.length ? (
        <Card>
          <Card.Content className="flex flex-col items-center gap-3 p-12 text-center">
            <Receipt className="h-8 w-8 text-muted" strokeWidth={1.5} />
            <p className="font-medium">No slips yet</p>
            <p className="max-w-sm text-sm text-muted">
              Add picks to a slip from today&rsquo;s board and they&rsquo;ll
              show up here with their outcomes.
            </p>
            <LinkButton href="/" variant="secondary" size="sm">
              Browse today&rsquo;s picks
            </LinkButton>
          </Card.Content>
        </Card>
      ) : (
        <div className="space-y-3">
          {slips.map((slip) => {
            const legs = slip.slip_legs ?? [];
            const wonLegs = legs.filter((l) => l.status === "won").length;

            return (
              <Card key={slip.id}>
                <Card.Content className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold capitalize">
                          {slip.slip_type}
                        </span>
                        <Chip
                          size="sm"
                          variant="soft"
                          color={SLIP_COLOR[slip.status]}
                        >
                          {slip.status}
                        </Chip>
                      </div>
                      <p className="mt-0.5 text-[11px] text-muted">
                        {slip.leg_count} legs · {formatDateShort(slip.confirmed_at)}
                      </p>
                    </div>

                    <div className="text-right">
                      <p className="numeral text-xl font-semibold leading-none">
                        {Number(slip.combined_odds).toFixed(2)}
                      </p>
                      <p className="mt-1 text-[10px] uppercase tracking-widest text-muted">
                        Combined
                      </p>
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-1.5">
                    {legs.map((leg) => (
                      <div
                        key={leg.id}
                        className="flex items-center justify-between text-xs"
                      >
                        <span className="truncate numeral text-muted">
                          {leg.prediction_id.slice(0, 8)}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="numeral">
                            {Number(leg.odds).toFixed(2)}
                          </span>
                          <Chip
                            size="sm"
                            variant="soft"
                            color={
                              leg.status === "won"
                                ? "success"
                                : leg.status === "lost"
                                  ? "danger"
                                  : leg.status === "void"
                                    ? "default"
                                    : "warning"
                            }
                          >
                            {leg.status}
                          </Chip>
                        </div>
                      </div>
                    ))}
                  </div>

                  {legs.length > 0 && (
                    <p className="text-[11px] text-muted">
                      {wonLegs} of {legs.length} legs landed
                    </p>
                  )}
                </Card.Content>
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}
