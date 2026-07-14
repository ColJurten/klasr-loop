---
name: backend-conventions
description: NestJS + Prisma + pg-boss + MongoDB conventions and multi-tenant rules for apps/api, including the classification pipeline. Use whenever writing or reviewing backend code.
---
# Backend Conventions (apps/api — TypeScript only, ADR-001)

## Layering (jury-legible, REAC C6)
- Controller (HTTP only, DTO validation via class-validator) → Service (business logic) → Repository (all data access). No Prisma client or Mongo driver outside repositories. No business logic in controllers.
- One module per bounded context: auth, organizations, drive, documents, rules, classification, analyses, history.
- Never return Prisma models directly from controllers — map to response DTOs.

## Data access (REAC C7 + C8)
- PostgreSQL via Prisma = single source of truth (12 entities).
- MongoDB is ONE collection (`analyses`) accessed ONLY through `src/analyses/analyses.repository.ts` — variable-schema OCR/LLM payloads, TTL index (RGPD/eco). Do not add collections without an ADR.
- Multi-tenancy (blocking rule): every repository method takes organizationId; Mongo queries and job payloads are organizationId-scoped too.

## Classification pipeline (REAC C3, business components)
- Location: `src/classification/pipeline` (rule pre-filter) and `src/classification/llm` (provider abstraction, local heuristic, external providers, cascade).
- Order is fixed: user rules by ascending priority → local heuristic → external LLM (cheapest first). A confident rule match makes ZERO LLM calls; `llmCallsUsed` is instrumentation, keep it accurate.
- Document text is UNTRUSTED input: prompts delimit it; the model may only pick destinations from the provided folder list — validate that in code, never trust the response.
- Vendor APIs are called over HTTPS inside `src/classification/llm` only.

## Async jobs (ADR-004)
- pg-boss on PostgreSQL, worker process from the same codebase. Job payloads carry organizationId and are idempotent. Do not introduce Redis/BullMQ without an ADR.

## Errors & logging
- Domain exceptions mapped to HTTP by a global filter. Never leak internals.
- NEVER log document content; filenames at debug level only.

## Testing (REAC C9)
- Jest unit tests per service/repository/pipeline stage (mock the data layer).
- A tenant-isolation test is mandatory for every new repository.
- E2E happy path per module against dockerized Postgres (supertest).
