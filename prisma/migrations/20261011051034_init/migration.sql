-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('PARENT', 'CHILD');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('RECEIVED', 'NEEDS_REVIEW', 'ESCALATED', 'ACKNOWLEDGED', 'CLOSED');

-- CreateEnum
CREATE TYPE "Urgency" AS ENUM ('routine', 'time_sensitive', 'urgent', 'emergency');

-- CreateEnum
CREATE TYPE "DetectionSource" AS ENUM ('RULE_SOS', 'RULE_PHRASE', 'RULE_POSSIBLE', 'LLM', 'FALLBACK');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'DEAD');

-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('NORMAL', 'ATTENTION', 'EMERGENCY', 'ESCALATION', 'PARENT_ACK', 'SYSTEM');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "displayName" TEXT NOT NULL,
    "email" TEXT,
    "passwordHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "households" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "households_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "household_memberships" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "MemberRole" NOT NULL,
    "isEmergencyContact" BOOLEAN NOT NULL DEFAULT false,
    "escalationOrder" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "household_memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_accounts" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "telegramUserId" BIGINT NOT NULL,
    "chatId" BIGINT NOT NULL,
    "username" TEXT,
    "botStarted" BOOLEAN NOT NULL DEFAULT false,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pairing_codes" (
    "id" UUID NOT NULL,
    "householdId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "role" "MemberRole" NOT NULL,
    "targetUserId" UUID,
    "parentDisplayName" TEXT,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "usedByTelegramUserId" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pairing_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "telegram_updates" (
    "updateId" BIGINT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcome" TEXT NOT NULL,
    "requestId" UUID,

    CONSTRAINT "telegram_updates_pkey" PRIMARY KEY ("updateId")
);

-- CreateTable
CREATE TABLE "requests" (
    "id" UUID NOT NULL,
    "reference" SERIAL NOT NULL,
    "householdId" UUID NOT NULL,
    "parentUserId" UUID NOT NULL,
    "telegramUpdateId" BIGINT,
    "originalMessage" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "serviceType" TEXT,
    "issueSummary" TEXT,
    "urgency" "Urgency" NOT NULL,
    "isEmergency" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DOUBLE PRECISION,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "clarificationQuestion" TEXT,
    "status" "RequestStatus" NOT NULL DEFAULT 'RECEIVED',
    "detectionSource" "DetectionSource" NOT NULL,
    "classificationMeta" JSONB,
    "acknowledgedAt" TIMESTAMP(3),
    "acknowledgedById" UUID,
    "escalationLevel" INTEGER NOT NULL DEFAULT 0,
    "nextEscalationAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "request_events" (
    "id" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "actorUserId" UUID,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "request_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_outbox" (
    "id" UUID NOT NULL,
    "requestId" UUID,
    "recipientUserId" UUID NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'telegram',
    "kind" "NotificationKind" NOT NULL,
    "chatId" BIGINT NOT NULL,
    "text" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    "providerMessageId" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_buckets" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("key","windowStart")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "household_memberships_userId_idx" ON "household_memberships"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "household_memberships_householdId_userId_key" ON "household_memberships"("householdId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_accounts_userId_key" ON "telegram_accounts"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "telegram_accounts_telegramUserId_key" ON "telegram_accounts"("telegramUserId");

-- CreateIndex
CREATE UNIQUE INDEX "pairing_codes_codeHash_key" ON "pairing_codes"("codeHash");

-- CreateIndex
CREATE INDEX "pairing_codes_householdId_idx" ON "pairing_codes"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_tokenHash_key" ON "sessions"("tokenHash");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "requests_reference_key" ON "requests"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "requests_telegramUpdateId_key" ON "requests"("telegramUpdateId");

-- CreateIndex
CREATE INDEX "requests_householdId_createdAt_idx" ON "requests"("householdId", "createdAt");

-- CreateIndex
CREATE INDEX "requests_isEmergency_status_nextEscalationAt_idx" ON "requests"("isEmergency", "status", "nextEscalationAt");

-- CreateIndex
CREATE INDEX "request_events_requestId_createdAt_idx" ON "request_events"("requestId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_outbox_idempotencyKey_key" ON "notification_outbox"("idempotencyKey");

-- CreateIndex
CREATE INDEX "notification_outbox_status_nextAttemptAt_idx" ON "notification_outbox"("status", "nextAttemptAt");

-- AddForeignKey
ALTER TABLE "household_memberships" ADD CONSTRAINT "household_memberships_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_memberships" ADD CONSTRAINT "household_memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "telegram_accounts" ADD CONSTRAINT "telegram_accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pairing_codes" ADD CONSTRAINT "pairing_codes_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_parentUserId_fkey" FOREIGN KEY ("parentUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "requests" ADD CONSTRAINT "requests_acknowledgedById_fkey" FOREIGN KEY ("acknowledgedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "request_events" ADD CONSTRAINT "request_events_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_outbox" ADD CONSTRAINT "notification_outbox_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

