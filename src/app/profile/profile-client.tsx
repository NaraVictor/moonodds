"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Toggle } from "@/components/ui/toggle";
import { Alert } from "@/components/ui/alert";
import { Bell, Mail, MessageSquare, ShieldCheck, Check, Sun, Moon, Monitor } from "@/components/ui/icons";
import { useTheme, type ThemePref } from "@/lib/theme";
import {
  useAccessState,
  useNotificationPreferences,
  useProfile,
  useUpdateNotificationPreferences,
  useUpdatePhone,
  useUpdateDisplayName,
  useProfileStats,
  useMyLeaguePerformance,
  usePlayLimits,
  useSetPlayLimits,
  useSelfExclude,
} from "@/lib/queries";
import { formatPercent } from "@/lib/format";
import { LinkButton } from "@/components/ui/link-button";
import {
  PASS_PRICE_USD,
} from "@/lib/pricing";

const CHANNELS = [
  { key: "email_enabled", label: "Email", detail: "To your account address", Icon: Mail },
  { key: "sms_enabled", label: "SMS", detail: "Needs a number below", Icon: MessageSquare },
] as const;

const ALERTS = [
  { key: "daily_picks_alert", label: "Daily predictions", detail: "When the board is published" },
  { key: "slip_result_alert", label: "Slip settled", detail: "When one of your slips resolves" },
  { key: "high_confidence_alert", label: "High confidence", detail: "When a call clears 80%" },
] as const;

const THEMES: { v: ThemePref; label: string; Icon: typeof Sun }[] = [
  { v: "light", label: "Light", Icon: Sun },
  { v: "dark", label: "Dark", Icon: Moon },
  { v: "system", label: "System", Icon: Monitor },
];

