# Handoff builder — reviewer batch R5

- Mode Codex : session interactive/API (pas de session `/goal`).
- Branche : `backend-python-refacto`, reprise après interruption (usage limit Codex 2026-10-06) — le diff non committé couvrait déjà M1/M2/lows 3-5 pour l'essentiel ; vérifié item par item, écarts comblés, suites relancées.
- Plan : `read-only-code-review-plan-delightful-fox.md` (H1 = evidence naming, traité orchestrator-side — E2E NON rejoué).

## Correctifs par finding

- M1 — `apps/api-py/src/services/dashboard.py:18-20,37-38` : lecture de la file (`queue_state`) AVANT les métriques (`totals`) ; invariant commenté (« metrics must never predate the queue snapshot »). Test d'ordre : `apps/api-py/tests/test_dashboard_service.py:9-28` — mocks des deux requêtes, `calls == ["queue", "metrics"]` + payload issu des mocks (la file lue en dernier reflète un job committé après les métriques).
- M2 — `apps/web/app/dashboard/drive-workflow.tsx:39,98,112` : déclaration de done-condition avec `queued + ready + active === 0` en plus de `outcomes >= target` ; `data` rendu obligatoire (fini le `?? 0` qui masquait une file vide). Vitest : `apps/web/tests/drive-workflow.test.tsx:128-143` — payload mixte (item manuel `ready:1` + outcomes atteints) → polling maintenu (« analyse en cours »), puis file drainée → done.
- L3 — `apps/api-py/src/worker.py:58` : `logger.error("job handler failed: %s", type(exc).__name__)`. `apps/api-py/src/dsa/tools.py:145-146` : warning OCR échoué → `logger.warning("%s", type(exc).__name__)` (type seul, sans corps de message). Test aligné : `apps/api-py/tests/test_dsa.py:182` (`warnings == [("%s", "RuntimeError")]`).
- L4 — `apps/api-py/src/dsa/tools.py` : suppression du fallback image (`try/except ImageFormatOption` dans `_build_converter`, ex-lignes 98-105) ET du test `test_converter_fallback_preserves_no_ocr_options` ; suppression des outils Docling inutilisés `DoclingTextTool`/`DoclingMarkdownTool`/`DoclingArgs` (ex-lignes 191-207) — `grep` sur `apps/api-py` : aucune autre référence.
- L5 — `apps/api-py/tests/test_dsa.py:41` : `_build_converter.cache_clear()` AVANT le `yield` de `stub_docling` (en plus de l'après).

## Vérifications

- API : `109 passed, 1 skipped` ; `black --check` PASS ; `flake8` PASS.
- Web : `18` fichiers, `135 passed` (incl. nouveau vitest M2).
- Agent : `scripts/agent` `node --test` — `164 pass / 0 fail`.
- Commit 1 `b97ced0` `fix: dashboard payload queue-before-metrics; done-declaration requires empty queue` ; commit 2 `0f57c62` `chore: drop dead docling fallback/tools; log exception type` ; poussés sur `backend-python-refacto`. Arbre propre, aucune modification du reviewer gate ni des evidence dirs.

## Invariants

- Aucun changement de flux documentaire : contenu toujours streamé en mémoire, jamais persisté.
- Aucun changement UI visuel : les refactors concernent l'état (polling) et les logs uniquement.