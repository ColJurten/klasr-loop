/**
 * Port for executing the physical move/rename in the connected Drive.
 * Adapters: GoogleDriveExecutor, OneDriveExecutor (backlog). The service layer
 * depends only on this interface — jury-visible hexagonal boundary.
 */
export const DRIVE_EXECUTOR = Symbol('DRIVE_EXECUTOR');

export interface MoveRenameCommand {
  organizationId: string;
  userId?: string;
  documentExternalId: string;
  newName: string;
  destinationPath?: string;
  destinationFolderExternalId?: string;
  rename?: boolean;
}

export interface DriveExecutor {
  moveAndRename(command: MoveRenameCommand): Promise<void>;
}
