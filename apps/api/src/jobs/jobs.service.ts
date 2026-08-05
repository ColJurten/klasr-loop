import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface AnalysisJob {
  organizationId: string;
  documentId: string;
}

type PgBossInstance = import('pg-boss').PgBoss;
type PgBossJob<T> = import('pg-boss').Job<T>;
type AnalysisHandler = (job: AnalysisJob) => Promise<void>;

@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private boss: PgBossInstance | null = null;
  private workerId: string | null = null;
  private analysisHandler: AnalysisHandler | null = null;
  private readonly inline = process.env.KLASR_INLINE_WORKER === 'true';
  private readonly workerProcess = process.env.KLASR_WORKER === 'true';

  constructor(private readonly config: ConfigService, private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    if (process.env.NODE_ENV === 'production' && this.inline) {
      throw new Error('KLASR_INLINE_WORKER cannot run in production');
    }
    const connectionString = this.config.get<string>('DATABASE_URL');
    if (!connectionString) return;
    const { PgBoss } = await import('pg-boss');
    this.boss = new PgBoss({ connectionString });
    this.boss.on('error', (error) => {
      // pg-boss emits operational queue errors through EventEmitter; registering
      // a listener prevents Node from treating them as unhandled process errors.
      this.logger.error(error);
    });
    await this.boss.start();
    await this.boss.createQueue('analysis', { retryLimit: 2 });
    await this.startAnalysisWorkerIfEnabled();
  }

  async enqueueAnalysis(job: AnalysisJob): Promise<void> {
    await this.boss?.send(
      'analysis',
      job,
      { singletonKey: `${job.organizationId}:${job.documentId}`, retryLimit: 2 },
    );
  }

  registerAnalysisHandler(handler: AnalysisHandler): void {
    this.analysisHandler = handler;
    void this.startAnalysisWorkerIfEnabled();
  }

  async queueState(): Promise<{
    queued: number;
    ready: number;
    active: number;
    failed: number;
    inlineWorker: boolean;
    consuming: boolean;
  }> {
    const queue = await this.boss?.getQueue('analysis');
    return {
      queued: queue?.queuedCount ?? 0,
      ready: queue?.readyCount ?? 0,
      active: queue?.activeCount ?? 0,
      failed: queue?.failedCount ?? 0,
      inlineWorker: this.inline,
      consuming: this.workerId !== null,
    };
  }

  async failedAnalysisCount(organizationId: string): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(*)::bigint AS count
      FROM pgboss.job
      WHERE name = 'analysis' AND state = 'failed' AND data->>'organizationId' = ${organizationId}
    `);
    return Number(rows[0]?.count ?? 0);
  }

  async waitForAnalysisIdle(timeoutMs = 10_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const state = await this.queueState();
      if (state.ready === 0 && state.queued === 0 && state.active === 0) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error('Analysis queue did not become idle before timeout');
  }

  async onModuleDestroy(): Promise<void> {
    await this.boss?.stop();
  }

  private async startAnalysisWorkerIfEnabled(): Promise<void> {
    if (!this.boss || !this.analysisHandler || this.workerId) return;
    if (!this.inline && !this.workerProcess) return;
    this.workerId = await this.boss.work<AnalysisJob>(
      'analysis',
      { batchSize: 1, pollingIntervalSeconds: 1 },
      async (jobs: PgBossJob<AnalysisJob>[]) => {
        for (const job of jobs) {
          await this.analysisHandler?.(job.data);
        }
      },
    );
  }
}
