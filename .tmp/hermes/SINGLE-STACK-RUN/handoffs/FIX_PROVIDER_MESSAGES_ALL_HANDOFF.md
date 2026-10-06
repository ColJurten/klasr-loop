# FIX_PROVIDER_MESSAGES_ALL — Builder handoff

- Mode: Codex builder direct task (no `/goal` session).
- Changed: `apps/api-py/src/services/llm_settings.py`, `apps/api-py/tests/test_security_providers.py`, `docs/STATE.md`, and this handoff.
- Result: all provider completion messages are rebuilt from `role` and `content`; Anthropic system splitting is unchanged. CrewAI native tool messages cannot occur here because `CallableLLM.supports_function_calling()` returns `False`, its executor gates native tools on that result, and these crews declare no tools.
- Regression: the provider transport test now proves OpenAI keeps its bearer header and `/v1/chat/completions` path while stripping `cache_breakpoint`.
- Checks: `./.venv/bin/python -m pytest -q` (89 passed); `./.venv/bin/black --check src tests alembic` (61 files unchanged); `./.venv/bin/flake8 src tests alembic` (passed). No credentialed flow was run.
- Drive invariant: unchanged; this patch only sanitizes outbound LLM message dictionaries in `ProviderClientService.completion`. Drive mutation remains behind explicit confirmation in the existing classification path.
- Visual/design-system verification: not applicable; no UI changed.
- REAC: C6 (provider abstraction boundary), C9 (automated regression), C10 (untrusted metadata minimization).
- Known compromises: none. Worker retry policy, phase mapping, and error codes were intentionally untouched.
