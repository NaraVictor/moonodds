"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, X, Lock } from "@/components/ui/icons";
import { TeamCrest } from "@/components/predictions/team-crest";
import { usePicksByStatus } from "@/lib/queries";
import { formatDateShort, formatMarket, teamName } from "@/lib/format";
import type { Pick } from "@/lib/types";

/**
 * Global search.
 *
 * Searches the board rather than a separate index: everything a visitor could
 * want to find, a club, a competition, a market, is already a field on a pick
 * we've loaded, and standing up a search service for a few hundred rows a day
 * would be machinery without a purpose.
 *
 * Matching is deliberately forgiving on the way in (any word, any position,
 * case-insensitive) and strict on the way out (ranked, capped at eight). A
 * search box that returns forty rows has just made you scroll a second list.
 *
 * Cmd/Ctrl-K to open, arrows to move, Enter to go, Escape to leave, the
 * shortcut set people already have in their fingers from every other tool.
 */

type Hit = { pick: Pick; score: number };

function scoreOf(pick: Pick, q: string): number {
  const home = teamName(pick.homeTeam).toLowerCase();
  const away = teamName(pick.awayTeam).toLowerCase();
  const league = (pick.league.name ?? "").toLowerCase();
  const market = pick.predictionType
    ? formatMarket(pick.predictionType, pick.predictedValue).toLowerCase()
    : "";

  // A club starting with what you typed beats one merely containing it, and a
  // team beats a league, you're far likelier to be hunting a fixture.
  if (home.startsWith(q) || away.startsWith(q)) return 100;
  if (home.includes(q) || away.includes(q)) return 70;
  if (league.startsWith(q)) return 50;
  if (league.includes(q)) return 35;
  if (market.includes(q)) return 20;
  return 0;
}

export function SiteSearch() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  /**
   * The header mounts this twice, once inline for desktop, once as its own row
   * for mobile, with CSS deciding which is shown. A hard-coded element id would
   * therefore appear twice in the document, which is invalid and leaves
   * aria-controls pointing at whichever the browser found first.
   */
  const listId = useId();

  // Only fetched once something is typed, the header shouldn't pull the whole
  // board on every page just in case.
  const { data } = usePicksByStatus("all");

  const hits = useMemo<Hit[]>(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return (data?.picks ?? [])
      .map((pick) => ({ pick, score: scoreOf(pick, q) }))
      .filter((h) => h.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);
  }, [data, query]);

  // Cmd/Ctrl-K from anywhere. Both instances hear it, so each checks whether
  // it's the one currently on screen before grabbing focus, otherwise the
  // shortcut would focus a display:none input and appear to do nothing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        if (!inputRef.current?.offsetParent) return;
        e.preventDefault();
        setOpen(true);
        inputRef.current.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Dismiss on an outside click.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function go(pick: Pick) {
    setOpen(false);
    setQuery("");
    router.push(`/predictions/${pick.id}`);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
      inputRef.current?.blur();
    }
    if (!hits.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setCursor((c) => (c + 1) % hits.length);
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      setCursor((c) => (c - 1 + hits.length) % hits.length);
    }
    if (e.key === "Enter") {
      e.preventDefault();
      go(hits[cursor].pick);
    }
  }

  const showList = open && query.trim().length >= 2;

  return (
    <div ref={boxRef} className="relative w-full md:max-w-md">
      <div className="relative">
        <Search
          className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2"
          style={{ color: "var(--muted)" }}
        />
        <input
          ref={inputRef}
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-label="Search teams, leagues and markets"
          placeholder="Search teams, leagues…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            // Reset the highlight here rather than in an effect keyed on the
            // query: this is the event that invalidates it, and doing it in an
            // effect costs a second render pass to correct the first.
            setCursor(0);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          className="h-10 w-full rounded-full border border-field-border bg-field pl-10 pr-14 text-sm placeholder:text-field-placeholder focus-visible:border-accent focus-visible:outline-none"
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            aria-label="Clear search"
            className="press absolute right-3 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        ) : (
          <kbd
            aria-hidden
            className="numeral pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-border px-1.5 py-0.5 text-[10px] text-muted sm:block"
          >
            ⌘K
          </kbd>
        )}
      </div>

      {showList && (
        <div
          id={listId}
          role="listbox"
          className="rise absolute left-0 right-0 top-12 z-50 overflow-hidden rounded-[1rem] border border-border bg-surface py-1.5"
          style={{ boxShadow: "var(--shadow-lift)" }}
        >
          {hits.length === 0 ? (
            <p className="px-4 py-6 text-center text-[13px] text-muted">
              Nothing matches &ldquo;{query.trim()}&rdquo;.
            </p>
          ) : (
            <ul>
              {hits.map((h, i) => {
                const p = h.pick;
                const active = i === cursor;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      onMouseEnter={() => setCursor(i)}
                      onClick={() => go(p)}
                      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors"
                      style={{ background: active ? "var(--surface-secondary)" : "transparent" }}
                    >
                      <span className="flex flex-none items-center -space-x-1.5">
                        <TeamCrest name={teamName(p.homeTeam)} logo={p.homeTeam?.logo} size={22} />
                        <TeamCrest name={teamName(p.awayTeam)} logo={p.awayTeam?.logo} size={22} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold">
                          {teamName(p.homeTeam)} v {teamName(p.awayTeam)}
                        </span>
                        {/*
                          The date leads the line, and it leads because the
                          board is not one day deep. A search for "Chelsea"
                          returns every Chelsea call we hold, and without a
                          date two rows for the same fixture — last week's
                          settled one and today's — are the same sentence
                          twice. It goes first rather than last because this
                          line truncates, and the part that tells two
                          identical rows apart is the part that must survive
                          a narrow screen.
                        */}
                        <span className="block truncate text-[11px] text-muted">
                          <span className="numeral">
                            {formatDateShort(p.fixture.date)}
                          </span>
                          {" · "}
                          {p.league.name}
                          {p.predictionType && (
                            <> · {formatMarket(p.predictionType, p.predictedValue)}</>
                          )}
                        </span>
                      </span>
                      {p.locked && (
                        <Lock className="h-3 w-3 flex-none" style={{ color: "var(--muted)" }} />
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
