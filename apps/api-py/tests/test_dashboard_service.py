from types import SimpleNamespace

import pytest

from services.dashboard import DashboardService


@pytest.mark.asyncio
async def test_dashboard_reads_queue_before_metrics():
    calls = []
    service = DashboardService.__new__(DashboardService)
    service.connections = SimpleNamespace(find=lambda *_: None)
    service.jobs = SimpleNamespace(
        queue_state=lambda *_: calls.append("queue") or {"ready": 1},
        failed_analysis_count=lambda *_: 0,
    )
    service.metrics = SimpleNamespace(
        totals=lambda *_: calls.append("metrics") or {"documentsIn": 1}
    )
    service.folders = SimpleNamespace(root=lambda *_: None, inherited=lambda *_: [])
    service.proposals = SimpleNamespace(list=lambda *_, **__: [])
    service.settings = SimpleNamespace(acceptance_google_service_account=False)

    payload = await service.get("organization", "user")

    assert calls == ["queue", "metrics"]
    assert payload["queue"] == {"ready": 1}
    assert payload["metrics"] == {"documentsIn": 1}
