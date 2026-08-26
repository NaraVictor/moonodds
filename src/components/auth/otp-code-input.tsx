"use client";

import { InputOTPRoot, InputOTPGroup, InputOTPSlot } from "@heroui/react";
import { OTP_CODE_LENGTH } from "@/lib/otp-auth";

/**
 * The one code input in the product.
 *
 * There were two: a text field with letter-spacing on the sign-in page, and a
 * second, differently-sized one in the Office. A slotted input is not merely
 * nicer to look at — it shows how many digits are expected before you start
 * typing, which a tracking-[0.3em] text box cannot.
 *
 * `onComplete` submits on the last digit, which is the behaviour people expect
 * from this control. The button stays for anyone who does not.
 */
export function OtpCodeInput({
  value,
  onChange,
  onComplete,
  disabled = false,
  invalid = false,
  autoFocus = false,
  label = "Your code",
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete?: () => void;
  disabled?: boolean;
  invalid?: boolean;
  autoFocus?: boolean;
  label?: string;
}) {
  return (
    <InputOTPRoot
      maxLength={OTP_CODE_LENGTH}
      value={value}
      onChange={onChange}
      onComplete={onComplete}
      isDisabled={disabled}
      isInvalid={invalid}
      autoFocus={autoFocus}
      aria-label={label}
      // The browser's own one-time-code affordance: iOS offers the code from
      // the message above the keyboard, Chrome offers it from the email.
      // Losing that would make this slower than the field it replaces.
      autoComplete="one-time-code"
      inputMode="numeric"
      pattern="[0-9]*"
      // The root is w-full and left-aligned by default, which left six boxes
      // hugging the edge of a centred card.
      className="justify-center"
    >
      <InputOTPGroup className="justify-center">
        {Array.from({ length: OTP_CODE_LENGTH }, (_, i) => (
          <InputOTPSlot
            key={i}
            index={i}
            /*
             * Set inline rather than by class, deliberately.
             *
             * The library applies `rounded-field`, `shadow-field` and
             * `border-color: var(--field-border)` through @apply inside its own
             * stylesheet. A utility class here would carry identical
             * specificity, so which one won would come down to stylesheet
             * order — which is not something to leave to a build.
             *
             * `rounded-field` reads --radius, and this project sets that to
             * 1rem for its cards. On a 40px box that is nearly a pill; the
             * interior scale (--radius-md) is what the rest of the app's fields
             * use and is what these should have been on all along.
             */
            style={{
              borderRadius: "var(--radius-md)",
              borderColor: "var(--foreground)",
              boxShadow: "none",
            }}
            className="h-12 w-11 text-base"
          />
        ))}
      </InputOTPGroup>
    </InputOTPRoot>
  );
}
