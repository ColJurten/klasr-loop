ALTER TABLE "ClassificationProposal"
  ADD COLUMN "filenameConfidence" DOUBLE PRECISION,
  ADD COLUMN "destinationConfidence" DOUBLE PRECISION,
  ADD COLUMN "reviewRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "reviewReason" TEXT;
