UPDATE "Document"
SET "status" = 'IGNORED'
WHERE "id" IN (
  SELECT "documentId"
  FROM "ClassificationProposal"
  WHERE "status" = 'REJECTED'
);

UPDATE "ClassificationProposal"
SET
  "status" = 'IGNORED',
  "finalName" = NULL,
  "finalDestinationPath" = NULL,
  "finalDestinationFolderExternalId" = NULL
WHERE "status" = 'REJECTED';

UPDATE "ClassificationProposal"
SET "status" = 'PENDING'
WHERE "status" = 'REJECTING';

UPDATE "ActionHistory"
SET
  "action" = 'IGNORED',
  "toName" = NULL,
  "toPath" = NULL
WHERE "action" = 'REJECT';

ALTER TABLE "Folder" DROP COLUMN "holding";
