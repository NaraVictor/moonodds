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
 * Convex subscribed every read by default. This app is a daily-batch product,
 * picks are generated once at 06:00 UTC and graded every two hours, so
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

/** Match statistics behind the detail page. Public, these aren't ours. */
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
 * Today's picks. The server decides how many come back, the client never
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

/** Settled results, public, so this powers the guest landing page too. */
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
export type ProfileStats = {
  totalSlips: number;
  won: number;
  lost: number;
  pending: number;
  settled: number;
  winRate: number | null;
  roi: number | null;
  avgConfidence: number | null;
};

export type LeagueRecord = {
  leagueName: string;
  country: string;
  logo: string | null;
  wins: number;
  losses: number;
  settled: number;
  accuracyRate: number;
  /** Only on the personal view: how many of your own legs sat in this league. */
  yourLegs?: number;
};

/** The signed-in user's own record. Null when signed out. */
export function useProfileStats() {
  return useQuery({
    queryKey: ["profile", "stats"],
    queryFn: async (): Promise<ProfileStats | null> => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("get_profile_stats");
      if (error) throw error;
      return (data as ProfileStats | null) ?? null;
    },
  });
}

/** Engine accuracy by league, public, and the same record as every settled pick. */
export function useLeaguePerformance() {
  return useQuery({
    queryKey: ["stats", "leagues"],
    queryFn: async (): Promise<LeagueRecord[]> => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("get_league_performance");
      if (error) throw error;
      return (data as LeagueRecord[]) ?? [];
    },
  });
}

/**
 * The same accuracy, narrowed to leagues the caller has actually backed.
 *
 * On a personal page the whole-product table answered a question nobody asked:
 * most of those leagues the reader has never touched. `yourLegs` says how many
 * of their own legs sat in each one, which is what makes the row theirs.
 */
export function useMyLeaguePerformance() {
  return useQuery({
    queryKey: ["stats", "leagues", "mine"],
    queryFn: async (): Promise<LeagueRecord[]> => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("get_my_league_performance");
      if (error) throw error;
      return (data as LeagueRecord[]) ?? [];
    },
  });
}

/* --------------------------- prediction history --------------------------- */

export type HistoryFilters = {
  league?: string | null;
  market?: string | null;
  outcome?: string | null;
};

export type HistoryPage = {
  rows: Pick[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
};

export type HistoryStats = {
  settled: number;
  won: number;
  lost: number;
  void: number;
  winRate: number | null;
  winRateInterval: { low: number | null; high: number | null };
  roi: number | null;
  avgOdds: number | null;
  avgConfidence: number | null;
  bestMarket: string | null;
  calibration: {
    band: string;
    settled: number;
    actualRate: number;
    impliedRate: number;
  }[];
  byMarket: {
    market: string;
    wins: number;
    losses: number;
    settled: number;
    winRate: number;
    roi: number;
  }[];
  byMonth: {
    month: string;
    wins: number;
    losses: number;
    settled: number;
    winRate: number;
  }[];
};

const HISTORY_PAGE_SIZE = 24;

/** One page of settled calls. Public, and the point of the history page. */
export function usePredictionHistory(page: number, filters: HistoryFilters) {
  return useQuery({
    queryKey: ["history", page, filters.league, filters.market, filters.outcome],
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<HistoryPage> => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("get_prediction_history", {
        p_limit: HISTORY_PAGE_SIZE,
        p_offset: page * HISTORY_PAGE_SIZE,
        p_league: filters.league ?? null,
        p_market: filters.market ?? null,
        p_outcome: filters.outcome ?? null,
      });
      if (error) throw error;
      return data as HistoryPage;
    },
  });
}

export function useHistoryStats() {
  return useQuery({
    queryKey: ["history", "stats"],
    queryFn: async (): Promise<HistoryStats> => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("get_history_stats");
      if (error) throw error;
      return data as HistoryStats;
    },
  });
}

export function useHistoryFacets() {
  return useQuery({
    queryKey: ["history", "facets"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<{ leagues: string[]; markets: string[] }> => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("get_history_facets");
      if (error) throw error;
      return data as { leagues: string[]; markets: string[] };
    },
  });
}

/* -------------------------------- slips ---------------------------------- */

export type SavedSlipLeg = {
  id: string;
  predictionId: string;
  odds: number;
  status: "pending" | "won" | "lost" | "void";
  market: string;
  predictedValue: string;
  confidenceScore: number;
  kickoff: string;
  fixtureStatus: "scheduled" | "live" | "finished";
  homeGoals: number | null;
  awayGoals: number | null;
  homeTeam: { name: string; shortName: string | null; logo: string | null };
  awayTeam: { name: string; shortName: string | null; logo: string | null };
  league: { name: string; country: string; logo: string | null };
};

export type SlipRecord = {
  id: string;
  slipType: "single" | "accumulator";
  status: "open" | "confirmed" | "won" | "lost" | "partial" | "void";
  combinedOdds: number;
  legCount: number;
  confirmedAt: string;
  settledAt: string | null;
  legs: SavedSlipLeg[];
};

export type SlipStats = {
  settled: number;
  won: number;
  lost: number;
  void: number;
  open: number;
  winRate: number | null;
  roi: number | null;
  bestWin: number | null;
  avgLegs: number | null;
};

/** Settled-slip performance. Open slips have no outcome and are excluded. */
export function useSlipStats() {
  return useQuery({
    queryKey: ["slips", "stats"],
    queryFn: async (): Promise<SlipStats> => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("get_my_slip_stats");
      if (error) throw error;
      return data as SlipStats;
    },
  });
}

