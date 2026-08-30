"use client";

import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "./supabase/client";

/**
 * Office data access.
 *
 * Reads go straight through PostgREST, the admin-only RLS policies already
 * restrict every one of these tables to super-admins, so a non-admin session
 * gets empty results rather than a leak. Writes go through /api/office, which
 * re-checks the flag server-side against profiles.
 */

export const adminKeys = {
  config: ["office", "config"] as const,
  reports: ["office", "reports"] as const,
  users: ["office", "users"] as const,
  runs: ["office", "runs"] as const,
  jobs: ["office", "jobs"] as const,
  catalog: ["office", "catalog"] as const,
  // Not keyed on the page: one fetch backs every page. See useAdminPredictions.
  predictions: ["office", "predictions"] as const,
  ungraded: ["office", "ungraded"] as const,
  board: ["office", "board"] as const,
  fx: ["office", "fx"] as const,
};

export type FxFallback = {
  rate: number;
  source: "office" | "env" | "constant";
  officeValue: number | null;
};

/**
 * The FX fallback in force.
 *
 * Goes through the Office route rather than Supabase directly: the underlying
 * RPC is service-role only, because the write sets what customers are charged.
 */
export function useFxFallback() {
  return useQuery({
    queryKey: adminKeys.fx,
    queryFn: async (): Promise<FxFallback> => {
      const res = await fetch("/api/office");
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not read pricing settings.");
      return json.fx as FxFallback;
    },
  });
}

