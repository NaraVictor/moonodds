"use client";

import { useState } from "react";
import { Card } from "@heroui/react/card";
import { Chip } from "@heroui/react/chip";
import { Button } from "@heroui/react/button";
import { Switch } from "@heroui/react/switch";
import { Skeleton } from "@heroui/react/skeleton";
import { Alert } from "@heroui/react/alert";
import {
  useAccessState,
  useNotificationPreferences,
  useProfile,
  useUpdateNotificationPreferences,
  useUpdatePhone,
} from "@/lib/queries";

const ALERTS = [
  {
    key: "daily_picks_alert",
    label: "Daily picks ready",
    detail: "When the day's board is generated",
  },
  {
    key: "slip_result_alert",
    label: "Slip settled",
    detail: "When one of your slips resolves",
  },
  {
    key: "high_confidence_alert",
    label: "High-confidence pick",
    detail: "When a pick clears 95% confidence",
  },
] as const;

const CHANNELS = [
  { key: "email_enabled", label: "Email", detail: "Sent to your account address" },
  { key: "sms_enabled", label: "SMS", detail: "Needs a phone number below" },
] as const;

export function ProfileClient() {
  const { data: profile, isPending } = useProfile();
  const { data: prefs } = useNotificationPreferences();
  const { data: access } = useAccessState();
  const updatePrefs = useUpdateNotificationPreferences();
  const updatePhone = useUpdatePhone();

  const [phone, setPhone] = useState<string | null>(null);

  if (isPending) {
    return (
      <main className="mx-auto w-full max-w-2xl space-y-4 px-5 py-8">
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-64 rounded-xl" />
      </main>
    );
  }

  const prefsRow = prefs as Record<string, boolean> | null;

  return (
    <main className="mx-auto w-full max-w-2xl space-y-5 px-5 py-8">
      <header className="space-y-1">
        <p className="label">Account</p>
        <h1 className="display text-2xl">Profile</h1>
      </header>

      <Card>
        <Card.Content className="space-y-3 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold">
                {profile?.display_name ?? "—"}
              </p>
              <p className="numeral text-xs text-muted">{profile?.email}</p>
            </div>
            <div className="flex flex-wrap justify-end gap-1.5">
              {access?.hasFullAccess && (
                <Chip size="sm" color="success" variant="soft">
                  Full access
                </Chip>
              )}
              {access?.isFirstDay && (
                <Chip size="sm" color="accent" variant="soft">
                  First day
                </Chip>
              )}
              {access?.isSuperAdmin && (
                <Chip size="sm" color="accent" variant="soft">
                  Admin
                </Chip>
              )}
              {access?.isSuspended && (
                <Chip size="sm" color="danger" variant="soft">
                  Suspended
                </Chip>
              )}
            </div>
          </div>

          {!access?.hasFullAccess && !access?.isSuspended && (
            <Alert status="accent">
              <Alert.Description>
                {access?.isFirstDay
                  ? `You're on your free day — ${access.freePickLimit} picks included.`
                  : "No active pass. Buy one to unlock today's board."}
              </Alert.Description>
            </Alert>
          )}
        </Card.Content>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>How we reach you</Card.Title>
        </Card.Header>
        <Card.Content className="space-y-4">
          {CHANNELS.map((c) => (
            <div key={c.key} className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">{c.label}</p>
                <p className="text-xs text-muted">{c.detail}</p>
              </div>
              <Switch
                isSelected={prefsRow?.[c.key] ?? false}
                isDisabled={updatePrefs.isPending}
                onChange={(v) => updatePrefs.mutate({ [c.key]: v })}
                aria-label={c.label}
              />
            </div>
          ))}

          <div className="space-y-1.5 pt-1">
            <label htmlFor="phone" className="text-sm font-medium">
              Phone number
            </label>
            <div className="flex gap-2">
              <input
                id="phone"
                type="tel"
                placeholder="+233 20 123 4567"
                value={phone ?? profile?.phone ?? ""}
                onChange={(e) => setPhone(e.target.value)}
                className="flex-1 rounded-xl border border-field-border bg-field px-3.5 py-2.5 text-sm text-field-foreground placeholder:text-field-placeholder"
              />
              <Button
                variant="secondary"
                isDisabled={phone === null || updatePhone.isPending}
                onPress={() => updatePhone.mutate(phone ?? "")}
              >
                Save
              </Button>
            </div>
          </div>
        </Card.Content>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title>What we tell you about</Card.Title>
        </Card.Header>
        <Card.Content className="space-y-4">
          {ALERTS.map((a) => (
            <div key={a.key} className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">{a.label}</p>
                <p className="text-xs text-muted">{a.detail}</p>
              </div>
              <Switch
                isSelected={prefsRow?.[a.key] ?? false}
                isDisabled={updatePrefs.isPending}
                onChange={(v) => updatePrefs.mutate({ [a.key]: v })}
                aria-label={a.label}
              />
            </div>
          ))}
        </Card.Content>
      </Card>

      {(updatePrefs.error || updatePhone.error) && (
        <Alert status="danger">
          <Alert.Description>
            {(updatePrefs.error ?? updatePhone.error)?.message}
          </Alert.Description>
        </Alert>
      )}

      <Card>
        <Card.Content className="p-5">
          <p className="text-xs leading-relaxed text-muted">
            18+ only. Predictions are analysis, not guarantees. Never stake more
            than you can afford to lose. If betting stops being fun, take a
            break.
          </p>
        </Card.Content>
      </Card>
    </main>
  );
}
