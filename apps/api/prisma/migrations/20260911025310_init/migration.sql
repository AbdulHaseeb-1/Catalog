-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('CREATED', 'MOBILE_OPENED', 'CAMERA_GRANTED', 'VERIFYING', 'VERIFIED', 'FAILED', 'EXPIRED', 'CONSUMED');

-- CreateTable
CREATE TABLE "VerificationSession" (
    "id" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "status" "VerificationStatus" NOT NULL DEFAULT 'CREATED',
    "desktopTokenHash" TEXT NOT NULL,
    "mobileTokenHash" TEXT NOT NULL,
    "provider" TEXT,
    "providerSessionId" TEXT,
    "seq" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "consumedAt" TIMESTAMP(3),
    "failureReason" TEXT,

    CONSTRAINT "VerificationSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VerificationSession_desktopTokenHash_key" ON "VerificationSession"("desktopTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationSession_mobileTokenHash_key" ON "VerificationSession"("mobileTokenHash");

-- CreateIndex
CREATE INDEX "VerificationSession_status_idx" ON "VerificationSession"("status");

-- CreateIndex
CREATE INDEX "VerificationSession_expiresAt_idx" ON "VerificationSession"("expiresAt");
