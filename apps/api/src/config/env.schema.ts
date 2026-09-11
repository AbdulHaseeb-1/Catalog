import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  API_PORT: z.coerce.number().int().positive().default(4000),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  PUBLIC_API_URL: z.string().min(1),
  PUBLIC_MOBILE_URL: z.string().min(1),
  CORS_ALLOWED_ORIGINS: z.string().default(""),
  // Origins allowed to create a session on behalf of a *different* claimed
  // origin - i.e. our own Chrome extension's chrome-extension://<id>. Left
  // empty by default: until configured, every caller's Origin header (when
  // present) must exactly match the origin it claims to be creating a
  // session for. See VerificationService.createSession.
  TRUSTED_INTERMEDIARY_ORIGINS: z.string().default(""),
  VERIFICATION_PROVIDER: z.string().default("demo"),
  SESSION_TTL_SECONDS: z.coerce.number().int().positive().default(300),
  TOKEN_HASH_SECRET: z.string().min(16),
  WEBHOOK_SIGNING_SECRET: z.string().min(16),
  RATE_LIMIT_TTL_SECONDS: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(20),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}

export function parseOriginList(value: string): string[] {
  return value
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}
