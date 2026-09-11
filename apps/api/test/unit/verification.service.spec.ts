import { describe, expect, it, vi } from "vitest";
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
} from "../../src/verification/errors.js";
import type {
  ProviderResult,
  ProviderSession,
  ProviderWebhookRequest,
  ProviderWebhookResult,
  VerificationProvider,
} from "../../src/verification/providers/verification-provider.interface.js";
import { hashSessionToken } from "../../src/verification/token.util.js";
import type { VerificationRepository } from "../../src/verification/verification.repository.js";
import { VerificationService } from "../../src/verification/verification.service.js";
import type { SessionEventsPublisher, SessionStatusChange } from "../../src/websocket/session-events.interface.js";

const SECRET = "test-secret";
const TTL_SECONDS = 300;

function makeSession(overrides: Partial<VerificationSessionModel> = {}): VerificationSessionModel {
  const now = new Date();
  return {
    id: overrides.id ?? "session-1",
    origin: "https://example.com",
    status: "CREATED",
    desktopTokenHash: hashSessionToken("desktop-token", SECRET),
    mobileTokenHash: hashSessionToken("mobile-token", SECRET),
    provider: null,
    providerSessionId: null,
    seq: 0,
    createdAt: now,
    expiresAt: new Date(now.getTime() + TTL_SECONDS * 1000),
    verifiedAt: null,
    consumedAt: null,
    failureReason: null,
    ...overrides,
  };
}

class FakeRepository {
  sessions = new Map<string, VerificationSessionModel>();

  seed(session: VerificationSessionModel): void {
    this.sessions.set(session.id, session);
  }

  create = vi.fn(async (input: { origin: string; desktopTokenHash: string; mobileTokenHash: string; expiresAt: Date }) => {
    const session = makeSession({ id: `session-${this.sessions.size + 1}`, ...input, status: "CREATED" });
    this.sessions.set(session.id, session);
    return session;
  });

  findById = vi.fn(async (id: string) => this.sessions.get(id) ?? null);

  findByDesktopTokenHash = vi.fn(async (hash: string) =>
    [...this.sessions.values()].find((s) => s.desktopTokenHash === hash) ?? null,
  );

  findByMobileTokenHash = vi.fn(async (hash: string) =>
    [...this.sessions.values()].find((s) => s.mobileTokenHash === hash) ?? null,
  );

  findByProviderSessionId = vi.fn(async (providerSessionId: string) =>
    [...this.sessions.values()].find((s) => s.providerSessionId === providerSessionId) ?? null,
  );

  applyUpdate = vi.fn(
    async (
      id: string,
      input: {
        status: VerificationStatus;
        failureReason?: string | null;
        provider?: string;
        providerSessionId?: string;
        verifiedAt?: Date;
      },
    ) => {
      const existing = this.sessions.get(id);
      if (!existing) throw new Error("not found");
      const updated: VerificationSessionModel = {
        ...existing,
        ...input,
        failureReason: input.failureReason === undefined ? existing.failureReason : input.failureReason,
        seq: existing.seq + 1,
      };
      this.sessions.set(id, updated);
      return updated;
    },
  );
}

class FakeProvider implements VerificationProvider {
  name = "demo";
  createVerification = vi.fn(async (session: { id: string }): Promise<ProviderSession> => ({
    providerSessionId: `demo_${session.id}`,
  }));
  getVerificationStatus = vi.fn(async (): Promise<ProviderResult> => ({ status: "PENDING" }));
  verifyWebhook = vi.fn(async (_req: ProviderWebhookRequest): Promise<ProviderWebhookResult> => {
    throw new ProviderVerificationError();
  });
}

class FakeEventsPublisher implements SessionEventsPublisher {
  events: SessionStatusChange[] = [];
  publish = vi.fn(async (change: SessionStatusChange) => {
    this.events.push(change);
  });
}

function makeConfigService(overrides: Record<string, unknown> = {}) {
  const values: Record<string, unknown> = {
    SESSION_TTL_SECONDS: TTL_SECONDS,
    TOKEN_HASH_SECRET: SECRET,
    TRUSTED_INTERMEDIARY_ORIGINS: "",
    ...overrides,
  };
  return { getOrThrow: (key: string) => values[key] };
}

function makeService(options?: { provider?: VerificationProvider; trustedIntermediaryOrigins?: string }) {
  const repository = new FakeRepository();
  const provider = options?.provider ?? new FakeProvider();
  const events = new FakeEventsPublisher();
  const configService = makeConfigService({
    TRUSTED_INTERMEDIARY_ORIGINS: options?.trustedIntermediaryOrigins ?? "",
  });
  const service = new VerificationService(
    repository as unknown as VerificationRepository,
    configService as never,
    provider,
    events,
  );
  return { service, repository, provider: provider as FakeProvider, events };
}

