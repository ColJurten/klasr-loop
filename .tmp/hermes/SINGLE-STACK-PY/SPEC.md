# SPEC — Single-stack Python backend + Next.js frontend (Klasr)

Task ID: SINGLE-STACK-PY. Branch: `hermes-oneshot` (working baseline; `main` is behind it — see below). Target final branch: `main` via the run's phase commits on a migration branch.

## Objective

One backend technology (Python/FastAPI), one frontend technology (Next.js, unchanged).
The NestJS backend is deleted. The document pipeline (CrewAI + Docling) is a module
`apps/api/src/dsa/` inside the single Python backend — no sidecar, no internal HTTP hop.

## Baseline / inventory (migration checklist)

Baseline = branch `hermes-oneshot` (superset of main; main is ~283 files behind).
Work happens on branch `hermes-oneshot` (or a child branch merged back per phase).

NestJS backend: `apps/api` — NestJS 11 modular monolith, Prisma/PostgreSQL, pg-boss 12.26.3, MongoDB driver (analyses only), NextAuth-adjacent auth.

### Routes to port with contract parity (from controllers)

| NestJS route | Method | Python target |
|---|---|---|
| /auth/onboarding, /auth/register, /auth/credentials | POST | apps/api/src/auth |
| /auth/local-password | GET, POST | apps/api/src/auth |
| /organizations, /organizations/:id | POST, GET | organizations |
| /organizations/:oid/dashboard | GET | organization/dashboard |
| /organizations/:oid/documents, /documents/:documentId | GET | documents |
| /organizations/:oid/drive/reference-folders | GET | drive |
| /organizations/:oid/drive/reference-root | POST | drive |
| /organizations/:oid/drive/input-items, /drive/items | GET | drive |
| /organizations/:oid/drive/launch | POST | drive/organization |
| /organizations/:oid/proposals | GET | organization |
| /organizations/:oid/proposals/:proposalId/confirm, /ignore | POST | organization |
| /organizations/:oid/sync | POST | drive/sync |
| /organizations/:oid/rules | GET, POST | organization |
| /organizations/:oid/llm-settings (+/models) | GET, PUT, POST, DELETE | core/llm-settings |
| /health | GET | core |

Route shapes, payloads, status codes, auth flow ported as-is. apps/web must keep working
with minimal documented changes (mostly base URL / fetch config). Any unavoidable contract
change must be listed in this SPEC with web-side impact.

### Domain pieces and REAC evidence

- Prisma schema: 14 models + 8 enums (Organization, LlmSetting, User, Membership, DriveConnection,
  Folder, Document, ClassificationProposal, ClassificationRule, RuleCondition,
  ActionHistory, Notification, UsageMetric, Subscription + enums). REAC C7/C8 (SQL).
- MongoDB `analyses` collection, TTL-purged, metadata only — REAC C8 NoSQL. Now via motor/pymongo.
- pg-boss queue `analysis` (retryLimit 2, singletonKey org:doc), job states observed via
  pgboss.job — replaced by a Python PostgreSQL-backed job mechanism (see ADR decision:
  APScheduler with SQLAlchemyJobStore or a minimal SKIP LOCKED table; decision recorded in ADR).
- Google Drive: drive-connections, google-token (encrypted refresh), google-drive.executor,
  local-drive.executor — reimplemented with google-api-python-client / google-auth. Token
  storage/refresh/scopes/revocation equivalent. No credential reaches dsa/.
- Analysis pipeline (TS: apps/api/src/analysis — agents/config YAML/crews/extraction/llm/schemas)
  replaced by dsa/ CrewAI+Docling module.
- Auth: NextAuth on web side stays; API side ports auth controller semantics.
- Tests: 24 Jest spec files ported to pytest (coverage at least equivalent) + new dsa/ suite.

## Queue replacement decision (recorded in ADR)

