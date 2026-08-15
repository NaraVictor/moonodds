"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createClient } from "./supabase/client";
import { utcDayWindow } from "./format";
import type {
  AccessState,
  EngineStats,
  GatedPicks,
  LeagueOption,
  Pick,
  SlipLeg,
  StatusCounts,
  StatusFilter,
} from "./types";

/**
 * The data layer that replaces Convex's reactive useQuery.
 *
 * Convex subscribed every read by default. This app is a daily-batch product —
 * picks are generated once at 06:00 UTC and graded every two hours — so
 * polling-free TanStack Query with sensible staleness is the right default.
 * Liveness is added deliberately where it earns its keep (live fixtures), not
 * everywhere by reflex.
 */

const EMPTY_GATED: GatedPicks = {
  picks: [],
  totalCount: 0,
  hasFullAccess: false,
  isFirstDay: false,
  freePickLimit: 0,
};

export const keys = {
  access: ["access"] as const,
  todaysPicks: (start: string) => ["picks", "today", start] as const,
  picksByStatus: (s: StatusFilter) => ["picks", "status", s] as const,
  recentResults: ["picks", "recent"] as const,
  engineStats: ["stats", "engine"] as const,
  statusCounts: ["stats", "status"] as const,
  extraPicks: ["extra-picks"] as const,
  leagueOptions: ["extra-picks", "leagues"] as const,
  slips: ["slips"] as const,
  profile: ["profile"] as const,
  notifications: ["notifications"] as const,
  predictionDetail: (id: string) => ["picks", "detail", id] as const,
};

/** Match statistics behind the detail page. Public — these aren't ours. */
export type FixtureStats = {
  homeForm: string | null;
  awayForm: string | null;
  h2hHomeWins: number | null;
  h2hAwayWins: number | null;
  h2hDraws: number | null;
  h2hAvgGoals: number | null;
  h2hBttsRate: number | null;
  homeSeason: Record<string, number>;
  awaySeason: Record<string, number>;
  h2hMatches: unknown[];
  homeRecentMatches: unknown[];
  awayRecentMatches: unknown[];
};

export type PredictionDetail = {
  pick: Pick;
  stats: FixtureStats | null;
  hasFullAccess: boolean;
  isFirstDay: boolean;
};

export function usePredictionDetail(id: string) {
  return useQuery({
    queryKey: keys.predictionDetail(id),
    // The summary modal mounts before a pick is chosen and passes "".
    enabled: id.length > 0,
    queryFn: async (): Promise<PredictionDetail | null> => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("get_prediction_detail", {
        p_id: id,
      });
      if (error) throw error;
      return (data as PredictionDetail | null) ?? null;
    },
  });
}

/** Access state drives paywall copy and admin nav. Never a gate by itself. */
export function useAccessState() {
  return useQuery({
    queryKey: keys.access,
    queryFn: async (): Promise<AccessState> => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("get_access_state");
      if (error) throw error;
      return data as AccessState;
    },
  });
}

/**
 * Today's picks. The server decides how many come back — the client never
 * receives a pick it may not display, so there is nothing to slice here.
 */
export function useTodaysPicks() {
  const { startISO, endISO } = utcDayWindow();

  return useQuery({
    queryKey: keys.todaysPicks(startISO),
    queryFn: async (): Promise<GatedPicks> => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("get_todays_picks", {
        start_ts: startISO,
        end_ts: endISO,
      });
      if (error) throw error;
      return (data as GatedPicks) ?? EMPTY_GATED;
    },
  });
}

export function usePicksByStatus(filter: StatusFilter) {
  return useQuery({
    queryKey: keys.picksByStatus(filter),
    queryFn: async (): Promise<GatedPicks> => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("get_picks_by_status", {
        filter,
      });
      if (error) throw error;
      return (data as GatedPicks) ?? EMPTY_GATED;
    },
    // Live fixtures move; keep this one fresher than the rest.
    staleTime: filter === "live" ? 20_000 : 60_000,
    refetchInterval: filter === "live" ? 30_000 : false,
  });
}

/** Settled results — public, so this powers the guest landing page too. */
export function useRecentResults(limit = 50) {
  return useQuery({
    queryKey: [...keys.recentResults, limit],
    queryFn: async (): Promise<Pick[]> => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("get_recent_results", {
        max_rows: limit,
      });
      if (error) throw error;
      return (data as Pick[]) ?? [];
    },
    staleTime: 5 * 60_000,
  });
}

export function useEngineStats() {
  return useQuery({
    queryKey: keys.engineStats,
    queryFn: async (): Promise<EngineStats> => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("get_engine_stats");
      if (error) throw error;
      return data as EngineStats;
    },
    staleTime: 5 * 60_000,
  });
}

