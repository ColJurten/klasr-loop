---
name: klasr-product
description: Klasr domain knowledge — product vision, personas, data flows, eco-design rules, REAC/jury constraints. Use when planning, reviewing, or making any product or architecture decision.
---
# Klasr — Product & Domain Knowledge

## What Klasr does
Connects to a user's Drive (Google Drive / OneDrive — one Drive per organization),
watches incoming documents, runs OCR + LLM analysis, proposes filename + destination
folder within the user's own arborescence, and executes the rename/move after a
single-click confirmation. It executes — it does not merely suggest.

## Personas
- Expert-comptable (primary): classifies pièces comptables for many clients; needs precision, audit trail, RGPD.
- Regulated professions (lawyers): confidentiality above all.
- Freelancers / small businesses: simplicity, low cost.

## Core flow (never break it)
1. User connects Drive (OAuth) and Klasr syncs the FOLDER STRUCTURE ONLY (hybrid model — files stay in the Drive).
2. New document → bytes streamed from the Drive API (no storage at rest) → pre-filter (rules/metadata) → if needed, OCR (Tesseract) → LLM classification through the abstraction layer. Raw analysis payloads go to the Mongo `analyses` collection, TTL-purged.
3. Proposal shown (filename + destination) → user confirms in ONE click → Klasr executes move/rename via Drive API → history entry.
4. User-defined rules apply sequentially by priority, before the LLM (pre-filter).

## Eco-design commitments (must survive every refactor)
- LLM cascade: cheapest capable model first.
- Pre-filtering to skip unnecessary LLM calls.
- TTL-based purge of analysis payloads (Mongo); no file ever stored at rest.
- LLM abstraction allowing a local-model fallback.

## Jury / REAC constraints
This project is evaluated against the REAC (CDA, RNCP 6). Decisions should be
demonstrable competencies: layered NestJS architecture, documented data model
(12 entities), CI/CD, tests, security. When a change demonstrates a competency,
record it in docs/STATE.md → "REAC coverage".
