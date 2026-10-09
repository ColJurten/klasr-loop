# Destination fail-closed round 2 handoff

## Finding resolutions

- F1: removed the answer hint from `reviewRequiredPdf`; extraction still contains `REF-ZEPHYR-742`, `2026-08-15`, `Zephyr Research`, and `Archived research memorandum.` without truncation. The invoice generator is unchanged.
- F2: the stub-LLM regression now covers `null` at confidence `0.9` with no warnings and an in-tree value at confidence `0.9` with `no_destination_match`; application validation normalizes both to `None`, confidence `0`, and `no_destination_match`.
- F3: clarified that a path is selected only when directly supported by document content, while retaining the exact-path and `null`/`0`/`no_destination_match` contract.
- F4: intentionally unchanged. A high-confidence in-tree path without a warning is not detectable in application code by design; live attempt 13 must prove the prompt behavior. No heuristic was added.
- F5: isolated the destinationless service test from `KLASR_LLM_PROVIDER` and `KLASR_LLM_MODEL`.
- F6: recorded attempt 12 and this review fix in `docs/STATE.md` and updated its date label.
- F7: intentionally unchanged. CLI/service extraction-failure warning ordering is not product-affecting.

## Verification

- `./.venv/bin/python -m pytest -q`: 100 passed.
- `./.venv/bin/black --check src tests alembic`: passed; 61 files unchanged.
- `./.venv/bin/flake8 src tests alembic`: passed.
- One environment-configured offline product-path check regenerated the de-hinted PDF, used `extract_memory`, then ran `AnalysisService.suggest` with the inherited tree and real provider. Status output:

```text
extraction=PASS
destination_fail_closed=PASS
manual_review=PASS
```

The credentialed Google/browser flow was not run.
