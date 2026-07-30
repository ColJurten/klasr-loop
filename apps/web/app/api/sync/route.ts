import { NextResponse } from 'next/server';
import { getDashboardData, startSync } from '@/lib/api';
import { bffErrorResponse } from '@/lib/bff-errors';

export async function POST() {
  try {
    const result = await startSync();
    await waitForDashboardRefreshableState(result.enqueued);
    return NextResponse.json(result);
  } catch (error) {
    return bffErrorResponse(error, 'sync failed');
  }
}

async function waitForDashboardRefreshableState(enqueued: number): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const dashboard = await getDashboardData();
    if (dashboard.proposals.length > 0) {
      return;
    }
    if (enqueued === 0 && dashboard.queue.queued === 0 && dashboard.queue.active === 0 && dashboard.queue.ready === 0) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}
