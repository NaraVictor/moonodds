import { devBypassEnabledClient } from "@/lib/dev-bypass";
import { ShieldOff } from "@/components/ui/icons";

/**
 * Loud, unmissable banner shown whenever the auth bypass is active. If this is
 * on screen, route guards are not protecting anything.
 */
export function BypassBanner() {
  if (!devBypassEnabledClient()) return null;

  return (
    <div
      role="alert"
      className="relative z-50 flex items-center justify-center gap-2 bg-danger px-4 py-1.5 text-center text-danger-foreground"
    >
      <ShieldOff className="h-3.5 w-3.5 flex-none" />
      <p className="text-xs font-semibold">
        Auth guards bypassed for testing — set{" "}
        <code className="font-mono text-[0.9em]">DEV_BYPASS_AUTH=false</code> to restore them.
        Never ships: disabled in production builds.
      </p>
    </div>
  );
}
