export interface ProviderSession {
  providerSessionId: string;
}

export interface ProviderResult {
  status: "VERIFIED" | "FAILED" | "PENDING";
  failureReason?: string;
}

export interface ProviderWebhookResult {
  providerSessionId: string;
  status: "VERIFIED" | "FAILED";
  failureReason?: string;
}

export interface ProviderWebhookRequest {
  headers: Record<string, string>;
  rawBody: Buffer;
  body: unknown;
}

/**
 * Dependency-inversion boundary between our session domain and whichever
 * identity-verification vendor is actually doing the biometric work
 * (Persona, Veriff, Sumsub, Onfido/Entrust, Stripe Identity, ...). Only
 * `DemoVerificationProvider` ships an implementation; everything else in
 * this codebase depends on this interface, never on a concrete vendor.
 */
export interface VerificationProvider {
  readonly name: string;

  createVerification(session: { id: string; origin: string }): Promise<ProviderSession>;

  getVerificationStatus(providerSessionId: string): Promise<ProviderResult>;

  /**
   * Verifies the webhook's signature against `rawBody` and, only if valid,
   * returns the result it carries. Must throw on an invalid/missing
   * signature - callers treat a thrown error as "reject this request",
   * never as "no result yet".
   */
  verifyWebhook(request: ProviderWebhookRequest): Promise<ProviderWebhookResult>;
}

export const VERIFICATION_PROVIDER = Symbol("VERIFICATION_PROVIDER");
