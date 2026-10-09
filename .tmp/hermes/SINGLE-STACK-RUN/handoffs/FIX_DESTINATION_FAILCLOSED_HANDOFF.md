# Destination fail-closed handoff

## Changed lines

- `apps/api-py/src/dsa/config/tasks.yaml:19-30`: forbids closest/nearest/default folder selection and requires `value: null`, `confidence: 0`, and `no_destination_match` when document evidence supports no candidate.
- `apps/api-py/src/dsa/__init__.py:69-94`: central destination validation now normalizes null or `no_destination_match` decisions to no value, zero confidence, and a first, deduplicated `no_destination_match` warning. Existing confidence and exact tree-membership guards remain unchanged.
- `apps/api-py/src/services/analysis.py:359-375`: promotes `no_destination_match` ahead of filename warnings so it becomes the proposal `review_reason`; null destinations still produce an empty path and require review.
- `scripts/live-google-service-account.mjs:907-915`: reflows the review fixture over four PDF lines so `REF-ZEPHYR-742`, `2026-08-15`, `Zephyr Research`, and `without a matching destination` all survive extraction. The invoice generator is unchanged.
- `apps/api-py/tests/test_dsa.py:209-213,356-405`: covers null normalization and stub-LLM contract/research versus invoice destination decisions, including the strengthened prompt.
- `apps/api-py/tests/test_drive_analysis.py:367-405`: covers empty destination, zero confidence, manual review, and `no_destination_match` review-reason priority. Existing out-of-tree rejection tests remain green.

## Verification

- `./.venv/bin/python -m pytest -q`: 99 passed.
- `./.venv/bin/black --check src tests alembic`: passed; 61 files unchanged.
- `./.venv/bin/flake8 src tests alembic`: passed.
- Offline product path: regenerated `reviewRequiredPdf()` from the fixed generator, extracted it with `extract_memory`, and ran `AnalysisService.suggest()` with environment provider configuration. Assertions passed for full fixture text, empty destination, zero destination confidence, first warning/reason `no_destination_match`, and manual review.
- The credentialed Google/browser flow was not run.
