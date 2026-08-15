"use client";

import { Check, X } from "lucide-react";
import { MARKET_LABELS } from "@/lib/format";
import type { Market, StatusFilter } from "@/lib/types";

/**
 * The left filter rail.
 *
 * A marketplace is browsed by narrowing, so the controls stay on screen rather
 * than hiding behind a "Filter" button that has to be reopened for every
 * adjustment. Everything is a checkbox or a radio — no dropdowns — because the
 * point of a rail is seeing what's available and what's currently on without
 * clicking anything.
 *
 * Counts sit beside each option. A filter that leads to an empty list is a dead
 * end, and showing the count in advance is the cheapest way to avoid one.
 */

export type Filters = {
  status: StatusFilter;
  leagues: string[];
  markets: Market[];
  minConfidence: number;
  kickoff: "any" | "next3h" | "today";
};

export const EMPTY_FILTERS: Filters = {
  status: "all",
  leagues: [],
  markets: [],
  minConfidence: 0,
  kickoff: "any",
};

const STATUSES: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "upcoming", label: "Upcoming" },
  { key: "live", label: "Live" },
  { key: "settled", label: "Settled" },
];

const CONFIDENCE_BANDS = [
  { v: 0, label: "Any" },
  { v: 7, label: "70%+" },
  { v: 8, label: "80%+" },
  { v: 9, label: "90%+" },
];

const KICKOFFS: { v: Filters["kickoff"]; label: string }[] = [
  { v: "any", label: "Any time" },
  { v: "next3h", label: "Next 3 hours" },
  { v: "today", label: "Rest of today" },
];

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-separator py-4 first:border-t-0 first:pt-0">
      <p className="label mb-2.5">{title}</p>
      {children}
    </div>
  );
}

function CheckRow({
  label,
  count,
  checked,
  onChange,
}: {
  label: string;
  count?: number;
  checked: boolean;
  onChange: () => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 py-1.5">
      <input type="checkbox" checked={checked} onChange={onChange} className="sr-only" />
      <span
        className="flex h-4 w-4 flex-none items-center justify-center rounded-[5px] border transition-colors"
        style={{
          borderColor: checked ? "var(--accent)" : "var(--field-border)",
          background: checked ? "var(--accent)" : "transparent",
          color: "var(--accent-foreground)",
        }}
      >
        {checked && <Check className="h-3 w-3" strokeWidth={3.5} />}
      </span>
      <span className="min-w-0 flex-1 truncate text-[13px]">{label}</span>
      {count !== undefined && (
        <span className="numeral flex-none text-[11px] text-muted">{count}</span>
      )}
    </label>
  );
}

function Segmented<T extends string | number>({
  options,
  value,
  onChange,
}: {
  options: { v: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = o.v === value;
        return (
          <button
            key={String(o.v)}
            type="button"
            onClick={() => onChange(o.v)}
            aria-pressed={on}
            className="press rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors"
            style={
              on
                ? {
                    borderColor: "transparent",
                    background: "var(--accent-wash)",
                    color: "var(--accent)",
                  }
                : { borderColor: "var(--border)", color: "var(--muted)" }
            }
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function FilterRail({
  filters,
  onChange,
  leagues,
  markets,
  statusCounts,
}: {
  filters: Filters;
  onChange: (f: Filters) => void;
  leagues: { name: string; count: number }[];
  markets: { key: Market; count: number }[];
  statusCounts?: Record<StatusFilter, number>;
}) {
  const active =
    filters.leagues.length +
    filters.markets.length +
    (filters.minConfidence > 0 ? 1 : 0) +
    (filters.kickoff !== "any" ? 1 : 0) +
    (filters.status !== "all" ? 1 : 0);

  const set = (patch: Partial<Filters>) => onChange({ ...filters, ...patch });
  const toggleIn = <T,>(list: T[], v: T) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  // No container: the rail is a column of controls sitting directly on the page
  // ground, the way a marketplace sidebar reads. Boxing it would give navigation
  // the same visual weight as the inventory it filters.
  return (
    <div className="pr-2">
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-[15px] font-semibold">Filters</p>
        {active > 0 && (
          <button
            type="button"
            onClick={() => onChange(EMPTY_FILTERS)}
            className="press inline-flex items-center gap-1 text-[12px] font-semibold"
            style={{ color: "var(--accent)" }}
          >
            <X className="h-3 w-3" />
            Clear {active}
          </button>
        )}
      </div>

      <Group title="Status">
        <Segmented
          options={STATUSES.map((s) => ({
            v: s.key,
            label: statusCounts ? `${s.label} ${statusCounts[s.key] ?? 0}` : s.label,
          }))}
          value={filters.status}
          onChange={(v) => set({ status: v })}
        />
      </Group>

      <Group title="Confidence">
        <Segmented
          options={CONFIDENCE_BANDS}
          value={filters.minConfidence}
          onChange={(v) => set({ minConfidence: v })}
        />
      </Group>

      <Group title="Kickoff">
        <Segmented
          options={KICKOFFS}
          value={filters.kickoff}
          onChange={(v) => set({ kickoff: v })}
        />
      </Group>

      {leagues.length > 0 && (
        <Group title="League">
          <div className="max-h-56 overflow-y-auto pr-1">
            {leagues.map((l) => (
              <CheckRow
                key={l.name}
                label={l.name}
                count={l.count}
                checked={filters.leagues.includes(l.name)}
                onChange={() => set({ leagues: toggleIn(filters.leagues, l.name) })}
              />
            ))}
          </div>
        </Group>
      )}

      {markets.length > 0 && (
        <Group title="Market">
          <div className="max-h-56 overflow-y-auto pr-1">
            {markets.map((m) => (
              <CheckRow
                key={m.key}
                label={MARKET_LABELS[m.key] ?? m.key}
                count={m.count}
                checked={filters.markets.includes(m.key)}
                onChange={() => set({ markets: toggleIn(filters.markets, m.key) })}
              />
            ))}
          </div>
        </Group>
      )}
    </div>
  );
}
