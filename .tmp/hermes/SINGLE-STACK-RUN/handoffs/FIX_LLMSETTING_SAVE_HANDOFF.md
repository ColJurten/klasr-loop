# LlmSetting save fix handoff

## Migration

- Added `20260927_0003_llm_settings_updated_at_default.py` after `20260913_0002`.
- PostgreSQL upgrade sets `"LlmSetting"."updatedAt"` to `DEFAULT now()` without changing `NOT NULL`, recreating the table, or touching its data.
- Downgrade removes only that default. Non-PostgreSQL test databases are a no-op because the adoption revision already creates the model default and SQLite cannot alter it in place.

## Error path

- `mapped()` now converts only known provider `ValueError` codes to the existing HTTP 400 contract; unknown exceptions propagate to the normal HTTP 500 handler.
- `save()` limits provider mapping to endpoint/validation. Encryption and repository work run separately, log failures, and re-raise them as internal errors.
- Provider validation behavior itself is unchanged.

## Regression coverage

- PostgreSQL scratch-database regression upgrades to the pre-fix revision, removes the `updatedAt` default to simulate an adopted Prisma schema, upgrades to head, and performs an authenticated save with a fully stubbed provider.
- The same test recreates the scratch database, verifies `upgrade head` from empty, downgrades the new revision, and drops the database.
- Persistence-failure regression asserts a repository failure is logged and returned as the normal 500 contract, never `endpoint_unavailable`.
- No staging database, provider credential, real provider request, harness, web app, npm, or pnpm path was touched.

## Verification

From `apps/api-py`:

```text
./.venv/bin/python -m pytest -q
88 passed, 251 warnings in 53.74s

./.venv/bin/black --check src tests alembic
All done! ✨ 🍰 ✨
61 files would be left unchanged.

./.venv/bin/flake8 src tests alembic
(no output; exit 0)
```
