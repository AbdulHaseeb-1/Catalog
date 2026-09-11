import { demoSiteAdapter } from "./demo-site.adapter";
import type { SiteAdapter } from "./types";

export type { SiteAdapter } from "./types";

/** Register additional integrations here - see the README for the pattern. */
export const siteAdapters: SiteAdapter[] = [demoSiteAdapter];

export function findAdapterFor(location: Location): SiteAdapter | undefined {
  return siteAdapters.find((adapter) => adapter.matches(location));
}
