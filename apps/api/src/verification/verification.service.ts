import { Inject, Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { canTransition, isTerminalStatus } from "@verifybridge/shared";
import { parseOriginList } from "../config/env.schema.js";
import { SESSION_EVENTS_PUBLISHER } from "../websocket/session-events.interface.js";
import type { SessionEventsPublisher } from "../websocket/session-events.interface.js";
import type { VerificationStatus } from "../../generated/prisma/enums.js";
import type { VerificationSessionModel } from "../../generated/prisma/models.js";
import {
  InvalidStateTransitionError,
  InvalidVerificationTokenError,
  OriginMismatchError,
  ProviderVerificationError,
  VerificationSessionConsumedError,
  VerificationSessionExpiredError,
  VerificationSessionNotFoundError,
} from "./errors.js";
import { VERIFICATION_PROVIDER } from "./providers/verification-provider.interface.js";
import type { VerificationProvider } from "./providers/verification-provider.interface.js";
import { generateSessionToken, hashSessionToken } from "./token.util.js";
import { VerificationRepository } from "./verification.repository.js";

export interface CreatedSession {
  session: VerificationSessionModel;
  desktopToken: string;
  mobileToken: string;
}

@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);
  private readonly ttlSeconds: number;
  private readonly tokenSecret: string;
  private readonly trustedIntermediaryOrigins: string[];

  constructor(
    private readonly repository: VerificationRepository,
    private readonly configService: ConfigService,
    @Inject(VERIFICATION_PROVIDER) private readonly provider: VerificationProvider,
    @Inject(SESSION_EVENTS_PUBLISHER) private readonly events: SessionEventsPublisher,
  ) {
    this.ttlSeconds = this.configService.getOrThrow<number>("SESSION_TTL_SECONDS");
    this.tokenSecret = this.configService.getOrThrow<string>("TOKEN_HASH_SECRET");
    this.trustedIntermediaryOrigins = parseOriginList(
      this.configService.getOrThrow<string>("TRUSTED_INTERMEDIARY_ORIGINS"),
    );
  }

  /**
   * `requestOrigin` is the caller's own `Origin` header, when the platform
   * provides one. Our Chrome extension's background worker is a trusted
   * intermediary that legitimately creates sessions on behalf of whatever
   * tab it's acting for, so its origin (configured via
   * `TRUSTED_INTERMEDIARY_ORIGINS`) is exempt; anything else with an Origin
   * header must match the origin it claims to be creating a session for, so
   * one site can't request a session while claiming to be another.
   */
  async createSession(origin: string, requestOrigin: string | undefined): Promise<CreatedSession> {
    const isTrustedIntermediary = requestOrigin
      ? this.trustedIntermediaryOrigins.includes(requestOrigin)
      : false;
    if (requestOrigin && !isTrustedIntermediary && requestOrigin !== origin) {
      throw new OriginMismatchError();
    }

    const desktopToken = generateSessionToken();
    const mobileToken = generateSessionToken();
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1000);

    const session = await this.repository.create({
      origin,
      desktopTokenHash: hashSessionToken(desktopToken, this.tokenSecret),
      mobileTokenHash: hashSessionToken(mobileToken, this.tokenSecret),
      expiresAt,
    });

    this.logger.log({ event: "verification_session_created", sessionId: session.id, origin });
    return { session, desktopToken, mobileToken };
  }

  /** Used by the WebSocket gateway on connect - the token alone identifies the session. */
  async resolveByDesktopToken(desktopToken: string): Promise<VerificationSessionModel> {
    return this.getByDesktopToken(desktopToken);
  }

  async getSessionForDesktop(sessionId: string, desktopToken: string): Promise<VerificationSessionModel> {
    const session = await this.getByDesktopToken(desktopToken);
    if (session.id !== sessionId) throw new InvalidVerificationTokenError();
    return session;
  }

  async cancelSession(
    sessionId: string,
    desktopToken: string,
    reason?: string,
  ): Promise<VerificationSessionModel> {
    const session = await this.getSessionForDesktop(sessionId, desktopToken);
    if (isTerminalStatus(session.status)) return session;
    return this.transition(session, "FAILED", reason ? `cancelled: ${reason}` : "cancelled_by_user");
  }

  /** GET of the mobile link. Also marks the session MOBILE_OPENED the first time it's fetched. */
  async openMobileSession(mobileToken: string): Promise<VerificationSessionModel> {
    const session = await this.getByMobileToken(mobileToken);
    if (session.status === "CREATED") {
      return this.transition(session, "MOBILE_OPENED");
    }
    return session;
  }

  /** Camera permission granted; kicks off the provider verification. */
  async startMobileVerification(mobileToken: string): Promise<VerificationSessionModel> {
    const session = await this.getByMobileToken(mobileToken);

    if (session.status === "CAMERA_GRANTED" || session.status === "VERIFYING") {
      return session; // idempotent retry (double-tap, slow network, etc.)
    }
    if (session.status !== "MOBILE_OPENED") {
      throw new VerificationSessionConsumedError();
    }

    const cameraGranted = await this.transition(session, "CAMERA_GRANTED");
    const providerSession = await this.provider.createVerification({
      id: cameraGranted.id,
      origin: cameraGranted.origin,
    });
    const verifying = await this.repository.applyUpdate(cameraGranted.id, {
      status: "VERIFYING",
      provider: this.provider.name,
      providerSessionId: providerSession.providerSessionId,
    });
    await this.publishUpdate(verifying);
    return verifying;
  }

  /**
   * Development-only completion path. Only reachable when the configured
   * provider is literally named "demo" - see DemoVerificationProvider - so
   * this can never be used to forge a result for a real vendor.
   */
  async completeDemoVerification(
    mobileToken: string,
    outcome: "success" | "failure",
  ): Promise<VerificationSessionModel> {
    if (this.provider.name !== "demo") {
      throw new ProviderVerificationError(
        "Demo completion is only available when VERIFICATION_PROVIDER=demo.",
      );
    }
    const session = await this.getByMobileToken(mobileToken);
    if (session.status !== "VERIFYING") {
      throw new VerificationSessionConsumedError();
    }
    if (outcome === "success") {
      return this.transition(session, "VERIFIED", undefined, { verifiedAt: new Date() });
    }
    return this.transition(session, "FAILED", "demo_verification_simulated_failure");
  }

  /** Trusted entry point for a real provider's signature-verified webhook result. */
  async applyProviderResult(
    providerSessionId: string,
    status: "VERIFIED" | "FAILED",
    failureReason?: string,
  ): Promise<VerificationSessionModel> {
    const session = await this.repository.findByProviderSessionId(providerSessionId);
    if (!session) throw new VerificationSessionNotFoundError();
    if (session.status !== "VERIFYING") {
      // Already resolved (or never reached VERIFYING) - ignore rather than error,
      // since a provider may legitimately retry webhook delivery.
      return session;
    }
    return this.transition(
      session,
      status,
      status === "FAILED" ? (failureReason ?? "provider_reported_failure") : undefined,
      status === "VERIFIED" ? { verifiedAt: new Date() } : undefined,
    );
  }

  private async getByDesktopToken(desktopToken: string): Promise<VerificationSessionModel> {
    const hash = hashSessionToken(desktopToken, this.tokenSecret);
    const session = await this.repository.findByDesktopTokenHash(hash);
    if (!session) throw new InvalidVerificationTokenError();
    return this.expireIfNeeded(session);
  }

  private async getByMobileToken(mobileToken: string): Promise<VerificationSessionModel> {
    const hash = hashSessionToken(mobileToken, this.tokenSecret);
    const session = await this.repository.findByMobileTokenHash(hash);
    if (!session) throw new VerificationSessionNotFoundError();
    return this.expireIfNeeded(session);
  }

  private async expireIfNeeded(session: VerificationSessionModel): Promise<VerificationSessionModel> {
    if (session.status === "EXPIRED") throw new VerificationSessionExpiredError();
    if (!isTerminalStatus(session.status) && session.expiresAt.getTime() <= Date.now()) {
      await this.transition(session, "EXPIRED");
      throw new VerificationSessionExpiredError();
    }
    return session;
  }

  private async transition(
    session: VerificationSessionModel,
    to: VerificationStatus,
    failureReason?: string,
    extra?: { verifiedAt?: Date },
  ): Promise<VerificationSessionModel> {
    if (!canTransition(session.status, to)) {
      throw new InvalidStateTransitionError(session.status, to);
    }
    const updated = await this.repository.applyUpdate(session.id, {
      status: to,
      failureReason: failureReason ?? null,
      ...extra,
    });
    await this.publishUpdate(updated);
    return updated;
  }

  private async publishUpdate(session: VerificationSessionModel): Promise<void> {
    this.logger.log({ event: "verification_session_status_changed", sessionId: session.id, status: session.status });
    await this.events.publish({
      sessionId: session.id,
      status: session.status,
      seq: session.seq,
      failureReason: session.failureReason,
    });
  }
}
