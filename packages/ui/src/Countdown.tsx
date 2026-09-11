import { useEffect, useState } from "react";
import { cx } from "./cx.js";

export interface CountdownProps {
  expiresAt: string;
  onExpire?: () => void;
  className?: string;
  /** Prefix shown before the mm:ss value, e.g. "Expires in". */
  label?: string;
}

function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Ticking mm:ss countdown. Deliberately does not wire the ticking text into
 * an aria-live region - announcing every second would be unusable for
 * screen-reader users. `onExpire` fires once, exactly when the countdown
 * reaches zero, so callers can surface that transition through their own
 * (debounced) status announcement instead.
 */
export function Countdown({ expiresAt, onExpire, className, label }: CountdownProps) {
  const [remainingMs, setRemainingMs] = useState(() => new Date(expiresAt).getTime() - Date.now());

  useEffect(() => {
    // If `expiresAt` changes on an already-mounted instance, the displayed
    // value catches up on the next tick (<=1s) rather than resetting state
    // synchronously here - avoids a render-phase setState for a case that in
    // practice doesn't happen (a session's expiry is fixed for its lifetime).
    const targetMs = new Date(expiresAt).getTime();
    let expired = false;

    const interval = setInterval(() => {
      const next = targetMs - Date.now();
      setRemainingMs(next);
      if (next <= 0 && !expired) {
        expired = true;
        onExpire?.();
        clearInterval(interval);
      }
    }, 1000);

    return () => clearInterval(interval);
    // Intentionally omitting `onExpire` - a new callback identity shouldn't restart the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiresAt]);

  const isLow = remainingMs <= 60_000 && remainingMs > 0;

  return (
    <span
      className={cx(
        "tabular-nums text-sm",
        isLow ? "text-warning" : "text-text-muted",
        remainingMs <= 0 && "text-danger",
        className,
      )}
    >
      {label ? `${label} ` : ""}
      {formatRemaining(remainingMs)}
    </span>
  );
}
