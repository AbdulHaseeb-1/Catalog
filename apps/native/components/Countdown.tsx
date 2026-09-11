import { useEffect, useState } from "react";
import { StyleSheet, Text } from "react-native";

export interface CountdownProps {
  expiresAt: string;
  onExpire?: () => void;
  label?: string;
}

function formatRemaining(ms: number): string {
  const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** Ticking mm:ss countdown; fires `onExpire` once, exactly when it reaches zero. */
export function Countdown({ expiresAt, onExpire, label }: CountdownProps) {
  const [remainingMs, setRemainingMs] = useState(() => new Date(expiresAt).getTime() - Date.now());

  useEffect(() => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expiresAt]);

  const isLow = remainingMs <= 60_000 && remainingMs > 0;

  return (
    <Text style={[styles.text, isLow && styles.low, remainingMs <= 0 && styles.expired]}>
      {label ? `${label} ` : ""}
      {formatRemaining(remainingMs)}
    </Text>
  );
}

const styles = StyleSheet.create({
  text: { fontSize: 14, color: "#6B7280", textAlign: "center" },
  low: { color: "#D97706" },
  expired: { color: "#DC2626" },
});
