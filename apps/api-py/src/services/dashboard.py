from repositories.drive_connections import DriveConnectionsRepository
from repositories.folders import FoldersRepository
from repositories.proposals import ProposalsRepository
from repositories.usage_metrics import UsageMetricsRepository
from repositories.serialization import serialize


class DashboardService:
    def __init__(self, session, settings, jobs, sync):
        self.connections = DriveConnectionsRepository(session)
        self.folders = FoldersRepository(session)
        self.proposals = ProposalsRepository(session)
        self.metrics = UsageMetricsRepository(session)
        self.settings, self.jobs, self.sync = settings, jobs, sync

    async def get(self, organization_id, user_id):
        connection = self.connections.find(organization_id, user_id)
        # Read queue first: a job landing between the two reads must not be hidden
        # behind earlier metrics (drive-workflow declares done only when the queue is empty).
        queue = self.jobs.queue_state(organization_id)
        metrics = self.metrics.totals(organization_id)
        return serialize(
            dict(
                mode=(
                    "local"
                    if self.settings.local_mvp
                    else (
                        "service-account-staging"
                        if self.settings.acceptance_google_service_account
                        else "production"
                    )
                ),
                connection=(
                    dict(
                        provider=connection.provider,
                        connectedAt=connection.connected_at,
                        lastSyncAt=connection.last_sync_at,
                    )
                    if connection
                    else None
                ),
                metrics=metrics,
                queue=queue,
                analysisFailures=self.jobs.failed_analysis_count(organization_id),
                referenceRoot=self.folders.root(organization_id),
                folders=self.folders.inherited(organization_id),
                inputItems=(
                    await self.sync.input_items(organization_id, user_id)
                    if self.settings.local_mvp
                    else []
                ),
                proposals=self.proposals.list(organization_id),
                history=self.proposals.list(organization_id, history=True),
            )
        )
