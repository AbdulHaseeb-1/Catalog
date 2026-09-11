import { Controller, HttpCode, Inject, Param, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { ProviderVerificationError } from "../verification/errors.js";
import { VERIFICATION_PROVIDER } from "../verification/providers/verification-provider.interface.js";
import type { VerificationProvider } from "../verification/providers/verification-provider.interface.js";
import { VerificationService } from "../verification/verification.service.js";

type RequestWithRawBody = Request & { rawBody?: Buffer };

/**
 * Provider webhooks are the only path allowed to report VERIFIED/FAILED for
 * a real (non-demo) provider. Every request is signature-verified by the
 * provider adapter itself (`VerificationProvider.verifyWebhook`) before its
 * result is trusted - this controller never accepts a bare
 * `{ verified: true }` body at face value.
 */
@Controller("webhooks/verification")
export class WebhooksController {
  constructor(
    @Inject(VERIFICATION_PROVIDER) private readonly provider: VerificationProvider,
    private readonly verificationService: VerificationService,
  ) {}

  @Post(":provider")
  @HttpCode(200)
  async handle(
    @Param("provider") providerName: string,
    @Req() req: RequestWithRawBody,
  ): Promise<{ received: true }> {
    if (providerName !== this.provider.name) {
      throw new ProviderVerificationError(
        `This API is not configured to receive "${providerName}" webhooks.`,
      );
    }
    if (!req.rawBody) {
      throw new ProviderVerificationError("Missing raw request body for signature verification.");
    }

    const result = await this.provider.verifyWebhook({
      headers: req.headers as Record<string, string>,
      rawBody: req.rawBody,
      body: req.body,
    });

    await this.verificationService.applyProviderResult(
      result.providerSessionId,
      result.status,
      result.failureReason,
    );
    return { received: true };
  }
}
