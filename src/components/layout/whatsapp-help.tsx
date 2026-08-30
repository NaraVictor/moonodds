"use client";

import { useEffect, useRef, useState } from "react";
import { WHATSAPP_NUMBER } from "@/lib/email-layout";

/** wa.me wants digits only — no plus, no spaces. */
export const WHATSAPP_URL = `https://wa.me/${WHATSAPP_NUMBER.replace(/[^0-9]/g, "")}`;

/** The mark, inline so it survives the CSP with no external request. */
export function WhatsAppIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M17.47 14.38c-.3-.15-1.75-.86-2.02-.96-.27-.1-.47-.15-.67.15-.2.3-.77.96-.94 1.16-.17.2-.35.22-.64.07-.3-.15-1.25-.46-2.38-1.47-.88-.78-1.47-1.75-1.64-2.05-.17-.3-.02-.46.13-.6.13-.14.3-.35.45-.53.15-.18.2-.3.3-.5.1-.2.05-.38-.02-.53-.08-.15-.67-1.6-.92-2.2-.24-.58-.49-.5-.67-.5h-.57c-.2 0-.52.07-.79.38-.27.3-1.04 1.01-1.04 2.47s1.06 2.86 1.21 3.06c.15.2 2.1 3.2 5.08 4.49.71.3 1.26.49 1.7.63.71.23 1.36.2 1.87.12.57-.09 1.75-.72 2-1.41.25-.7.25-1.29.17-1.41-.07-.13-.27-.2-.57-.35z" />
      <path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.25-1.38a9.86 9.86 0 0 0 4.79 1.22h.01c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2zm0 18.15h-.01a8.2 8.2 0 0 1-4.19-1.15l-.3-.18-3.12.82.83-3.04-.2-.31a8.17 8.17 0 0 1-1.25-4.38c0-4.54 3.7-8.23 8.24-8.23a8.17 8.17 0 0 1 5.82 2.42 8.17 8.17 0 0 1 2.41 5.82c0 4.54-3.7 8.23-8.23 8.23z" />
    </svg>
  );
}

/**
 * A floating way to reach us, that gets out of the way.
 *
 * Hidden while the reader is scrolling DOWN and brought back the moment they
 * stop or scroll up. Someone moving down a board is reading; a button following
 * them through it is the thing they came to ignore. Someone scrolling back up,
 * or sitting still, may well be looking for a way out — which is when it should
 * be there.
 *
 * On a phone it sits above the tab bar rather than over it, so it never covers
 * navigation.
 */
export function WhatsAppFab() {
  const [hidden, setHidden] = useState(false);
  const lastY = useRef(0);

  useEffect(() => {
    lastY.current = window.scrollY;
    let frame = 0;

    const onScroll = () => {
      // Coalesced into a frame: scroll fires far faster than the screen paints,
      // and reading scrollY per event is a layout read per event with it.
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        const delta = y - lastY.current;
        // A threshold, so a one-pixel jitter or the rubber-band at the top of
        // the page does not flicker it.
        if (Math.abs(delta) > 6) {
          setHidden(delta > 0 && y > 120);
          lastY.current = y;
        }
      });
    };

    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <a
      href={WHATSAPP_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat with us on WhatsApp"
      className={`press fixed right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full text-white shadow-lg transition-all duration-300 md:bottom-6 ${
        hidden ? "pointer-events-none translate-y-24 opacity-0" : "translate-y-0 opacity-100"
      }`}
      style={{
        // Clear of the tab bar on a phone, and of nothing on a desktop.
        bottom: "calc(env(safe-area-inset-bottom) + 5.5rem)",
        background: "#25D366",
      }}
    >
      <WhatsAppIcon className="h-7 w-7" />
    </a>
  );
}
