import { Injectable, Logger } from '@nestjs/common';
import { DriveExecutor, MoveRenameCommand } from './drive-executor.port';

@Injectable()
export class NoopDriveExecutor implements DriveExecutor {
  private readonly logger = new Logger(NoopDriveExecutor.name);

  async moveAndRename(command: MoveRenameCommand): Promise<void> {
    // Filenames at debug level only; never log document content (RGPD invariant).
    this.logger.debug(
      `noop move/rename doc=${command.documentExternalId} -> ${command.destinationPath}`,
    );
  }
}
