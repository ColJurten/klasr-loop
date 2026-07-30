-- CreateEnum
CREATE TYPE "MemberRole" AS ENUM ('ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "DriveProvider" AS ENUM ('GOOGLE_DRIVE', 'ONEDRIVE');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'PROPOSED', 'CLASSIFIED', 'MANUAL');

-- CreateEnum
CREATE TYPE "ProposalSource" AS ENUM ('RULE', 'LLM');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('PENDING', 'CONFIRMED', 'OVERRIDDEN', 'REJECTED');

-- CreateEnum
CREATE TYPE "ConditionField" AS ENUM ('CONTENT', 'FILENAME', 'MIME_TYPE');

-- CreateEnum
CREATE TYPE "ConditionOperator" AS ENUM ('CONTAINS', 'EQUALS');

-- CreateEnum
CREATE TYPE "HistoryAction" AS ENUM ('MOVE', 'RENAME', 'MOVE_RENAME', 'REJECT');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "role" "MemberRole" NOT NULL DEFAULT 'MEMBER',
    "userId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DriveConnection" (
    "id" TEXT NOT NULL,
    "provider" "DriveProvider" NOT NULL,
    "externalId" TEXT NOT NULL,
    "encryptedToken" TEXT NOT NULL,
    "scopes" TEXT[],
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSyncAt" TIMESTAMP(3),
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "DriveConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Folder" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "parentId" TEXT,
    "priority" BOOLEAN NOT NULL DEFAULT false,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "Folder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "folderId" TEXT,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassificationProposal" (
    "id" TEXT NOT NULL,
    "proposedName" TEXT NOT NULL,
    "destinationPath" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "source" "ProposalSource" NOT NULL,
    "modelUsed" TEXT,
    "llmCallsUsed" INTEGER NOT NULL DEFAULT 0,
    "status" "ProposalStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),
    "documentId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "ClassificationProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassificationRule" (
    "id" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "destinationPath" TEXT NOT NULL,
    "suggestedNameTemplate" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "ClassificationRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RuleCondition" (
    "id" TEXT NOT NULL,
    "field" "ConditionField" NOT NULL,
    "operator" "ConditionOperator" NOT NULL,
    "value" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,

    CONSTRAINT "RuleCondition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ActionHistory" (
    "id" TEXT NOT NULL,
    "action" "HistoryAction" NOT NULL,
    "fromPath" TEXT,
    "toPath" TEXT,
    "fromName" TEXT,
    "toName" TEXT,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "documentId" TEXT NOT NULL,
    "actorId" TEXT,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "ActionHistory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UsageMetric" (
    "id" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "documentsIn" INTEGER NOT NULL DEFAULT 0,
    "ruleMatches" INTEGER NOT NULL DEFAULT 0,
    "llmCalls" INTEGER NOT NULL DEFAULT 0,
    "ocrRuns" INTEGER NOT NULL DEFAULT 0,
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "UsageMetric_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'free',
    "status" TEXT NOT NULL DEFAULT 'active',
    "renewsAt" TIMESTAMP(3),
    "organizationId" TEXT NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "Membership_organizationId_idx" ON "Membership"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_userId_organizationId_key" ON "Membership"("userId", "organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "DriveConnection_organizationId_key" ON "DriveConnection"("organizationId");

-- CreateIndex
CREATE INDEX "Folder_organizationId_path_idx" ON "Folder"("organizationId", "path");

-- CreateIndex
CREATE UNIQUE INDEX "Folder_organizationId_externalId_key" ON "Folder"("organizationId", "externalId");

-- CreateIndex
CREATE INDEX "Document_organizationId_status_idx" ON "Document"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Document_organizationId_externalId_key" ON "Document"("organizationId", "externalId");

-- CreateIndex
CREATE INDEX "ClassificationProposal_organizationId_status_idx" ON "ClassificationProposal"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ClassificationRule_organizationId_enabled_idx" ON "ClassificationRule"("organizationId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "ClassificationRule_organizationId_priority_key" ON "ClassificationRule"("organizationId", "priority");

-- CreateIndex
CREATE INDEX "ActionHistory_organizationId_executedAt_idx" ON "ActionHistory"("organizationId", "executedAt");

-- CreateIndex
CREATE INDEX "Notification_organizationId_readAt_idx" ON "Notification"("organizationId", "readAt");

-- CreateIndex
CREATE UNIQUE INDEX "UsageMetric_organizationId_day_key" ON "UsageMetric"("organizationId", "day");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_organizationId_key" ON "Subscription"("organizationId");

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DriveConnection" ADD CONSTRAINT "DriveConnection_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Folder" ADD CONSTRAINT "Folder_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassificationProposal" ADD CONSTRAINT "ClassificationProposal_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassificationProposal" ADD CONSTRAINT "ClassificationProposal_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassificationRule" ADD CONSTRAINT "ClassificationRule_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleCondition" ADD CONSTRAINT "RuleCondition_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "ClassificationRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionHistory" ADD CONSTRAINT "ActionHistory_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionHistory" ADD CONSTRAINT "ActionHistory_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActionHistory" ADD CONSTRAINT "ActionHistory_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UsageMetric" ADD CONSTRAINT "UsageMetric_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
