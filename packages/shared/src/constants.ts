export const DEFAULT_SESSION_TTL_SECONDS = 300;

/** Number of random bytes used to generate desktop/mobile session tokens. */
export const SESSION_TOKEN_BYTES = 32;

export const API_PREFIX = "/api/v1";
export const WS_PATH = "/ws/verification";

/** Providers the architecture ships an adapter interface for. Only "demo" ships an implementation. */
export const KNOWN_PROVIDERS = [
  "demo",
  "persona",
  "veriff",
  "sumsub",
  "onfido",
  "stripe-identity",
] as const;
export type KnownProviderName = (typeof KNOWN_PROVIDERS)[number];