describe("VerificationService", () => {
  describe("createSession", () => {
    it("creates a session and returns plaintext tokens exactly once", async () => {
      const { service, repository } = makeService();
      const result = await service.createSession("https://example.com", undefined);

      expect(result.session.status).toBe("CREATED");
      expect(result.desktopToken).toBeTruthy();
      expect(result.mobileToken).toBeTruthy();
      expect(repository.create).toHaveBeenCalledWith(
        expect.objectContaining({ origin: "https://example.com" }),
      );
      // The stored row never contains the raw token, only its hash.
      const stored = repository.sessions.get(result.session.id)!;
      expect(stored.desktopTokenHash).not.toBe(result.desktopToken);
    });

    it("rejects a mismatched Origin header from an untrusted caller", async () => {
      const { service } = makeService();
      await expect(
        service.createSession("https://example.com", "https://attacker.com"),
      ).rejects.toBeInstanceOf(OriginMismatchError);
    });

    it("allows a trusted intermediary origin to create a session for a different claimed origin", async () => {
      const { service } = makeService({ trustedIntermediaryOrigins: "chrome-extension://abc123" });
      const result = await service.createSession("https://example.com", "chrome-extension://abc123");
      expect(result.session.origin).toBe("https://example.com");
    });
  });

  describe("the mobile lifecycle", () => {
    it("marks a session MOBILE_OPENED on first open, and is idempotent after", async () => {
      const { service, events } = makeService();
      const { session, mobileToken } = await createReal(service);

      const opened = await service.openMobileSession(mobileToken);
      expect(opened.status).toBe("MOBILE_OPENED");
      expect(events.events).toHaveLength(1);
      expect(events.events[0]).toMatchObject({ sessionId: session.id, status: "MOBILE_OPENED" });

      const openedAgain = await service.openMobileSession(mobileToken);
      expect(openedAgain.status).toBe("MOBILE_OPENED");
      expect(events.events).toHaveLength(1); // no duplicate transition/event
    });

    it("rejects starting verification before the link has been opened", async () => {
      const { service } = makeService();
      const { mobileToken } = await createReal(service);
      await expect(service.startMobileVerification(mobileToken)).rejects.toBeInstanceOf(
        VerificationSessionConsumedError,
      );
    });

    it("progresses MOBILE_OPENED -> CAMERA_GRANTED -> VERIFYING and calls the provider", async () => {
      const { service, provider, events } = makeService();
      const { mobileToken } = await createReal(service);
      await service.openMobileSession(mobileToken);

      const verifying = await service.startMobileVerification(mobileToken);

      expect(verifying.status).toBe("VERIFYING");
      expect(verifying.provider).toBe("demo");
      expect(provider.createVerification).toHaveBeenCalledOnce();
      expect(events.events.map((e) => e.status)).toEqual(["MOBILE_OPENED", "CAMERA_GRANTED", "VERIFYING"]);
    });

    it("is idempotent when the camera step is retried", async () => {
      const { service, provider } = makeService();
      const { mobileToken } = await createReal(service);
      await service.openMobileSession(mobileToken);
      await service.startMobileVerification(mobileToken);

      await service.startMobileVerification(mobileToken); // double-tap
      expect(provider.createVerification).toHaveBeenCalledOnce();
    });
  });

  describe("completeDemoVerification", () => {
    it("only runs when the configured provider is literally named demo", async () => {
      const notDemo: VerificationProvider = {
        name: "persona",
        createVerification: vi.fn(),
        getVerificationStatus: vi.fn(),
        verifyWebhook: vi.fn(),
      };
      const { service } = makeService({ provider: notDemo });
      const { mobileToken } = await createReal(service);
      await expect(
        service.completeDemoVerification(mobileToken, "success"),
      ).rejects.toBeInstanceOf(ProviderVerificationError);
    });

    it("moves VERIFYING -> VERIFIED on success and stamps verifiedAt", async () => {
      const { service } = makeService();
      const { mobileToken } = await createReal(service);
      await service.openMobileSession(mobileToken);
      await service.startMobileVerification(mobileToken);

      const verified = await service.completeDemoVerification(mobileToken, "success");
      expect(verified.status).toBe("VERIFIED");
      expect(verified.verifiedAt).not.toBeNull();
    });

    it("moves VERIFYING -> FAILED on a simulated failure", async () => {
      const { service } = makeService();
      const { mobileToken } = await createReal(service);
      await service.openMobileSession(mobileToken);
      await service.startMobileVerification(mobileToken);

      const failed = await service.completeDemoVerification(mobileToken, "failure");
      expect(failed.status).toBe("FAILED");
      expect(failed.failureReason).toBeTruthy();
    });

    it("cannot be replayed once the session has already reached a final state", async () => {
      const { service } = makeService();
      const { mobileToken } = await createReal(service);
      await service.openMobileSession(mobileToken);
      await service.startMobileVerification(mobileToken);
      await service.completeDemoVerification(mobileToken, "success");

      await expect(
        service.completeDemoVerification(mobileToken, "success"),
      ).rejects.toBeInstanceOf(VerificationSessionConsumedError);
    });
  });

  describe("applyProviderResult (trusted webhook path)", () => {
    it("resolves a VERIFYING session by its providerSessionId", async () => {
      const { service } = makeService();
      const { mobileToken } = await createReal(service);
      await service.openMobileSession(mobileToken);
      const verifying = await service.startMobileVerification(mobileToken);

      const result = await service.applyProviderResult(verifying.providerSessionId!, "VERIFIED");
      expect(result.status).toBe("VERIFIED");
    });

    it("throws for an unknown providerSessionId", async () => {
      const { service } = makeService();
      await expect(service.applyProviderResult("nope", "VERIFIED")).rejects.toBeInstanceOf(
        VerificationSessionNotFoundError,
      );
    });

    it("is a no-op (not an error) for a session that already resolved - tolerates webhook retries", async () => {
      const { service } = makeService();
      const { mobileToken } = await createReal(service);
      await service.openMobileSession(mobileToken);
      const verifying = await service.startMobileVerification(mobileToken);
      await service.applyProviderResult(verifying.providerSessionId!, "VERIFIED");

      const result = await service.applyProviderResult(verifying.providerSessionId!, "VERIFIED");
      expect(result.status).toBe("VERIFIED");
    });
  });

  describe("expiry", () => {
    it("lazily expires a non-terminal session once its TTL has passed", async () => {
      const { service, repository } = makeService();
      const expired = makeSession({
        id: "expired-1",
        mobileTokenHash: hashSessionToken("expired-mobile-token", SECRET),
        status: "MOBILE_OPENED",
        expiresAt: new Date(Date.now() - 1000),
      });
      repository.seed(expired);

      await expect(service.startMobileVerification("expired-mobile-token")).rejects.toBeInstanceOf(
        VerificationSessionExpiredError,
      );
      expect(repository.sessions.get("expired-1")!.status).toBe("EXPIRED");
    });

    it("does not re-expire a session that already reached a terminal outcome", async () => {
      const { service, repository } = makeService();
      const verified = makeSession({
        id: "verified-1",
        mobileTokenHash: hashSessionToken("verified-mobile-token", SECRET),
        status: "VERIFIED",
        expiresAt: new Date(Date.now() - 1000),
      });
      repository.seed(verified);

      const session = await service.openMobileSession("verified-mobile-token");
      expect(session.status).toBe("VERIFIED");
    });
  });

  describe("cancelSession", () => {
    it("transitions an in-progress session to FAILED with the given reason", async () => {
      const { service } = makeService();
      const { session, desktopToken } = await createReal(service);

      const cancelled = await service.cancelSession(session.id, desktopToken, "user closed popup");
      expect(cancelled.status).toBe("FAILED");
      expect(cancelled.failureReason).toContain("user closed popup");
    });

    it("is a no-op for an already-terminal session", async () => {
      const { service } = makeService();
      const { session, desktopToken } = await createReal(service);
      await service.cancelSession(session.id, desktopToken);

      const cancelledAgain = await service.cancelSession(session.id, desktopToken);
      expect(cancelledAgain.status).toBe("FAILED");
    });
  });

  describe("desktop token handling", () => {
    it("rejects an unknown desktop token", async () => {
      const { service } = makeService();
      await expect(service.resolveByDesktopToken("garbage")).rejects.toBeInstanceOf(
        InvalidVerificationTokenError,
      );
    });

    it("rejects a valid token presented for the wrong session id", async () => {
      const { service } = makeService();
      const { desktopToken } = await createReal(service);
      await expect(service.getSessionForDesktop("some-other-id", desktopToken)).rejects.toBeInstanceOf(
        InvalidVerificationTokenError,
      );
    });
  });

  it("rejects an out-of-order transition attempt with a clear domain error", async () => {
    const { service } = makeService();
    const { mobileToken } = await createReal(service);
    // Jumping straight to demo-complete without opening/starting first.
    await expect(
      service.completeDemoVerification(mobileToken, "success"),
    ).rejects.toSatisfy(
      (err: unknown) =>
        err instanceof VerificationSessionConsumedError || err instanceof InvalidStateTransitionError,
    );
  });
});

async function createReal(service: VerificationService) {
  const created = await service.createSession("https://example.com", undefined);
  return created;
}
