import type { ReactNode } from "react";
import { cx } from "./cx.js";
import { Button } from "./Button.js";

export interface SuccessStateProps {
  title: string;
  description?: ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export function SuccessState({
  title,
  description,
  actionLabel,
  onAction,
  className,
}: SuccessStateProps) {
  return (
    <div
      role="status"
      className={cx("flex flex-col items-center gap-3 py-6 text-center", className)}
    >
      <span
        aria-hidden="true"
        className="flex size-12 items-center justify-center rounded-full bg-success/10 text-2xl text-success"
      >
        ✓
      </span>
      <div className="space-y-1">
        <p className="text-sm font-semibold text-text">{title}</p>
        {description ? <p className="text-sm text-text-muted">{description}</p> : null}
      </div>
      {actionLabel && onAction ? (
        <Button size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
