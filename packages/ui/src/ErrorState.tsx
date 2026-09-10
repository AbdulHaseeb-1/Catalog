import { cx } from "./cx.js";
import { Button } from "./Button.js";

export interface ErrorStateProps {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  className?: string;
}

export function ErrorState({
  title,
  description,
  actionLabel,
  onAction,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cx("flex flex-col items-center gap-3 py-6 text-center", className)}
    >
      <span
        aria-hidden="true"
        className="flex size-12 items-center justify-center rounded-full bg-danger/10 text-2xl text-danger"
      >
        !
      </span>
      <div className="space-y-1">
        <p className="text-sm font-medium text-text">{title}</p>
        {description ? <p className="text-sm text-text-muted">{description}</p> : null}
      </div>
      {actionLabel && onAction ? (
        <Button variant="secondary" size="sm" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  );
}
