import type { VerificationStatus } from "@verifybridge/shared";
import { cx } from "./cx.js";

export interface StatusPresentation {
  label: string;
  dotClassName: string;
  pulse?: boolean;
}

// eslint-disable-next-line react-refresh/only-export-components -- shared data map, intentionally co-located
export const STATUS_PRESENTATION: Record<VerificationStatus, StatusPresentation> = {
  CREATED: { label: "Waiting for phone", dotClassName: "bg-text-faint", pulse: true },
  MOBILE_OPENED: { label: "Phone connected", dotClassName: "bg-accent", pulse: true },
  CAMERA_GRANTED: { label: "Camera ready", dotClassName: "bg-accent", pulse: true },
  VERIFYING: { label: "Verifying…", dotClassName: "bg-accent", pulse: true },
  VERIFIED: { label: "Verified", dotClassName: "bg-success" },
  FAILED: { label: "Verification failed", dotClassName: "bg-danger" },
  EXPIRED: { label: "Link expired", dotClassName: "bg-text-faint" },
  CONSUMED: { label: "Completed", dotClassName: "bg-success" },
};

export interface StatusIndicatorProps {
  status: VerificationStatus;
  className?: string;
}

/**
 * A dot + label combo, e.g. "● Waiting for phone". Wrapped in a polite
 * live region so screen-reader users hear status changes without every
 * intermediate render being announced individually.
 */
export function StatusIndicator({ status, className }: StatusIndicatorProps) {
  const presentation = STATUS_PRESENTATION[status];
  return (
    <span
      role="status"
      aria-live="polite"
      className={cx("inline-flex items-center gap-2 text-sm text-text-muted", className)}
    >
      <span
        aria-hidden="true"
        className={cx(
          "size-2 rounded-full",
          presentation.dotClassName,
          presentation.pulse && "motion-safe:animate-pulse",
        )}
      />
      {presentation.label}
    </span>
  );
}
