---
name: backend-conventions
description: FastAPI + SQLAlchemy + PostgreSQL jobs + MongoDB conventions for apps/api-py. Use whenever writing or reviewing backend code.
---
# Backend Conventions (`apps/api-py`, ADR-007)

## Layering (jury-legible, REAC C6)
- Router (HTTP and Pydantic validation only) → Service (business logic) → Repository (data access). Keep SQLAlchemy and Mongo drivers out of routers.
- Keep response shapes explicit; never expose ORM objects directly.

## Data access (REAC C7 + C8)
- PostgreSQL via SQLAlchemy is the source of truth; Alembic owns migrations.
- MongoDB is ONE metadata-only TTL collection accessed through `src/mongo/analyses.py`. Do not add collections or document content without an ADR.
- Multi-tenancy (blocking rule): every repository method takes organizationId; Mongo queries and job payloads are organizationId-scoped too.

## Classification pipeline (REAC C3, business components)
- Location: `src/services/analysis.py`, `src/services/classification.py`, and `src/dsa`.
- Order is fixed: user rules by ascending priority → local heuristic → external LLM (cheapest first). A confident rule match makes ZERO LLM calls; `llmCallsUsed` is instrumentation, keep it accurate.
- Document text is UNTRUSTED input: prompts delimit it; the model may only pick destinations from the provided folder list — validate that in code, never trust the response.
- Vendor APIs stay in services; credentials never enter `src/dsa`.

## Async jobs (ADR-004)
- The PostgreSQL `jobs` table is consumed with `FOR UPDATE SKIP LOCKED`; payloads carry organizationId and are idempotent. Do not introduce another broker without an ADR.

## Errors & logging
- Domain exceptions are mapped by FastAPI handlers. Never leak internals.
- NEVER log document content; filenames at debug level only.

## Testing (REAC C9)
- pytest covers services, repositories, routes, and the pipeline.
- A tenant-isolation test is mandatory for every new repository.
- Keep PostgreSQL integration and Playwright E2E paths runnable from root scripts.
