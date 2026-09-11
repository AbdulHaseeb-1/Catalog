import { Injectable } from "@nestjs/common";
import { PrismaService } from "../common/prisma/prisma.service.js";
import type { VerificationStatus } from "../../generated/prisma/enums.js";
import type { VerificationSessionModel as VerificationSession } from "../../generated/prisma/models.js";

export interface CreateSessionInput {
  origin: string;
  desktopTokenHash: string;
  mobileTokenHash: string;
  expiresAt: Date;
}

export interface StatusUpdateInput {
  status: VerificationStatus;
  failureReason?: string | null;
  provider?: string;
  providerSessionId?: string;
  verifiedAt?: Date;
  consumedAt?: Date;
}

@Injectable()
export class VerificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: CreateSessionInput): Promise<VerificationSession> {
    return this.prisma.verificationSession.create({ data: { ...input, status: "CREATED" } });
  }

  findById(id: string): Promise<VerificationSession | null> {
    return this.prisma.verificationSession.findUnique({ where: { id } });
  }

  findByDesktopTokenHash(hash: string): Promise<VerificationSession | null> {
    return this.prisma.verificationSession.findUnique({ where: { desktopTokenHash: hash } });
  }

  findByMobileTokenHash(hash: string): Promise<VerificationSession | null> {
    return this.prisma.verificationSession.findUnique({ where: { mobileTokenHash: hash } });
  }

  findByProviderSessionId(providerSessionId: string): Promise<VerificationSession | null> {
    return this.prisma.verificationSession.findFirst({ where: { providerSessionId } });
  }

  /** Applies a status update and atomically bumps `seq`, returning the new row. */
  applyUpdate(id: string, input: StatusUpdateInput): Promise<VerificationSession> {
    return this.prisma.verificationSession.update({
      where: { id },
      data: { ...input, seq: { increment: 1 } },
    });
  }
}
