# Handoff builder — reviewer batch R5 (reprise cron 2026-10-08)

- Mode : cron HERMES (continuation mission `fix-reviewer-batch-r5`) — gate codex OK, pas de limite d'usage.
- Contexte réel constaté : le batch R5 avait été committé et poussé (b97ced0 fix M1/M2, 0f57c62 chore lows 3-4, 4130b9a docs sur `origin/backend-python-refacto`), puis fusionné localement (merge PR #22, c3ba8ff, local-only). Les refactors cards 1-4 (7386cca / 569bdf4 / 348f777 / 0992ffc) sur `hermes/card-3-scanned-pdf` ont RÉGRESSÉ M1/M2/lows 3-4-5 → re-appliqué à HEAD avec les délimiteurs de lignes actuels.
- Plan : `read-only-code-review-plan-delightful-fox.md` (H1 evidence naming = orchestrator-side, E2E non rejoué).

## Correctifs par finding

- M1 — `apps/api-py/src/services/dashboard.py:19-22,42-43` : lecture de la file (`queue_state`) AVANT les métriques (`totals`) ; invariant commenté (« metrics must never predate the queue snapshot »). Test d'ordre : `apps/api-py/tests/test_dashboard_service.py` — mocks des deux requêtes, `calls == ["queue", "metrics"]` + payload issu des mocks (la file lue en dernier reflète un job committé après les métriques). Adapté au ctor actuel `(session, settings, jobs, sync)`.
- M2 — `apps/web/app/dashboard/drive-workflow.tsx:42-45,66-69` : done-declaration (les deux sites : restore du snapshot + effet de poll) exige désormais `data.queue.queued + ready + active === 0` EN PLUS de `outcomes >= target` ; `data` rendu obligatoire (fini le `?? 0` qui masquait une file vide). Vitest : `apps/web/tests/drive-workflow.test.tsx:127-143` — payload mixte (item manuel `ready:1` + outcomes atteints) → polling maintenu (« analyse en cours »), puis file drainée → done.
- L3 — `apps/api-py/src/worker.py:38` : `logger.error("job handler failed: %s", type(exc).__name__)` (déjà en place après refactor). `apps/api-py/src/dsa/tools.py:139-140` : warning type-seul ajouté dans la boucle two-pass — `logger.warning("%s", type(exc).__name__)` (parité worker ; le rewrite avait supprimé tout log).
- L4 — fallback image : déjà absent du rewrite two-pass (plus d'ImageFormatOption fallback). Outils Docling inutilisés (`DoclingArgs`/`DoclingMarkdownTool`/`DoclingTextTool`), réintroduits par 0992ffc : re-supprimés après grep (aucune autre référence dans le repo) ; imports `crewai`/`pydantic` retirés de tools.py.
- L5 — N/A : le rewrite a supprimé le `lru_cache` de `_build_converter` ; `stub_docling` monkeypatche `DocumentConverter` directement (test_dsa.py:31-35) — plus rien à purger, cache_clear hors sujet.

## Vérifications

- API : `96 passed` en 66s (incl. `test_real_scanned_pdf_ocr_pictures_and_proposal` Docling réel) ; black + flake8 PASS (venv py3.14 `.venv`, pas `.venv313` qui est en 3.13 et ne parse pas le PEP 758).
- Web : `18` fichiers, `133 passed`. `tsc --noEmit` : clean en cache chaud (« No errors found ») mais ÉCHEC à froid — TS2882 `app/layout.tsx:3` ← `./globals.css`, préexistant (fichiers intouchés par ce batch, tsconfig/lockfile TS 5.9.3) ; le clean initial était un artefact du buildinfo incrémental. Correction constatée à la re-vérification cron 2026-10-08 21:45 ; hors scope R5, à traiter côté toolchain.
- Agent : `scripts/agent` node --test — `159 pass / 2 fail`. Les 2 échecs (live BYOK preflight determinism + live runner fatal rejection) sont préexistants et env-only : `@prisma/client` introuvable (apps/api legacy sans node_modules) au require du harness ; aucun fichier de ce diff ne touche `scripts/` ni `apps/api/`.
- Commits (conventionnels, split) : `fix: dashboard payload queue-before-metrics; done-declaration requires empty queue` → M1+M2 ; `chore: drop dead docling tools; log exception type only` → L3/L4 ; `docs: handoff + STATE …` → handoff + STATE.md. Poussés : création de l'upstream `origin/hermes/card-3-scanned-pdf` (le reste de la stack cards 1-4 est antérieur, non concerné par ce batch, déjà présent sur la branche locale). Arbre propre. Reviewer gate et evidence dirs intouchés.

## Invariants

- Aucun changement de flux documentaire : contenu toujours streamé en mémoire, jamais persisté.
- Aucun changement UI visuel : refactors d'état (polling) et de logs uniquement.
- Aucun secret dans ce handoff.