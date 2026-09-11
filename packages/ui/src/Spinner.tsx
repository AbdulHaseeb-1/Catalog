import { cx } from "./cx.js";

export interface SpinnerProps {
  size?: "sm" | "md" | "lg";
  className?: string;
  label?: string;
}

const SIZE_CLASSES = {
  sm: "size-3.5 border-2",
  md: "size-5 border-2",
  lg: "size-8 border-[3px]",
} as const;

export function Spinner({ size = "md", className, label = "Loading" }: SpinnerProps) {
  return (
    <span role="status" className={cx("inline-flex items-center justify-center", className)}>
      <span
        aria-hidden="true"
        className={cx(
          "motion-safe:animate-spin rounded-full border-current border-t-transparent opacity-80",
          SIZE_CLASSES[size],
        )}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
