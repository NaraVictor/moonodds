"use client";

import { useState } from "react";
import { Toggle } from "@/components/ui/toggle";
import { Alert } from "@/components/ui/alert";
import { Bell, Mail, MessageSquare, ShieldCheck, Check } from "@/components/ui/icons";
import {
  useAccessState,
  useNotificationPreferences,
  useProfile,
  useUpdateNotificationPreferences,
  useUpdatePhone,
} from "@/lib/queries";
import { LinkButton } from "@/components/ui/link-button";

const CHANNELS = [
  { key: "email_enabled", label: "Email", detail: "To your account address", Icon: Mail },
  { key: "sms_enabled", label: "SMS", detail: "Needs a number below", Icon: MessageSquare },
] as const;

const ALERTS = [
  { key: "daily_picks_alert", label: "Daily predictions", detail: "When the board is published" },
  { key: "slip_result_alert", label: "Slip settled", detail: "When one of your slips resolves" },
  { key: "high_confidence_alert", label: "High confidence", detail: "When a call clears 95%" },
] as const;

export function ProfileClient() {
  const { data: profile, isPending } = useProfile();
  const { data: prefs } = useNotificationPreferences();
  const { data: access } = useAccessState();
  const updatePrefs = useUpdateNotificationPreferences();
  const updatePhone = useUpdatePhone();

  const [phone, setPhone] = useState<string | null>(null);
  const prefsRow = prefs as Record<string, boolean> | null;

  if (isPending) {
    return (
      <main className="mx-auto w-full max-w-2xl space-y-4 px-5 py-8">
        <div className="shimmer h-36 rounded-[1.75rem] bg-surface" />
        <div className="shimmer h-72 rounded-[1.75rem] bg-surface" />
      </main>
    );
  }

  const initials = (profile?.display_name ?? profile?.email ?? "?")
    .split(/[\s@.]+/)
    .slice(0, 2)
    .map((w: string) => w[0])
    .join("")
    .toUpperCase();

  return (
    <main className="mx-auto w-full max-w-2xl px-5 py-8">
      <header className="mb-6">
        <span className="label">Account</span>
        <h1 className="display mt-1.5 text-[2rem] sm:text-4xl">Profile</h1>
      </header>

      <div className="stagger space-y-4">
        {/* --------------------- identity + access --------------------- */}
        <section className="overflow-hidden rounded-[1.75rem] border border-border bg-surface">
          <div className="flex items-center gap-4 p-6">
            <span
              className="flex h-14 w-14 flex-none items-center justify-center rounded-full text-lg font-bold"
              style={{ background: "var(--accent-wash)", color: "var(--accent)" }}
            >
              {initials}
            </span>
            <div className="min-w-0">
              <p className="truncate text-[17px] font-semibold">
                {profile?.display_name ?? "—"}
              </p>
              <p className="truncate text-[13px] text-muted">{profile?.email}</p>
            </div>
          </div>

          <div
            className={`border-t px-6 py-5 ${
              access?.hasFullAccess ? "state-won" : "state-pending"
            }`}
          >
            {access?.isSuspended ? (
              <>
                <p className="text-sm font-semibold" style={{ color: "var(--lost-ink)" }}>
                  Account suspended
                </p>
                <p className="mt-1 text-[13px] leading-relaxed text-muted">
                  Prediction access is blocked, including days already paid for.
                </p>
              </>
            ) : access?.hasFullAccess ? (
              <div className="flex items-center gap-2.5">
                <Check className="h-4 w-4" style={{ color: "var(--won-ink)" }} strokeWidth={3} />
                <p className="text-sm font-semibold" style={{ color: "var(--won-ink)" }}>
                  Full access today
                </p>
              </div>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold">
                    {access?.isFirstDay
                      ? `Free day · ${access.freePickLimit} predictions`
                      : "No active pass"}
                  </p>
                  <p className="mt-0.5 text-[13px] text-muted">
                    Unlock the full board for $3.
                  </p>
                </div>
                <LinkButton href="/checkout/day-pass" size="sm" variant="primary">
                  Get a pass
                </LinkButton>
              </div>
            )}
          </div>
        </section>

        {/* --------------------- channels --------------------- */}
        <section className="rounded-[1.75rem] border border-border bg-surface p-6">
          <h2 className="text-[15px] font-semibold">How we reach you</h2>

          <div className="mt-4 space-y-4">
            {CHANNELS.map((c) => (
              <div key={c.key} className="flex items-center gap-3">
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-surface-secondary">
                  <c.Icon className="h-4 w-4 text-muted" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{c.label}</p>
                  <p className="text-xs text-muted">{c.detail}</p>
                </div>
                <Toggle
                  isSelected={prefsRow?.[c.key] ?? false}
                  isDisabled={updatePrefs.isPending}
                  onChange={(v) => updatePrefs.mutate({ [c.key]: v })}
                  label={c.label}
                />
              </div>
            ))}
          </div>

          <div className="mt-5 space-y-2">
            <label htmlFor="phone" className="label block">
              Phone number
            </label>
            <div className="flex gap-2">
              <input
                id="phone"
                type="tel"
                inputMode="tel"
                placeholder="+233 20 123 4567"
                value={phone ?? profile?.phone ?? ""}
                onChange={(e) => setPhone(e.target.value)}
                className="h-11 flex-1 rounded-full border border-field-border bg-field px-4 text-sm placeholder:text-field-placeholder focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              />
              <button
                type="button"
                disabled={phone === null || updatePhone.isPending}
                onClick={() => updatePhone.mutate(phone ?? "")}
                className="press h-11 rounded-full border border-border bg-surface px-5 text-sm font-semibold disabled:opacity-40"
              >
                {updatePhone.isSuccess && phone === null ? "Saved" : "Save"}
              </button>
            </div>
          </div>
        </section>

        {/* --------------------- alerts --------------------- */}
        <section className="rounded-[1.75rem] border border-border bg-surface p-6">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold">
            <Bell className="h-4 w-4 text-muted" />
            What we tell you about
          </h2>

          <div className="mt-4 space-y-4">
            {ALERTS.map((a) => (
              <div key={a.key} className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{a.label}</p>
                  <p className="text-xs text-muted">{a.detail}</p>
                </div>
                <Toggle
                  isSelected={prefsRow?.[a.key] ?? false}
                  isDisabled={updatePrefs.isPending}
                  onChange={(v) => updatePrefs.mutate({ [a.key]: v })}
                  label={a.label}
                />
              </div>
            ))}
          </div>
        </section>

        {(updatePrefs.error || updatePhone.error) && (
          <Alert status="danger">
            {(updatePrefs.error ?? updatePhone.error)?.message}
          </Alert>
        )}

        <section className="flex gap-3 rounded-[1.75rem] border border-border bg-surface p-6">
          <ShieldCheck className="h-4 w-4 flex-none text-muted" />
          <p className="text-xs leading-relaxed text-muted">
            18+ only. MoonOdds provides analysis, not guarantees. Never stake
            more than you can afford to lose — if it stops being fun, take a
            break.
          </p>
        </section>
      </div>
    </main>
  );
}
