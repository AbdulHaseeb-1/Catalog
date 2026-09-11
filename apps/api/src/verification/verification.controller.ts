import { Body, Controller, Get, HttpCode, Headers, Param, Post, UseGuards } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  cancelVerificationSessionRequestSchema,
  createVerificationSessionRequestSchema,
} from "@verifybridge/shared";
import type { CreateVerificationSessionResponse, VerificationSessionDTO, MobileSessionView } from "@verifybridge/shared";
import { z } from "zod";
import { ZodValidationPipe } from "../common/pipes/zod-validation.pipe.js";
import { extractBearerToken } from "../common/http/bearer-token.js";
import { RateLimitGuard } from "../common/guards/rate-limit.guard.js";
import { toMobileView, toSessionDTO } from "./verification.mapper.js";
import { VerificationService } from "./verification.service.js";

const completeDemoRequestSchema = z.object({
  outcome: z.enum(["success", "failure"]).default("success"),
});

@Controller("verification-sessions")
export class VerificationController {
  constructor(
    private readonly verificationService: VerificationService,
    private readonly configService: ConfigService,
  ) {}

  @Post()
  @UseGuards(RateLimitGuard)
  async create(
    @Body(new ZodValidationPipe(createVerificationSessionRequestSchema)) body: { origin: string },
    @Headers("origin") requestOrigin: string | undefined,
  ): Promise<CreateVerificationSessionResponse> {
    const { session, desktopToken, mobileToken } = await this.verificationService.createSession(
      body.origin,
      requestOrigin,
    );

    const publicMobileUrl = this.configService.getOrThrow<string>("PUBLIC_MOBILE_URL");
    const publicApiUrl = this.configService.getOrThrow<string>("PUBLIC_API_URL");

    return {
      session: toSessionDTO(session),
      desktopToken,
      mobileUrl: `${publicMobileUrl.replace(/\/+$/, "")}/session/${mobileToken}`,
      wsUrl: publicApiUrl.replace(/^http/, "ws"),
    };
  }

  @Get("mobile/:token")
  async getMobileSession(@Param("token") token: string): Promise<MobileSessionView> {
    const session = await this.verificationService.openMobileSession(token);
    return toMobileView(session);
  }

  @Post("mobile/:token/start")
  @HttpCode(200)
  async startMobile(@Param("token") token: string): Promise<MobileSessionView> {
    const session = await this.verificationService.startMobileVerification(token);
    return toMobileView(session);
  }

  @Post("mobile/:token/complete-demo")
  @HttpCode(200)
  async completeDemo(
    @Param("token") token: string,
    @Body(new ZodValidationPipe(completeDemoRequestSchema)) body: { outcome: "success" | "failure" },
  ): Promise<MobileSessionView> {
    const session = await this.verificationService.completeDemoVerification(token, body.outcome);
    return toMobileView(session);
  }

  @Post(":id/cancel")
  @HttpCode(204)
  async cancel(
    @Param("id") id: string,
    @Body(new ZodValidationPipe(cancelVerificationSessionRequestSchema)) body: { reason?: string },
    @Headers("authorization") authorization: string | undefined,
  ): Promise<void> {
    const desktopToken = extractBearerToken(authorization);
    await this.verificationService.cancelSession(id, desktopToken, body.reason);
  }

  @Get(":id/status")
  async status(
    @Param("id") id: string,
    @Headers("authorization") authorization: string | undefined,
  ): Promise<VerificationSessionDTO> {
    const desktopToken = extractBearerToken(authorization);
    const session = await this.verificationService.getSessionForDesktop(id, desktopToken);
    return toSessionDTO(session);
  }
}
