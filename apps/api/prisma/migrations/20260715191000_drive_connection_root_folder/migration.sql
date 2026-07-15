-- AlterTable
ALTER TABLE "DriveConnection" ADD COLUMN     "rootFolderId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "DriveConnection_rootFolderId_key" ON "DriveConnection"("rootFolderId");

-- AddForeignKey
ALTER TABLE "DriveConnection" ADD CONSTRAINT "DriveConnection_rootFolderId_fkey" FOREIGN KEY ("rootFolderId") REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;
