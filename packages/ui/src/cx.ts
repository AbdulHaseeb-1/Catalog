export type ClassValue = string | false | null | undefined;

/** Minimal `clsx`-style class joiner - avoids pulling in a dependency for this alone. */
export function cx(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}