export function useEngineConfig() {
  return useQuery({
    queryKey: adminKeys.config,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("ai_engine_config")
        .select("*")
        .eq("status", "active")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useTuningReports() {
  return useQuery({
    queryKey: adminKeys.reports,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("tuning_reports")
        .select("*")
        .order("generated_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useAdminUsers() {
  return useQuery({
    queryKey: adminKeys.users,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("profiles")
        .select("*, daily_passes(date_key, status)")
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function usePredictionRuns() {
  return useQuery({
    queryKey: adminKeys.runs,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("prediction_runs")
        .select("*")
        .order("run_at", { ascending: false })
        .limit(15);
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useJobQueue() {
  return useQuery({
    queryKey: adminKeys.jobs,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("jobs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(25);
      if (error) throw error;
      return data ?? [];
    },
    refetchInterval: 15_000,
  });
}

export type PredictionReport = {
  wins: number;
  losses: number;
  pending: number;
  voided: number;
  graded: number;
  total: number;
  winRate: number | null;
  leagues: {
    leagueName: string;
    country: string;
    logo: string | null;
    wins: number;
    losses: number;
    pending: number;
    graded: number;
    winRate: number | null;
  }[];
};

export type UserPicksReport = {
  totalSlips: number;
  totalWins: number;
  totalLosses: number;
  avgWinRate: number | null;
  users: {
    id: string;
    email: string | null;
    displayName: string | null;
    totalSlips: number;
    wins: number;
    losses: number;
    winRate: number | null;
    lastSlipAt: string | null;
  }[];
};

export type DashboardMetrics = {
  /** Ignores the date range: catalogue sizes and all-time totals. */
  asOfToday: {
    users: number;
    suspended: number;
    activePassesToday: number;
    predictions: number;
    leagues: number;
    teams: number;
    fixtures: number;
  };
  /**
   * Answers the date range.
   *
   * Every rate is `number | null`, and the null is load-bearing: a hit rate
   * with nothing settled is unknown, not zero, and rendering it as 0% would
   * report a perfect miss record for a quiet week.
   */
  inRange: {
    newUsers: number;
    passesSold: number;
    payingUsers: number;
    passRevenue: number;
    extraOrders: number;
    extraGames: number;
    extraRevenue: number;
    revenue: number;
    arpu: number | null;
    settled: number;
    wins: number;
    losses: number;
    hitRate: number | null;
    slipsSettled: number;
    slipsTotal: number;
    slipWinRate: number | null;
    returnRate: number | null;
    returningBuyers: number;
    churnRate: number | null;
    lapsedBuyers: number;
    priorBuyers: number;
  };
};

/** Everything the dashboard shows, in one call. Null dates mean all time. */
export function useDashboardMetrics(range: { start?: string; end?: string }) {
  return useQuery({
    queryKey: ["office", "dashboard", range],
    queryFn: async (): Promise<DashboardMetrics> => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("get_dashboard_metrics", {
        p_start: range.start ?? null,
        p_end: range.end ?? null,
      });
      if (error) throw error;
      return data as DashboardMetrics;
    },
  });
}

/** Engine performance for a window. Null dates mean all time. */
export function usePredictionReport(range: { start?: string; end?: string; leagueId?: string }) {
  return useQuery({
    queryKey: ["office", "report", "predictions", range],
    queryFn: async (): Promise<PredictionReport> => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("get_prediction_report", {
        p_league_id: range.leagueId ?? null,
        p_start: range.start ?? null,
        p_end: range.end ?? null,
      });
      if (error) throw error;
      return data as PredictionReport;
    },
  });
}

export function useUserPicksReport() {
  return useQuery({
    queryKey: ["office", "report", "users"],
    queryFn: async (): Promise<UserPicksReport> => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("get_user_picks_report");
      if (error) throw error;
      return data as UserPicksReport;
    },
  });
}

/** Every config, not just the live one, the lifecycle needs the whole set. */
export function useAllConfigs() {
  return useQuery({
    queryKey: ["office", "configs"],
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("ai_engine_config")
        .select("id, name, version, status, notes, approved_by, last_updated_at, ranking_weights")
        // By recency, not by version: version is a semver-shaped text column,
        // so ordering on it puts 1.4.10 below 1.4.9.
        .order("last_updated_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export type CatalogLeague = {
  id: string;
  name: string;
  country: string;
  season: number | null;
  external_id: number | null;
  is_active: boolean;
  logo: string | null;
};

export type CatalogTeam = {
  id: string;
  name: string;
  short_name: string;
  league_id: string;
  external_id: number | null;
  is_active: boolean;
  logo: string | null;
};

export function useCatalog() {
  return useQuery({
    queryKey: adminKeys.catalog,
    queryFn: async () => {
      const supabase = createClient();
      const [leagues, teams] = await Promise.all([
        supabase
          .from("leagues")
          .select("id, name, country, season, external_id, is_active, logo")
          .order("name"),
        supabase
          .from("teams")
          .select("id, name, short_name, league_id, external_id, is_active, logo")
          .order("name"),
      ]);
      if (leagues.error) throw leagues.error;
      if (teams.error) throw teams.error;
      return {
        leagues: (leagues.data ?? []) as CatalogLeague[],
        teams: (teams.data ?? []) as CatalogTeam[],
      };
    },
  });
}

export type BoardFixture = {
  id: string;
  fixture_date: string;
  venue: string | null;
  leagues: { name: string; country: string; logo: string | null } | null;
  home: { name: string; short_name: string | null; logo: string | null } | null;
  away: { name: string; short_name: string | null; logo: string | null } | null;
};

/**
 * The board the engine is about to read.
 *
 * Scheduled fixtures from now forward, in kickoff order, which is the same
 * ordering `runDailyPicks` uses to decide what fits inside a session. So the
 * top of this list IS what gets analysed, and an operator pruning it is
 * pruning the real input rather than a view of it.
 *
 * Straight through PostgREST: leagues, teams and fixtures are granted to
 * every role, the catalogue is public knowledge.
 */
export function useUpcomingFixtures() {
  return useQuery({
    queryKey: adminKeys.board,
    queryFn: async (): Promise<BoardFixture[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("fixtures")
        .select(
          "id, fixture_date, venue, leagues(name, country, logo), home:teams!fixtures_home_team_id_fkey(name, short_name, logo), away:teams!fixtures_away_team_id_fkey(name, short_name, logo)",
        )
        .eq("status", "scheduled")
        .gte("fixture_date", new Date().toISOString())
        .order("fixture_date")
        .limit(100);
      if (error) throw error;
      // PostgREST types embedded rows as arrays; each of these is to-one.
      return (data ?? []).map((r) => ({
        ...r,
        leagues: asOne(r.leagues),
        home: asOne(r.home),
        away: asOne(r.away),
      })) as BoardFixture[];
    },
  });
}

function asOne<T>(v: T | T[] | null | undefined): T | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

const PAGE_SIZE = 25;

/**
 * Every prediction, fetched once.
 *
 * `get_picks_by_status` has no limit or offset — it serialises the whole table
 * into one JSON document — and this hook used to key its cache on the page
 * number while ignoring the page in the query. So turning to page 2 was not
 * paging through a cached result; it was fetching every prediction ever made,
 * again, to display twenty-five of them. Ten pages, ten full fetches.
 *
 * Keyed without the page now, so the fetch happens once and paging is free.
 * That is a mitigation and not the cure: the payload still grows with the
 * table, and the real fix is limit/offset on the RPC itself. Worth doing when
 * the row count makes it worth a migration — this stops the cost multiplying by
 * however many pages someone clicks through in the meantime.
 */
function useAllAdminPredictions() {
  return useQuery({
    queryKey: adminKeys.predictions,
    queryFn: async () => {
      const supabase = createClient();
      /*
       * The Office has its own read, and it has to.
       *
       * It used to share get_picks_by_status with everyone else. That RPC now
       * returns the free board only — it must, or a day-pass holder would be
       * handed the paid basket for nothing — which leaves the operator unable
       * to see the picks that landed behind the paywall, let alone move one.
       *
       * get_admin_predictions is super-admin gated in SQL, not by the fact
       * that this page is only linked from /office.
       */
      const { data, error } = await supabase.rpc("get_admin_predictions");
      if (error) throw error;
      return (data as unknown[]) ?? [];
    },
  });
}

/**
 * Which fixtures already carry a prediction.
 *
 * The board cannot ask this directly: `predictions` is granted to nobody and
 * every read goes through a SECURITY DEFINER RPC, so a PostgREST embed returns
 * nothing however senior the caller. But the Office already holds every pick
 * for its Predictions tab, and pick_json carries fixture.id — so the answer is
 * a derivation of data that is fetched anyway, under the same query key, rather
 * than a second trip.
 *
 * It matters for deletion. Removing a fixture cascades to its predictions, so
 * the route refuses any fixture that has one; without this the operator picks a
 * dozen rows, gets four refusals back and has no way to tell which four until
 * they try.
 */
export function usePredictedFixtureIds() {
  const query = useAllAdminPredictions();
  const { ids, byFixture } = useMemo(() => {
    const set = new Set<string>();
    const map = new Map<string, { id: string; tier: string; status: string }>();
    for (const p of (query.data ?? []) as {
      id?: string;
      tier?: string;
      status?: string;
      fixture?: { id?: string };
    }[]) {
      if (!p?.fixture?.id) continue;
      set.add(p.fixture.id);
      if (p.id) {
        map.set(p.fixture.id, {
          id: p.id,
          tier: p.tier ?? "primary",
          status: p.status ?? "pending",
        });
      }
    }
    return { ids: set, byFixture: map };
  }, [query.data]);

  return { ids, byFixture, isPending: query.isPending };
}

export function useAdminPredictions(page: number) {
  const query = useAllAdminPredictions();
  const picks = query.data ?? [];

  return {
    ...query,
    data: query.data
      ? {
          rows: picks.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
          total: picks.length,
          pageSize: PAGE_SIZE,
        }
      : undefined,
  };
}

/** Every Office write funnels through here so errors surface consistently. */
export function useOfficeAction() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (body: Record<string, unknown>) => {
      const res = await fetch("/api/office", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Action failed.");
      return json;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["office"] });
      qc.invalidateQueries({ queryKey: ["picks"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}
