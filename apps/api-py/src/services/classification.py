from fastapi import HTTPException
from repositories.proposals import ProposalsRepository
from repositories.folders import FoldersRepository


def validate_filename(value):
    name = value.strip()
    if (
        not name
        or name in (".", "..")
        or "/" in name
        or "\\" in name
        or ".." in name
        or any(ord(c) < 32 or ord(c) == 127 for c in name)
    ):
        raise HTTPException(400, "Invalid filename")
    return name


class ClassificationService:
    def __init__(self, session, drive):
        self.proposals = ProposalsRepository(session)
        self.folders = FoldersRepository(session)
        self.drive = drive

    def list(self, organization_id):
        return self.proposals.list(organization_id)

    async def confirm(self, organization_id, proposal_id, dto, actor_id=""):
        claimed = self.proposals.claim(organization_id, proposal_id, "CONFIRMING")
        if not claimed:
            raise HTTPException(409, "Pending proposal not found or already decided")
        proposal, document = claimed
        try:
            name = validate_filename(
                dto.finalName if dto.finalName is not None else proposal.proposed_name
            )
            if dto.destinationFolderExternalId:
                destination = self.folders.find(
                    organization_id, external_id=dto.destinationFolderExternalId
                )
            elif dto.overrideDestinationPath:
                destination = self.folders.find(organization_id, path=dto.overrideDestinationPath)
            elif proposal.destination_folder_external_id:
                destination = self.folders.find(
                    organization_id, external_id=proposal.destination_folder_external_id
                )
            else:
                destination = self.folders.find(organization_id, path=proposal.destination_path)
            if not destination or not destination.inherited:
                raise HTTPException(
                    400, "Destination folder must belong to the inherited reference tree"
                )
            await self.drive.move_and_rename(
                dict(
                    organizationId=organization_id,
                    userId=actor_id,
                    documentExternalId=document.external_id,
                    newName=name,
                    destinationPath=destination.path,
                    destinationFolderExternalId=destination.external_id,
                )
            )
            self.proposals.decide(
                organization_id,
                proposal_id,
                document.id,
                document.name,
                destination=destination,
                name=name,
                corrected=name != proposal.proposed_name
                or destination.path != proposal.destination_path,
                actor_id=actor_id or None,
            )
            return dict(executed=True, destinationPath=destination.path)
        except Exception:
            self.proposals.restore(organization_id, proposal_id, "CONFIRMING")
            raise

    def ignore(self, organization_id, proposal_id):
        claimed = self.proposals.claim(organization_id, proposal_id, "IGNORING")
        if not claimed:
            raise HTTPException(409, "Pending proposal not found or already decided")
        _, document = claimed
        try:
            self.proposals.decide(organization_id, proposal_id, document.id, document.name)
            return {"ignored": True}
        except Exception:
            self.proposals.restore(organization_id, proposal_id, "IGNORING")
            raise
