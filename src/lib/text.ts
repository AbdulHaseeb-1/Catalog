/** Trim and collapse runs of whitespace — "  Acme   Labs " → "Acme Labs". */
export function tidyName(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Comparison key for reference names. Case- and spacing-insensitive so
 * "acme labs" and "Acme  Labs" cannot both be added.
 */
export function normalizeKey(value: string): string {
  return tidyName(value).toLowerCase();
}

/** Case-insensitive "contains", used by the pickers' search boxes. */
export function matchesQuery(value: string, query: string): boolean {
  const q = normalizeKey(query);
  if (!q) return true;
  return normalizeKey(value).includes(q);
}

/** Filename-safe stem for exported PDFs. */
export function slugify(value: string, fallback = 'catalog'): string {
  const slug = tidyName(value)
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || fallback;
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

/** "A, B and C" — used in section label pages. */
export function listSentence(items: string[], max = 6): string {
  if (!items.length) return '';
  const shown = items.slice(0, max);
  const rest = items.length - shown.length;
  const joined =
    shown.length === 1
      ? shown[0]
      : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
  return rest > 0 ? `${joined} +${rest} more` : joined;
}
