"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "./supabase/client";

/**
 * Office data access.
 *
 * Reads go straight through PostgREST — the admin-only RLS policies already
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
  predictions: (page: number) => ["office", "predictions", page] as const,
  ungraded: ["office", "ungraded"] as const,
};

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

/** Every config, not just the live one — the lifecycle needs the whole set. */
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
};

export type CatalogTeam = {
  id: string;
  name: string;
  short_name: string;
  league_id: string;
  external_id: number | null;
  is_active: boolean;
};

export function useCatalog() {
  return useQuery({
    queryKey: adminKeys.catalog,
    queryFn: async () => {
      const supabase = createClient();
      const [leagues, teams] = await Promise.all([
        supabase
          .from("leagues")
          .select("id, name, country, season, external_id, is_active")
          .order("name"),
        supabase
          .from("teams")
          .select("id, name, short_name, league_id, external_id, is_active")
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

const PAGE_SIZE = 25;

export function useAdminPredictions(page: number) {
  return useQuery({
    queryKey: adminKeys.predictions(page),
    queryFn: async () => {
      const supabase = createClient();
      // Admins read predictions through the same gated RPC everyone uses —
      // their access is full because access_state() says so, not because the
      // table is open to them.
      const { data, error } = await supabase.rpc("get_picks_by_status", {
        filter: "all",
      });
      if (error) throw error;
      const picks = (data as { picks: unknown[] })?.picks ?? [];
      return {
        rows: picks.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
        total: picks.length,
        pageSize: PAGE_SIZE,
      };
    },
  });
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