export function useStatusCounts() {
  return useQuery({
    queryKey: keys.statusCounts,
    queryFn: async (): Promise<StatusCounts> => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("get_status_counts");
      if (error) throw error;
      return data as StatusCounts;
    },
  });
}

/** Extra picks the user has paid for today. */
export function useExtraPicks(enabled: boolean) {
  return useQuery({
    queryKey: keys.extraPicks,
    enabled,
    queryFn: async (): Promise<Pick[]> => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("get_my_extra_picks");
      if (error) throw error;
      return (data as Pick[]) ?? [];
    },
  });
}

/** Leagues with upcoming games today, for the extra-picks league picker. */
export function useLeagueOptions(enabled: boolean) {
  const { startISO, endISO } = utcDayWindow();

  return useQuery({
    queryKey: keys.leagueOptions,
    enabled,
    queryFn: async (): Promise<LeagueOption[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("fixtures")
        .select("league_id, leagues(id, name, country, logo)")
        .gte("fixture_date", startISO)
        .lt("fixture_date", endISO)
        .eq("status", "scheduled");

      if (error) throw error;

      const byLeague = new Map<string, LeagueOption>();
      for (const row of (data ?? []) as unknown as Array<{
        league_id: string;
        leagues: { name: string; country: string; logo: string | null } | null;
      }>) {
        const existing = byLeague.get(row.league_id);
        if (existing) {
          existing.availableGames = Math.min(existing.availableGames + 1, 3);
          continue;
        }
        byLeague.set(row.league_id, {
          leagueId: row.league_id,
          name: row.leagues?.name ?? "Unknown league",
          country: row.leagues?.country ?? "",
          logo: row.leagues?.logo ?? null,
          availableGames: 1,
        });
      }

      return [...byLeague.values()].sort((a, b) => a.name.localeCompare(b.name));
    },
  });
}

/** The user's saved slips, with legs. */
/**
 * Which of the slip's picks still exist server-side.
 *
 * The slip is held in the browser, so it can outlive the predictions it points
 * at — regenerate the board and the ids stop resolving. Checking on open lets
 * the sheet mark the dead legs individually instead of failing the whole save
 * with a message that names none of them.
 */
export function useLivePredictionIds(ids: string[]) {
  const key = [...ids].sort().join(",");
  return useQuery({
    queryKey: ["picks", "live-check", key],
    enabled: ids.length > 0,
    staleTime: 30_000,
    queryFn: async (): Promise<Set<string>> => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("filter_live_predictions", {
        p_ids: ids,
      });
      if (error) throw error;
      return new Set((data as string[]) ?? []);
    },
  });
}

/**
 * Discard a whole slip.
 *
 * Goes through an RPC rather than a PostgREST delete so ownership is checked in
 * one place and the legs cascade predictably.
 */
export function useDeleteSlip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (slipId: string) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("delete_slip", { p_slip_id: slipId });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.slips }),
  });
}

/**
 * Drop one leg. The RPC re-derives the parent's leg count, combined odds and
 * type, and removes the slip entirely if that was the last leg.
 */
export function useRemoveSlipLeg() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (legId: string) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("remove_slip_leg", { p_leg_id: legId });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.slips }),
  });
}

export function useSlips() {
  return useQuery({
    queryKey: keys.slips,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("slips")
        .select("*, slip_legs(*)")
        .order("confirmed_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useProfile() {
  return useQuery({
    queryKey: keys.profile,
    queryFn: async () => {
      const supabase = createClient();
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", auth.user.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useNotificationPreferences() {
  return useQuery({
    queryKey: keys.notifications,
    queryFn: async () => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("notification_preferences")
        .select("*")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });
}

export function useUpdateNotificationPreferences() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (patch: Record<string, boolean>) => {
      const supabase = createClient();
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Sign in to change your alerts.");

      const { error } = await supabase
        .from("notification_preferences")
        .update(patch)
        .eq("user_id", auth.user.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.notifications }),
  });
}

export function useUpdatePhone() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (phone: string) => {
      const supabase = createClient();
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Sign in to save a number.");

      const { error } = await supabase
        .from("profiles")
        .update({ phone })
        .eq("id", auth.user.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.profile }),
  });
}

/**
 * Persist a bet slip.
 *
 * Convex ran this as one ACID mutation. Here the slip and its legs are two
 * writes, so it goes through an RPC-shaped route handler that wraps both in a
 * single transaction — otherwise a failure between them leaves a slip with no
 * legs.
 */
export function useConfirmSlip() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (input: { slipType: "single" | "accumulator"; legs: SlipLeg[] }) => {
      const res = await fetch("/api/slips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Could not save your slip.");
      return json;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.slips }),
  });
}
