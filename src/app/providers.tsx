"use client";

import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { RouterProvider } from "react-aria-components";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BetSlipProvider } from "@/lib/bet-slip";

declare module "react-aria-components" {
  interface RouterConfig {
    routerOptions: NonNullable<
      Parameters<ReturnType<typeof useRouter>["push"]>[1]
    >;
  }
}

/**
 * HeroUI v3 needs no provider of its own, styling is pure CSS variables.
 * What we do wire up:
 *   - RouterProvider, so React Aria links (Button href, Link) use the Next router
 *     instead of full page loads.
 *   - TanStack Query, which replaces Convex's reactive useQuery. Picks change
 *     once a day, so defaults are deliberately unfussy: no refetch on focus,
 *     a minute of staleness, and one retry.
 */
export function Providers({ children }: { children: ReactNode }) {
  const router = useRouter();

  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return (
    <RouterProvider navigate={router.push} useHref={(href) => href}>
      <QueryClientProvider client={queryClient}>
        <BetSlipProvider>{children}</BetSlipProvider>
      </QueryClientProvider>
    </RouterProvider>
  );
}
