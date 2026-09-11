import { Injectable } from "@nestjs/common";
import { ProviderVerificationError } from "../errors.js";
import type {
  ProviderResult,
  ProviderSession,
  ProviderWebhookRequest,
  ProviderWebhookResult,
  VerificationProvider,
} from "./verification-provider.interface.js";

/**
 * ⚠️ DEVELOPMENT ONLY. Not a real identity-verification provider.
 *
 * This adapter never inspects a camera frame or performs any biometric
 * check. It exists purely so the end-to-end architecture (session creation
 * -> QR/mobile handoff -> "verification" -> WebSocket -> desktop update)
 * can be demoed and tested without a paid vendor account.
 *
 * Completion is driven exclusively by the mobile app's explicit
 * "Complete demo verification" button
 * (`VerificationService.completeDemoVerification`), which is itself gated
 * to only run when `VERIFICATION_PROVIDER=demo`. It does not accept
 * webhooks - there is no external system to send one, and pretending
 * otherwise would blur the line this codebase is deliberately drawing
 * between "trusted provider result" and "the phone said so".
 */
@Injectable()
export class DemoVerificationProvider implements VerificationProvider {
  readonly name = "demo";

  async createVerification(session: { id: string }): Promise<ProviderSession> {
    return { providerSessionId: `demo_${session.id}` };
  }

  async getVerificationStatus(): Promise<ProviderResult> {
    return { status: "PENDING" };
  }

  async verifyWebhook(_request: ProviderWebhookRequest): Promise<ProviderWebhookResult> {
    throw new ProviderVerificationError(
      "The demo provider does not accept webhooks - use the mobile app's Complete Demo Verification action.",
    );
  }
}