/**
 * Which of the slip's picks still exist server-side.
 *
 * The slip is held in the browser, so it can outlive the predictions it points
 * at, regenerate the board and the ids stop resolving. Checking on open lets
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

/**
 * Slips, with each leg's fixture attached.
 *
 * Was a plain select of slips + slip_legs, which carry a prediction_id and
 * nothing else, so a leg could only ever render as the words "View prediction".
 * The RPC joins the fixture through so a leg reads as the match it is about.
 */
export function useSlips() {
  return useQuery({
    queryKey: keys.slips,
    queryFn: async (): Promise<SlipRecord[]> => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("get_my_slips");
      if (error) throw error;
      return (data as SlipRecord[]) ?? [];
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

/**
 * Change the name other people see.
 *
 * Worth being able to change, because nobody chose it: sign-up asks for an
 * address and nothing else, so everyone starts as a generated pairing like
 * "Brave Anchor 905". That is a good default and a poor identity.
 *
 * Trimmed and length-capped here as well as in the input, since the input is
 * only a suggestion to anyone using the API directly. An empty name is
 * refused rather than stored: a blank display name renders as a gap wherever
 * it appears, and the profile page falls back to "-" which reads like a bug.
 * RLS constrains the row to the caller and the privilege-freeze trigger keeps
 * is_super_admin and is_suspended out of reach, so this cannot become an
 * escalation even though the client writes it directly.
 */
export function useUpdateDisplayName() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (raw: string) => {
      const displayName = raw.trim().slice(0, 40);
      if (!displayName) throw new Error("Give yourself a name of some sort.");

      const supabase = createClient();
      const { data: auth } = await supabase.auth.getUser();
      if (!auth.user) throw new Error("Sign in to change your name.");

      const { error } = await supabase
        .from("profiles")
        .update({ display_name: displayName })
        .eq("id", auth.user.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.profile }),
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
 * single transaction, otherwise a failure between them leaves a slip with no
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

/* -------------------------- player protection --------------------------- */

export type PlayLimits = {
  excludedUntil: string | null;
  isExcluded: boolean;
  monthlyCapUsd: number | null;
  realityCheckMinutes: number | null;
  spentThisMonthUsd: number;
};

export function usePlayLimits() {
  return useQuery({
    queryKey: ["play-limits"],
    queryFn: async (): Promise<PlayLimits> => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("get_play_limits");
      if (error) throw error;
      return data as PlayLimits;
    },
  });
}

export function useSetPlayLimits() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: {
      monthlyCapUsd: number | null;
      realityCheckMinutes: number | null;
    }) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("set_play_limits", {
        p_monthly_cap_usd: v.monthlyCapUsd,
        p_reality_check_minutes: v.realityCheckMinutes,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["play-limits"] });
      qc.invalidateQueries({ queryKey: keys.access });
    },
  });
}

/**
 * Self-exclusion.
 *
 * Extending works; shortening is refused server-side. The whole point of the
 * control is that the person who set it cannot undo it in the moment they most
 * want to, so the error the server returns is the feature working.
 */
export function useSelfExclude() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (days: number) => {
      const supabase = createClient();
      const { error } = await supabase.rpc("set_self_exclusion", { p_days: days });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries();
    },
  });
}

/* ------------------------- closing line value ---------------------------- */

export type ClvSummary = {
  measured: number;
  beatCloseRate: number | null;
  avgClvPct: number | null;
  marketOpposed: number;
  winRateWhenBeatingClose: number | null;
  winRateWhenOpposed: number | null;
};

/**
 * Closing line value.
 *
 * Measured by the clv-check cron since the beginning and read by nothing until
 * now. Public, like the rest of the settled record: a CLV figure only means
 * something to the people deciding whether to trust the product.
 */
export function useClvSummary() {
  return useQuery({
    queryKey: ["stats", "clv"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<ClvSummary> => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("get_clv_summary");
      if (error) throw error;
      return data as ClvSummary;
    },
  });
}

export type TipsterRecord = {
  id: string;
  name: string;
  slug: string;
  isActive: boolean;
  settled: number;
  wins: number;
  losses: number;
  winRate: number | null;
  winRateInterval: { low: number | null; high: number | null };
  avgConfidence: number | null;
  roi: number | null;
};

export function useTipsterPerformance() {
  return useQuery({
    queryKey: ["stats", "tipsters"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<TipsterRecord[]> => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("get_tipster_performance");
      if (error) throw error;
      return (data as TipsterRecord[]) ?? [];
    },
  });
}

/* ----------------------------- backtesting -------------------------------- */

export type BacktestResult = {
  candidates: number;
  published: number;
  won: number;
  lost: number;
  winRate: number | null;
  winRateInterval: { low: number | null; high: number | null };
  unitsStaked: number;
  unitsReturned: number;
  roi: number | null;
  discarded: { count: number; winRate: number | null };
};

/**
 * Replay the selection and staking rules over picks the engine already made.
 *
 * NOT a full backtest, and the Office says so: re-running the model under new
 * weights would need a fresh inference per fixture and a stats feed that no
 * longer serves those dates. This answers "should we have published this, and
 * at what stake", not "what would the model have said".
 */
export function useBacktest(params: {
  floor: number;
  days: number;
  enabled: boolean;
}) {
  return useQuery({
    queryKey: ["backtest", params.floor, params.days],
    enabled: params.enabled,
    queryFn: async (): Promise<BacktestResult> => {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("backtest_thresholds", {
        p_floor: params.floor,
        p_days: params.days,
      });
      if (error) throw error;
      return data as BacktestResult;
    },
  });
}
