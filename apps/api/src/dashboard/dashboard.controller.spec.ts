import { DashboardController } from './dashboard.controller';

describe('DashboardController', () => {
  const originalLocalMode = process.env.KLASR_LOCAL_MVP;

  afterEach(() => {
    if (originalLocalMode === undefined) delete process.env.KLASR_LOCAL_MVP;
    else process.env.KLASR_LOCAL_MVP = originalLocalMode;
    delete process.env.KLASR_ACCEPTANCE_GOOGLE_SERVICE_ACCOUNT;
  });

  it('labels service-account acceptance distinctly from production OAuth and local mode', async () => {
    process.env.KLASR_ACCEPTANCE_GOOGLE_SERVICE_ACCOUNT = 'true';
    const classification = { listPending: jest.fn().mockResolvedValue([]), listHistory: jest.fn().mockResolvedValue([]) };
    const connections = { findByUser: jest.fn().mockResolvedValue(null) };
    const metrics = { totals: jest.fn().mockResolvedValue({}) };
    const jobs = { queueState: jest.fn().mockResolvedValue({}), failedAnalysisCount: jest.fn().mockResolvedValue(2) };
    const folders = { getReferenceRoot: jest.fn().mockResolvedValue(null), listInherited: jest.fn().mockResolvedValue([]) };
    const sync = { listInputItems: jest.fn() };
    const controller = new DashboardController(classification as never, connections as never, metrics as never, jobs as never, folders as never, sync as never);
    const result = await controller.get('org_1', 'user_1');
    expect(result.mode).toBe('service-account-staging');
    expect(result.analysisFailures).toBe(2);
    expect(jobs.failedAnalysisCount).toHaveBeenCalledWith('org_1');
    expect(sync.listInputItems).not.toHaveBeenCalled();
  });

  it('renders production dashboard data without eagerly listing the full Drive', async () => {
    delete process.env.KLASR_LOCAL_MVP;
    const classification = { listPending: jest.fn().mockResolvedValue([]), listHistory: jest.fn().mockResolvedValue([]) };
    const connections = { findByUser: jest.fn().mockResolvedValue(null) };
    const metrics = { totals: jest.fn().mockResolvedValue({}) };
    const jobs = { queueState: jest.fn().mockResolvedValue({}), failedAnalysisCount: jest.fn().mockResolvedValue(0) };
    const folders = { getReferenceRoot: jest.fn().mockResolvedValue(null), listInherited: jest.fn().mockResolvedValue([]) };
    const sync = { listInputItems: jest.fn().mockRejectedValue(new Error('Drive provider unavailable')) };
    const controller = new DashboardController(classification as never, connections as never, metrics as never, jobs as never, folders as never, sync as never);

    await expect(controller.get('org_1', 'user_1')).resolves.toEqual(expect.objectContaining({ mode: 'production', inputItems: [] }));
    expect(sync.listInputItems).not.toHaveBeenCalled();
  });

  it('retains deterministic input listing in local mode', async () => {
    process.env.KLASR_LOCAL_MVP = 'true';
    const classification = { listPending: jest.fn().mockResolvedValue([]), listHistory: jest.fn().mockResolvedValue([]) };
    const connections = { findByUser: jest.fn().mockResolvedValue(null) };
    const metrics = { totals: jest.fn().mockResolvedValue({}) };
    const jobs = { queueState: jest.fn().mockResolvedValue({}), failedAnalysisCount: jest.fn().mockResolvedValue(0) };
    const folders = { getReferenceRoot: jest.fn().mockResolvedValue(null), listInherited: jest.fn().mockResolvedValue([]) };
    const inputItems = [{ externalId: 'local_input' }];
    const sync = { listInputItems: jest.fn().mockResolvedValue(inputItems) };
    const controller = new DashboardController(classification as never, connections as never, metrics as never, jobs as never, folders as never, sync as never);

    await expect(controller.get('org_1', 'user_1')).resolves.toEqual(expect.objectContaining({ mode: 'local', inputItems }));
    expect(sync.listInputItems).toHaveBeenCalledWith('org_1', 'user_1');
  });

  it('never relabels ordinary local behavior as production', async () => {
    process.env.KLASR_LOCAL_MVP = 'true';
    const classification = { listPending: jest.fn().mockResolvedValue([]), listHistory: jest.fn().mockResolvedValue([]) };
    const connections = { findByUser: jest.fn().mockResolvedValue(null) };
    const metrics = { totals: jest.fn().mockResolvedValue({}) };
    const jobs = { queueState: jest.fn().mockResolvedValue({}), failedAnalysisCount: jest.fn().mockResolvedValue(0) };
    const folders = { getReferenceRoot: jest.fn().mockResolvedValue(null), listInherited: jest.fn().mockResolvedValue([]) };
    const sync = { listInputItems: jest.fn().mockResolvedValue([]) };
    const controller = new DashboardController(classification as never, connections as never, metrics as never, jobs as never, folders as never, sync as never);

    await expect(controller.get('org_1', 'user_1')).resolves.toEqual(expect.objectContaining({ mode: 'local' }));
    expect(sync.listInputItems).toHaveBeenCalledWith('org_1', 'user_1');
  });
});
