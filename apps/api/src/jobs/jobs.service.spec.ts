import { ConfigService } from '@nestjs/config';
import { JobsService } from './jobs.service';

const start = jest.fn();
const stop = jest.fn();
const send = jest.fn();
const work = jest.fn();
const getQueue = jest.fn();
const createQueue = jest.fn();
const queryRaw = jest.fn();
const prisma = { $queryRaw: queryRaw };

jest.mock('pg-boss', () => ({
  PgBoss: jest.fn().mockImplementation(() => ({ start, stop, send, work, getQueue, createQueue, on: jest.fn() })),
}));

describe('JobsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.KLASR_INLINE_WORKER = 'true';
    process.env.NODE_ENV = 'test';
    start.mockResolvedValue(undefined);
    stop.mockResolvedValue(undefined);
    send.mockResolvedValue('job_1');
    work.mockResolvedValue('worker_1');
    createQueue.mockResolvedValue(undefined);
    getQueue.mockResolvedValue({
      queuedCount: 3,
      readyCount: 2,
      activeCount: 1,
      failedCount: 0,
    });
    queryRaw.mockResolvedValue([{ count: 0n }]);
  });

  afterEach(() => {
    delete process.env.KLASR_INLINE_WORKER;
  });

  it('registers an analysis worker that consumes pg-boss jobs', async () => {
    const service = new JobsService({ get: () => 'postgres://local' } as unknown as ConfigService, prisma as never);
    const handler = jest.fn().mockResolvedValue(undefined);

    service.registerAnalysisHandler(handler);
    await service.onModuleInit();

    expect(work).toHaveBeenCalledWith(
      'analysis',
      expect.objectContaining({ batchSize: 1 }),
      expect.any(Function),
    );
    const worker = work.mock.calls[0][2] as (jobs: Array<{ data: unknown }>) => Promise<void>;
    await worker([{ data: { organizationId: 'org_1', documentId: 'doc_1' } }]);
    expect(handler).toHaveBeenCalledWith({ organizationId: 'org_1', documentId: 'doc_1' });
  });

  it('reports real queue state from pg-boss', async () => {
    const service = new JobsService({ get: () => 'postgres://local' } as unknown as ConfigService, prisma as never);

    await service.onModuleInit();

    await expect(service.queueState()).resolves.toEqual({
      queued: 3,
      ready: 2,
      active: 1,
      failed: 0,
      inlineWorker: true,
      consuming: false,
    });
  });

  it('queries prompt failed-job state for only the requested tenant', async () => {
    queryRaw.mockResolvedValueOnce([{ count: 2n }]).mockResolvedValueOnce([{ count: 0n }]);
    const service = new JobsService({ get: () => undefined } as unknown as ConfigService, prisma as never);
    await expect(service.failedAnalysisCount('org_failed')).resolves.toBe(2);
    await expect(service.failedAnalysisCount('org_other')).resolves.toBe(0);
    expect(queryRaw.mock.calls[0][0].values).toContain('org_failed');
    expect(queryRaw.mock.calls[1][0].values).toContain('org_other');
  });
});
