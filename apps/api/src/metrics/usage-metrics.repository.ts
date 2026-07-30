import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type MetricKey = 'documentsIn' | 'ruleMatches' | 'llmCalls' | 'ocrRuns';

@Injectable()
export class UsageMetricsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async increment(organizationId: string, deltas: Partial<Record<MetricKey, number>>): Promise<void> {
    const day = new Date();
    day.setUTCHours(0, 0, 0, 0);
    await this.prisma.usageMetric.upsert({
      where: { organizationId_day: { organizationId, day } },
      create: {
        organizationId,
        day,
        documentsIn: deltas.documentsIn ?? 0,
        ruleMatches: deltas.ruleMatches ?? 0,
        llmCalls: deltas.llmCalls ?? 0,
        ocrRuns: deltas.ocrRuns ?? 0,
      },
      update: {
        documentsIn: { increment: deltas.documentsIn ?? 0 },
        ruleMatches: { increment: deltas.ruleMatches ?? 0 },
        llmCalls: { increment: deltas.llmCalls ?? 0 },
        ocrRuns: { increment: deltas.ocrRuns ?? 0 },
      },
    });
  }

  async totals(organizationId: string): Promise<{
    pending: number;
    analyzing: number;
    classified: number;
    documentsIn: number;
    ruleMatches: number;
    llmCalls: number;
    ocrRuns: number;
  }> {
    const [pending, analyzing, classified, metrics] = await Promise.all([
      this.prisma.classificationProposal.count({ where: { organizationId, status: 'PENDING' } }),
      this.prisma.document.count({ where: { organizationId, status: 'PENDING' } }),
      this.prisma.document.count({ where: { organizationId, status: 'CLASSIFIED' } }),
      this.prisma.usageMetric.aggregate({
        where: { organizationId },
        _sum: { documentsIn: true, ruleMatches: true, llmCalls: true, ocrRuns: true },
      }),
    ]);
    return {
      pending,
      analyzing,
      classified,
      documentsIn: metrics._sum.documentsIn ?? 0,
      ruleMatches: metrics._sum.ruleMatches ?? 0,
      llmCalls: metrics._sum.llmCalls ?? 0,
      ocrRuns: metrics._sum.ocrRuns ?? 0,
    };
  }
}