export function ProfileClient() {
  const { data: profile, isPending } = useProfile();
  const { data: prefs } = useNotificationPreferences();
  const { data: access } = useAccessState();
  const updatePrefs = useUpdateNotificationPreferences();
  const updatePhone = useUpdatePhone();
  const updateName = useUpdateDisplayName();
  const { theme, choose: chooseTheme } = useTheme();
  const { data: stats } = useProfileStats();
  const { data: leagues } = useMyLeaguePerformance();

  const [phone, setPhone] = useState<string | null>(null);
  // null means "not being edited"; the stored name shows until someone starts.
  const [name, setName] = useState<string | null>(null);
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
            <div className="min-w-0 flex-1">
              {/* Editable in place. Nobody chose this name — sign-up asks for an
                  address and nothing else, so everyone starts as a generated
                  pairing. Putting the field where the name already is means
                  changing it is one click from noticing it, rather than a
                  settings page away. */}
              <label htmlFor="displayName" className="sr-only">
                Display name
              </label>
              <input
                id="displayName"
                value={name ?? profile?.display_name ?? ""}
                onChange={(e) => setName(e.target.value)}
                maxLength={40}
                placeholder="Your name"
                aria-describedby="displayNameHelp"
                className="w-full truncate rounded-lg border border-transparent bg-transparent px-2 py-1 text-[17px] font-semibold -ml-2 hover:border-border focus-visible:border-field-border focus-visible:bg-field focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              />
              <p className="truncate px-2 -ml-2 text-[13px] text-muted">
                {profile?.email}
              </p>
            </div>

            {name !== null && name.trim() !== (profile?.display_name ?? "") && (
              <button
                type="button"
                disabled={updateName.isPending || !name.trim()}
                onClick={() =>
                  updateName.mutate(name, { onSuccess: () => setName(null) })
                }
                className="press h-9 flex-none rounded-full bg-accent px-4 text-[13px] font-semibold text-accent-foreground disabled:opacity-40"
              >
                {updateName.isPending ? "Saving…" : "Save"}
              </button>
            )}
          </div>

          {updateName.isError && (
            <p id="displayNameHelp" className="px-6 pb-4 -mt-2 text-[12px]" style={{ color: "var(--lost-ink)" }}>
              {updateName.error instanceof Error
                ? updateName.error.message
                : "Could not save that name."}
            </p>
          )}

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
                    Unlock the full board for ${PASS_PRICE_USD}.
                  </p>
                </div>
                <LinkButton href="/checkout/day-pass" size="sm" variant="primary">
                  Get a pass
                </LinkButton>
              </div>
            )}
          </div>
        </section>

        {/* --------------------- your record --------------------- */}
        {stats && stats.totalSlips > 0 && (
          <section className="rounded-[1.75rem] border border-border bg-surface p-6">
            <h2 className="text-[15px] font-semibold">Your record</h2>
            <p className="mt-1 text-[13px] text-muted">
              Across the slips you&rsquo;ve saved. ROI assumes one unit staked
              per slip, we never see what you actually staked.
            </p>

            <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                {
                  label: "Win rate",
                  value: stats.winRate === null ? "-" : formatPercent(stats.winRate, 0),
                  tone: "var(--success)",
                },
                {
                  label: "ROI",
                  value:
                    stats.roi === null
                      ? "-"
                      : `${stats.roi > 0 ? "+" : ""}${Math.round(stats.roi * 100)}%`,
                  tone: stats.roi === null ? undefined : stats.roi >= 0 ? "var(--won-ink)" : "var(--lost-ink)",
                },
                { label: "Slips", value: String(stats.totalSlips) },
                {
                  label: "Avg confidence",
                  value:
                    stats.avgConfidence === null
                      ? "-"
                      : `${Math.round(Number(stats.avgConfidence) * 10)}%`,
                },
              ].map((s) => (
                <div key={s.label} className="rounded-xl bg-surface-secondary px-3 py-4">
                  <dd className="numeral text-xl" style={s.tone ? { color: s.tone } : undefined}>
                    {s.value}
                  </dd>
                  <dt className="label mt-1">{s.label}</dt>
                </div>
              ))}
            </dl>

            <div className="mt-4 flex gap-1.5">
              {(
                [
                  { n: stats.won, label: "won", c: "var(--success)" },
                  { n: stats.lost, label: "lost", c: "var(--danger)" },
                  { n: stats.pending, label: "open", c: "var(--surface-tertiary)" },
                ] as const
              )
                .filter((x) => x.n > 0)
                .map((x) => (
                  <span
                    key={x.label}
                    title={`${x.n} ${x.label}`}
                    className="h-1.5 rounded-full"
                    style={{ flex: x.n, background: x.c }}
                  />
                ))}
            </div>
            <p className="mt-2 text-[11px] text-muted">
              {stats.won} won · {stats.lost} lost · {stats.pending} still open
            </p>
          </section>
        )}

        {/* --------------------- engine by league --------------------- */}
        {leagues && leagues.length > 0 && (
          <section className="overflow-hidden rounded-[1.75rem] border border-border bg-surface">
            <div className="px-6 pt-6">
              <h2 className="text-[15px] font-semibold">
                Accuracy in your leagues
              </h2>
              <p className="mt-1 text-[13px] text-muted">
                How the model has done in the leagues you have actually backed,
                not across the whole product. Add a slip in a new league and it
                appears here.{" "}
                <Link
                  href="/history"
                  className="underline underline-offset-2"
                  style={{ color: "var(--link)" }}
                >
                  See the full record
                </Link>
                .
              </p>
            </div>

            <ul className="mt-4 divide-y divide-separator border-t border-separator">
              {leagues.map((l) => (
                <li key={l.leagueName} className="flex items-center gap-3 px-6 py-3">
                  {l.logo && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={l.logo} alt="" width={18} height={18} className="h-[18px] w-[18px] flex-none object-contain" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium">{l.leagueName}</p>
                    <p className="truncate text-[11px] text-muted">{l.country}</p>
                  </div>
                  <span className="numeral flex-none text-[11px] text-muted">
                    {l.yourLegs != null && l.yourLegs > 0 && (
                      <span className="mr-2">
                        {l.yourLegs} {l.yourLegs === 1 ? "leg" : "legs"}
                      </span>
                    )}
                    {l.wins}W&ndash;{l.losses}L
                  </span>
                  <span
                    className="numeral w-12 flex-none text-right text-[13px] font-semibold"
                    style={{
                      color:
                        l.accuracyRate >= 0.6
                          ? "var(--won-ink)"
                          : l.accuracyRate < 0.45
                            ? "var(--lost-ink)"
                            : "var(--foreground)",
                    }}
                  >
                    {Math.round(l.accuracyRate * 100)}%
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* --------------------- staying in control --------------------- */}
        <PlayControls />

        {/* --------------------- your data --------------------- */}
        <DataRights />

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

        {/* --------------------- appearance --------------------- */}
        <section className="rounded-[1.75rem] border border-border bg-surface p-6">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold">
            <Sun className="h-4 w-4 text-muted" />
            Appearance
          </h2>
          <p className="mt-1 text-[13px] text-muted">
            Saved on this device. A phone at night and a desk at noon can differ.
          </p>

          <div
            className="mt-4 flex gap-2"
            role="radiogroup"
            aria-label="Colour theme"
          >
            {THEMES.map(({ v, label, Icon }) => {
              const on = theme === v;
              return (
                <button
                  key={v}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => chooseTheme(v)}
                  className="press flex flex-1 cursor-pointer flex-col items-center gap-1.5 rounded-xl border px-3 py-3 text-xs font-medium transition-colors"
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
                  <Icon className="h-5 w-5" />
                  {label}
                </button>
              );
            })}
          </div>
        </section>

        {/* --------------------- alerts --------------------- */}
        <section className="rounded-[1.75rem] border border-border bg-surface p-6">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold">
            <Bell className="h-4 w-4 text-muted" />
            When to receive notifications
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
            18+ only. Kicka provides analysis, not guarantees. Never stake
            more than you can afford to lose, if it stops being fun, take a
            break.
          </p>
        </section>
      </div>
    </main>
  );
}


/**
 * Staying in control.
 *
 * The product sells betting analysis, so these are not a settings nicety, they
 * are the tools a person needs to bound their own use of it. A spend cap is
 * checked before any charge; a self-exclusion blocks access outright, including
 * on days already paid for.
 */
function PlayControls() {
  const { data: limits } = usePlayLimits();
  const setLimits = useSetPlayLimits();
  const exclude = useSelfExclude();
  const [cap, setCap] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<{ days: number; until: Date } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const capValue = cap ?? (limits?.monthlyCapUsd?.toString() ?? "");

  if (limits?.isExcluded) {
    return (
      <section className="rounded-[1.75rem] border border-border bg-surface p-6">
        <h2 className="text-[15px] font-semibold">You are self-excluded</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          Predictions are closed to you until{" "}
          <span className="font-semibold text-foreground">
            {new Date(limits.excludedUntil!).toLocaleDateString(undefined, {
              day: "numeric",
              month: "long",
              year: "numeric",
            })}
          </span>
          . This cannot be shortened from here, which is the point of it. If you
          need help before then,{" "}
          <a
            href="https://www.begambleaware.org"
            target="_blank"
            rel="noreferrer noopener"
            className="underline underline-offset-2"
            style={{ color: "var(--link)" }}
          >
            BeGambleAware
          </a>{" "}
          is independent and free.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-[1.75rem] border border-border bg-surface p-6">
      <h2 className="text-[15px] font-semibold">Staying in control</h2>
      <p className="mt-1 text-[13px] text-muted">
        Limits you set here are enforced by us, not by you.
      </p>

      {error && (
        <Alert status="danger" className="mt-4">
          {error}
        </Alert>
      )}

      <div className="mt-5 space-y-1.5">
        <label htmlFor="cap" className="text-sm font-medium">
          Monthly spend limit
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted">$</span>
          <input
            id="cap"
            type="number"
            min="1"
            step="1"
            inputMode="numeric"
            value={capValue}
            placeholder="No limit"
            onChange={(e) => setCap(e.target.value)}
            className="h-11 w-32 rounded-xl border border-field-border bg-field px-3 font-mono text-sm"
          />
          <button
            type="button"
            disabled={setLimits.isPending}
            onClick={() =>
              setLimits.mutate({
                monthlyCapUsd: capValue === "" ? null : Number(capValue),
                realityCheckMinutes: limits?.realityCheckMinutes ?? null,
              })
            }
            className="press h-11 rounded-full bg-accent px-5 text-[13px] font-semibold text-accent-foreground disabled:opacity-40"
          >
            Save limit
          </button>
        </div>
        <p className="text-[12px] text-muted">
          Spent in the last 30 days:{" "}
          <span className="numeral font-semibold text-foreground">
            ${limits?.spentThisMonthUsd ?? 0}
          </span>
          . A purchase that would cross your limit is refused at checkout.
        </p>
      </div>

      <div className="mt-6 border-t border-separator pt-5">
        <p className="text-sm font-medium">Take a break</p>
        <p className="mt-1 text-[12px] leading-relaxed text-muted">
          Closes predictions to you for the period you choose, including days
          you have already paid for. It cannot be undone early.
        </p>

        <div className="mt-3 flex flex-wrap gap-2">
          {[7, 30, 90, 182].map((days) => (
            <button
              key={days}
              type="button"
              onClick={() => {
                setError(null);
                setConfirming({
                  days,
                  until: new Date(Date.now() + days * 86400000),
                });
              }}
              className={`press rounded-full border px-4 py-2 text-[13px] font-semibold transition-colors ${
                confirming?.days === days
                  ? "border-transparent"
                  : "border-border hover:bg-surface-secondary"
              }`}
              style={
                confirming?.days === days
                  ? { background: "var(--lost-wash)", color: "var(--lost-ink)" }
                  : undefined
              }
            >
              {days < 30 ? `${days} days` : `${Math.round(days / 30)} months`}
            </button>
          ))}
        </div>

        {confirming !== null && (
          <div className="mt-4 rounded-2xl border border-border bg-surface-secondary p-4">
            <p className="text-[13px] leading-relaxed">
              This closes predictions to you until{" "}
              <span className="font-semibold">
                {confirming.until.toLocaleDateString(undefined, {
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </span>
              . We will not reopen it early, and any pass you hold will not be
              refunded.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                disabled={exclude.isPending}
                onClick={() =>
                  exclude.mutate(confirming.days, {
                    onError: (e) =>
                      setError(e instanceof Error ? e.message : "Could not set that."),
                    onSuccess: () => setConfirming(null),
                  })
                }
                className="press rounded-full px-4 py-2 text-[13px] font-semibold disabled:opacity-40"
                style={{ background: "var(--lost-wash)", color: "var(--lost-ink)" }}
              >
                Yes, close my access
              </button>
              <button
                type="button"
                onClick={() => setConfirming(null)}
                className="press rounded-full px-4 py-2 text-[13px] font-semibold text-muted"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

/** Export and deletion. Rights rather than features, so no upsell around them. */
function DataRights() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/account", { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      // The session is gone with the account, so refresh the server components
      // rather than leaving a signed-in shell pointing at a deleted user.
      router.replace("/");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the account.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-[1.75rem] border border-border bg-surface p-6">
      <h2 className="text-[15px] font-semibold">Your data</h2>
      <p className="mt-1 text-[13px] text-muted">
        Take a copy whenever you like, or close the account for good.
      </p>

      {error && (
        <Alert status="danger" className="mt-4">
          {error}
        </Alert>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <a
          href="/api/account"
          className="press inline-flex h-11 items-center rounded-full border border-border px-5 text-[13px] font-semibold hover:bg-surface-secondary"
        >
          Download my data
        </a>

        {confirming ? (
          <>
            {/* --feature-lost, not --lost-ink. The ink tokens lighten in dark
                mode because they are designed to sit ON a pale wash; used as
                the ground under white text they fall to about 1.4:1. This is
                the ground token and holds in both themes. */}
            <button
              type="button"
              disabled={busy}
              onClick={remove}
              className="press h-11 rounded-full px-5 text-[13px] font-semibold text-white disabled:opacity-40"
              style={{ background: "var(--feature-lost)" }}
            >
              {busy ? "Deleting…" : "Really delete everything"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="press h-11 rounded-full px-5 text-[13px] font-semibold text-muted"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="press h-11 rounded-full border px-5 text-[13px] font-semibold"
            style={{
              borderColor: "var(--lost-edge)",
              color: "var(--lost-ink)",
              background: "var(--lost-wash)",
            }}
          >
            Delete my account
          </button>
        )}
      </div>

      <p className="mt-3 text-[12px] leading-relaxed text-muted">
        Deleting removes your profile, slips and preferences immediately. Payment
        records are kept but unlinked from you: they are financial records with
        their own retention rules.
      </p>
    </section>
  );
}
