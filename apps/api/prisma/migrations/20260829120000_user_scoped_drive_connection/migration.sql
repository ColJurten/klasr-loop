-- Legacy organization-scoped ownership cannot be inferred safely. Existing
-- encrypted tokens are retained with NULL userId and are intentionally
-- inaccessible; the next OAuth consent creates a user-owned row.
ALTER TABLE "DriveConnection" ADD COLUMN "userId" TEXT;

DROP INDEX "DriveConnection_organizationId_key";
CREATE INDEX "DriveConnection_organizationId_idx" ON "DriveConnection"("organizationId");
CREATE UNIQUE INDEX "DriveConnection_userId_key" ON "DriveConnection"("userId");

ALTER TABLE "DriveConnection" ADD CONSTRAINT "DriveConnection_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
