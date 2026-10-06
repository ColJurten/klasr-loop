# Signals normalization round 2 handoff

## Result

- Every non-empty string signal is normalized losslessly and appends `unlabelled_signal` after existing warnings.
- Known prefixes select a deterministic label; all other strings use `unlabelled`.
- Empty strings, bare known labels, extra signal keys, non-list signals, and malformed warnings fail Pydantic validation.
- Internal extraction/provider signals now use structured objects directly.
- Prompt examples use `<valeur exacte extraite>` instead of a concrete date.
- `Signal` still permits an empty `signals` list as required by existing dependencies (L3 intentionally unchanged).

## Files

- `apps/api-py/src/dsa/schemas.py`
- `apps/api-py/src/dsa/__init__.py`
- `apps/api-py/src/services/analysis.py`
- `apps/api-py/src/dsa/config/tasks.yaml`
- `apps/api-py/tests/test_dsa.py`
- `docs/STATE.md`

## Verification

- `./.venv/bin/python -m pytest -q` — 96 passed.
- `./.venv/bin/black --check src tests alembic` — 61 files unchanged.
- `./.venv/bin/flake8 src tests alembic` — passed.
- `git diff --check` — passed.
- No credentialed or provider flow was run.
- UI visual verification was not applicable: no UI file changed; `review_reason` receives the code-style warning through `AnalysisService` and `ProposalCard` renders that code verbatim.

## Compliance

- Drive invariant unchanged: the edit only affects metadata validation/prompting; document bytes still remain in the existing in-memory extraction path and no move/rename path changed.
- Design system unchanged: no UI or styling change.
- REAC: C3 (robust OCR/LLM proposal pipeline), C6 (fail-closed boundary validation), C9 (automated regression and quality gates).
- Codex mode: interactive builder session using the Ponytail full minimal-diff workflow.
