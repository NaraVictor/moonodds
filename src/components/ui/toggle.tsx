"use client";

import { Switch } from "@heroui/react/switch";

/**
 * HeroUI v3's Switch is compound, Root > Content > Control > Thumb. A bare
 * <Switch/> mounts but renders nothing visible, which is a quiet way to ship a
 * settings page with invisible controls. Composed once here so call sites stay
 * a one-liner and the interaction is consistent everywhere.
 */
export function Toggle({
  isSelected,
  onChange,
  isDisabled,
  label,
}: {
  isSelected: boolean;
  onChange: (v: boolean) => void;
  isDisabled?: boolean;
  label: string;
}) {
  return (
    <Switch
      isSelected={isSelected}
      onChange={onChange}
      isDisabled={isDisabled}
      aria-label={label}
      className="flex-none"
    >
      <Switch.Content>
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
      </Switch.Content>
    </Switch>
  );
}
