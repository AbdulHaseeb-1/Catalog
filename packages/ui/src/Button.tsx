import { forwardRef } from "react";
import type { ButtonHTMLAttributes } from "react";
import { cx } from "./cx.js";
import { Spinner } from "./Spinner.js";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: cx(
    "bg-accent text-accent-foreground",
    "hover:bg-accent-hover",
    "disabled:bg-accent/50",
  ),
  secondary: cx(
    "bg-surface text-text border border-border",
    "hover:border-border-strong",
    "disabled:opacity-50",
  ),
  ghost: cx("bg-transparent text-text", "hover:bg-text/5", "disabled:opacity-50"),
  danger: cx(
    "bg-danger text-danger-foreground",
    "hover:bg-danger/90",
    "disabled:bg-danger/50",
  ),
};

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: "h-8 px-3 text-xs gap-1.5 rounded-md",
  md: "h-10 px-4 text-sm gap-2 rounded-lg",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", loading = false, disabled, className, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(
        "inline-flex items-center justify-center font-medium",
        "transition-colors duration-150",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
        "disabled:cursor-not-allowed",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className,
      )}
      {...rest}
    >
      {loading ? <Spinner size="sm" className={variant === "primary" ? "text-accent-foreground" : undefined} /> : null}
      {children}
    </button>
  );
});
