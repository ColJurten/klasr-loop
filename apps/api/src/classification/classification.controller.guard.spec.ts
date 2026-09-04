import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ClassificationController, DriveWorkflowController, SyncController } from './classification.controller';
import { DashboardController } from '../dashboard/dashboard.controller';
import { DocumentsController } from '../documents/documents.controller';
import { InternalServiceGuard } from '../auth/guards/internal-service.guard';
import { LlmSettingsController } from '../llm-settings/llm-settings.controller';
import { RulesController } from '../rules/rules.controller';
import { OrganizationsController } from '../organizations/organizations.controller';
import { AuthController } from '../auth/auth.controller';

describe('tenant-scoped controllers', () => {
  const controllers = [AuthController, ClassificationController, SyncController, DriveWorkflowController, DashboardController, DocumentsController, LlmSettingsController, RulesController, OrganizationsController];

  it('covers all nine guarded controllers', () => expect(controllers).toHaveLength(9));

  it.each(controllers)(
    'guards %p with InternalServiceGuard',
    (controller) => {
      const guards = Reflect.getMetadata(GUARDS_METADATA, controller) ?? [];
      expect(guards).toContain(InternalServiceGuard);
    },
  );
});
