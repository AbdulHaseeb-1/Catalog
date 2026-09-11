import { createHmac, randomBytes } from "node:crypto";
import { SESSION_TOKEN_BYTES } from "@verifybridge/shared";

/** Generates a cryptographically random, URL-safe session token. */
export function generateSessionToken(): string {
  return randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
}

/**
 * Deterministic keyed hash used to look up sessions by token without ever
 * persisting the raw value. High-entropy tokens (256 bits here) don't need a
 * slow/salted password hash - a fast keyed hash (HMAC-SHA256) is the
 * standard approach for API-token-style secrets, and keeps lookups a plain
 * indexed equality query.
 */
export function hashSessionToken(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token).digest("hex");
}
