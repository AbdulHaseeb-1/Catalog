import { z } from "zod";
import { VERIFICATION_STATUSES } from "./status.js";

/**
 * A browser `Origin` header value: scheme://host[:port], no path, no
 * trailing slash, no credentials. We validate against this (rather than an
 * arbitrary URL) because origin-binding is a security control, not a UX
 * nicety - see OriginMismatchError in the API.
 */
export const originSchema = z
  .string()
  .max(512)
  .refine(
    (value) => {
      try {
        const url = new URL(value);
        if (url.protocol !== "http:" && url.protocol !== "https:") return false;
        return url.origin === value;
      } catch {
        return false;
      }
    },
    { error: "Must be a valid http(s) origin, e.g. https://example.com" },
  );

export const verificationStatusSchema = z.enum(VERIFICATION_STATUSES);

export const createVerificationSessionRequestSchema = z.object({
  origin: originSchema,
});
export type CreateVerificationSessionRequest = z.infer<
  typeof createVerificationSessionRequestSchema
>;

export const cancelVerificationSessionRequestSchema = z.object({
  reason: z.string().max(200).optional(),
});
export type CancelVerificationSessionRequest = z.infer<
  typeof cancelVerificationSessionRequestSchema
>;

export const mobileTokenParamSchema = z.object({
  token: z.string().min(16).max(256),
});

export const clientWebSocketMessageSchema = z.object({
  type: z.literal("ping"),
});
export type ClientWebSocketMessage = z.infer<typeof clientWebSocketMessageSchema>;
