# Task B reviewer fixes

- `2642d5f test: make auth e2e focus assertion real` verifies Tab moves focus outside the login card instead of matching text on `body`.
- `chore: drop dead "all" sync alias` removes the stale Drive selection heuristic and updates backend setup to launch the explicit `inbox` item.

Verification:

- `apps/api-py/.venv/bin/black --check src tests alembic`
- `apps/api-py/.venv/bin/flake8 src tests alembic`
- `apps/api-py/.venv/bin/pytest -q tests/test_routes.py tests/test_security_providers.py tests/test_api_db.py` — 27 passed
- `apps/web: pnpm typecheck`
- `apps/web: pnpm test` — 18 files, 130 tests passed

Full pytest collection was not run because the local Python 3.14 environment has the known crewai/chromadb collection incompatibility; the requested focused backend suite passed.
