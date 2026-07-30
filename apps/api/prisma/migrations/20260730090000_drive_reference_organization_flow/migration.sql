ALTER TABLE "Organization"
  ADD COLUMN "referenceRootExternalId" TEXT,
  ADD COLUMN "referenceRootName" TEXT;

ALTER TABLE "Folder"
  ADD COLUMN "inherited" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "holding" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "ClassificationProposal"
  ADD COLUMN "destinationFolderExternalId" TEXT,
  ADD COLUMN "finalName" TEXT,
  ADD COLUMN "finalDestinationPath" TEXT,
  ADD COLUMN "finalDestinationFolderExternalId" TEXT;
