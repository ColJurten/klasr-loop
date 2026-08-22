CREATE TABLE "LlmSetting" (
  "id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "baseUrl" TEXT NOT NULL,
  "encryptedApiKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'VALID',
  "validatedAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "organizationId" TEXT NOT NULL,
  CONSTRAINT "LlmSetting_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LlmSetting_organizationId_key" ON "LlmSetting"("organizationId");
ALTER TABLE "LlmSetting" ADD CONSTRAINT "LlmSetting_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
