import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ClassificationController } from './classification.controller';
import { DocumentsController } from '../documents/documents.controller';
import { InternalServiceGuard } from '../auth/guards/internal-service.guard';
import { RulesController } from '../rules/rules.controller';

describe('tenant-scoped controllers', () => {
  it.each([ClassificationController, DocumentsController, RulesController])(
    'guards %p with InternalServiceGuard',
    (controller) => {
      const guards = Reflect.getMetadata(GUARDS_METADATA, controller) ?? [];
      expect(guards).toContain(InternalServiceGuard);
      expect(new Reflector()).toBeDefined();
    },
  );
});
