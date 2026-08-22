import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class LlmSettingsRepository {
  constructor(private readonly prisma: PrismaService) {}
  find(organizationId: string) { return this.prisma.llmSetting.findUnique({ where: { organizationId } }); }
  upsert(organizationId: string, data: { provider: string; model: string; baseUrl: string; encryptedApiKey: string; status: string; validatedAt: Date }) {
    return this.prisma.llmSetting.upsert({ where: { organizationId }, create: { organizationId, ...data }, update: data });
  }
  async delete(organizationId: string): Promise<void> { await this.prisma.llmSetting.deleteMany({ where: { organizationId } }); }
}