pg-boss is Node-only. Replacement: **PostgreSQL-backed Python jobs with a
`SKIP LOCKED` polling worker** (single table `jobs`, stdlib+SQLAlchemy only, no new
dependency/broker) OR APScheduler SQLAlchemyJobStore — final choice and semantics
(retries: retryLimit 2 preserved; singleton dedupe via unique key; observability endpoint
matching queueState/failedAnalysisCount) recorded in the ADR. Queue stays on the existing
PostgreSQL instance. No Redis, no broker.

## dsa/ module shape (from Foxon-Consulting/dsa_backend, defects fixed)

- config/agents.yaml: analyse_file_agent (holds Docling tools), suggest_filename_agent,
  suggest_directory_agent (forbidden from inventing directories).
- config/tasks.yaml: three tasks, single bound agent each.
- crews.py: @CrewBase DocumentSortingAssistantCrew, two sequential crews
  (analysis→naming, analysis→destination); decision agents never touch file bytes.
- tools.py: DoclingMarkdownTool, DoclingTextTool as BaseTool with Pydantic args_schema;
  PDF, PNG, JPG/JPEG, TIFF, GIF, BMP.
- __init__.py public surface: suggest_filename(file), suggest_directory(file, directories),
  suggest(file, directories) — one extraction + one analysis pass returning BOTH filename
  and destination (used by organization flow). Single-purpose functions stay for CLI parity.
- schemas.py: validated Pydantic results with value, confidence, signals, warnings.
- CLI: suggest_filename -f, suggest_directory -f -d.
- Reference defects fixed: no output_file task logs; validated Pydantic not raw strings;
  directories passed as form field/JSON part; full nested paths; verbose off (env-controlled,
  never in containers); real tests with stub LLM; CrewAI telemetry explicitly disabled
  (CREWAI_DISABLE_TELEMETRY / crew telemetry=False).
- Temp files: NamedTemporaryFile, deleted in finally.
- Model config: KLASR_LLM_PROVIDER, KLASR_LLM_MODEL, KLASR_LLM_API_KEY, KLASR_LLM_BASE_URL,
  optional per-agent overrides. No hardcoded model names. Tests use deterministic stub LLM.

## Phase plan (commit per phase; stop at a working boundary)

- Phase 0 — ADR in docs/ARCHITECTURE.md (French, jury-facing). No code before it exists.
- Phase 1 — apps/api FastAPI skeleton + dsa/ + SQLAlchemy/Alembic matching existing schema
  (initial revision = current schema, no drops) + Mongo analyses + jobs mechanism + pytest suite.
- Phase 2 — domain port: auth, drive, organization/review, jobs wiring; contract parity.
- Phase 3 — cutover: web → Python API, delete NestJS, docker-compose, CI, README.
- Phase 4 — suggestion quality (extraction tuning, grounding, confidence).

## Scope out

API surface redesign, landing page, auth UI redesign, dashboard layout, scripts/agent,
any new datastore/broker/cache/object store, Next.js version change.

## Acceptance criteria

See goal text (22 criteria + checks). Key: NestJS deleted not dormant; Alembic matches
existing schema with no data loss; every pipeline response is a validated Pydantic object;
provider env-configurable; tests against stub LLM; destinations validated against inherited
tree (fail closed); nothing renamed/moved without explicit validation; no raw content
persisted anywhere; telemetry off; CI green; docs map every REAC competency; README full
local setup; browser visual verification.

## Checks

Python: pip install from pinned pyproject.toml; alembic upgrade head (fresh DB); pytest;
black --check; flake8; container build.
Web/agent: pnpm install/lint/typecheck/test/build (Vitest web, node:test agent).
Integration: docker compose up; CLI on synthetic fixtures; actionlint on touched workflows;
browser visual verification of OCR review flow.

## REAC mapping (to be completed in ADR/docs)

C1-C2: cadrage, ADR; C3: maquettage/UI unchanged; C4/C5: web app + API dev (FastAPI);
C6: tests (pytest/Vitest); C7/C8: PostgreSQL (SQLAlchemy/Alembic) + MongoDB TTL;
C9: déploiement docker/CI; C10/C11: veille/qualité, doc jury.
