# Handoff — Phase 0 / ADR

## Mode

- Codex : session interactive (pas de `/goal` persistant ni de fallback `codex exec`).

## Fichiers modifiés

- `docs/ARCHITECTURE.md` : architecture cible FastAPI/Python, état de migration et ADR-007.
- `.tmp/hermes/SINGLE-STACK-PY/PHASE0_HANDOFF.md` : présent handoff temporaire, versionné exceptionnellement pour ce correctif demandé.

## Correctif après revue

- Revue Claude Opus `BLOCKED` traitée : sémantique réelle de retry et singleton
  pg-boss, bail/reaper, six champs d'observation, compte exact de 14 modèles et
  8 enums, conséquence du rollback sur `analysisFailures` et preuve C5 corrigés.
- `.tmp/hermes/SINGLE-STACK-PY/SPEC.md` aligne également le compte du schéma.

## Commandes exécutées

- Lecture de `../AGENTS.md`, `.tmp/hermes/SINGLE-STACK-PY/SPEC.md`, `docs/ARCHITECTURE.md` et du skill Ponytail.
- Inspection avec `git status`, `git log`, `rg` et `sed` du schéma Prisma, de la file pg-boss et des chemins Google OAuth/Drive.
- `git diff --check`
- `git diff -- docs/ARCHITECTURE.md`
- `git status --short`
- Contrôles ciblés `test`/`rg` sur le handoff et les clauses obligatoires de l'ADR.
- `git commit -m "docs: record Python backend migration ADR"`
- `git status --short --branch` et `git log -1 --oneline`

## Vérifications

- `git diff --check` : réussi.
- Relecture du diff documentaire : diagramme cible, décision de stack, file SQL, migration Alembic, rollback, OAuth/Drive et cartographie C1–C11 présents.
- Aucun fichier applicatif sous `apps/` modifié ; aucune phase ultérieure commencée.
- Commit de phase créé : `1161810 docs: record Python backend migration ADR`.
- Vérification UI : non applicable, aucun écran ni design system modifié.
- Invariant « les fichiers ne quittent jamais le Drive » : inchangé ; l'ADR maintient le flux éphémère vers `dsa/`, sans persistance de contenu, et exclut les credentials de `dsa/`.
- REAC : C1 à C11 cartographiées de l'emplacement actuel vers la cible.

## Compromis connus

- L'ADR décrit la cible ; NestJS/Prisma/pg-boss reste volontairement la baseline exécutable jusqu'à la phase 3.
- Le handoff et la SPEC sous `.tmp/` sont versionnés exceptionnellement dans le commit de correctif demandé.
- Les suites pnpm et la vérification visuelle ne sont pas relancées pour ce changement exclusivement Markdown.
