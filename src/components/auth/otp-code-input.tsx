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
    >
      <InputOTPGroup>
        {Array.from({ length: OTP_CODE_LENGTH }, (_, i) => (
          <InputOTPSlot key={i} index={i} />
        ))}
      </InputOTPGroup>
    </InputOTPRoot>
  );
}
