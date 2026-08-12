---
name: issue-spec
description: The klasr-agent-spec:v2 format and deterministic evidence contract.
---
# Task specification (`klasr-agent-spec:v2`)

Embed one YAML mapping between `<!-- klasr-agent-spec:v2` and `-->`. Keep the human discussion untouched and validate with `node scripts/agent/validate-spec.mjs <body-file>`. v1 remains readable only for existing live issues; all new specs use v2.

Required legacy fields are `version`, `task_id`, `title`, `problem`, `desired_outcome`, `constraints`, `non_goals`, `affected_areas`, `risk_level`, `security_review_required`, `test_plan`, and `dependencies`. Each `acceptance_criteria` row requires a unique `id`, observable `behavior`, minimum `evidence_class` (`unit < integration < browser < live-provider`), and deterministic `assertion`.

Also require `user_journeys`, `failure_states`, `forbidden_shortcuts`, `cleanup_plan`, `completion_policy` (final state exactly `awaiting-human-verdict`, current SHA and reviewer verdict required), and `human` owner with a pending verdict. A live-provider criterion requires a non-production `provider_fixture` and mandatory cleanup proof. NATURAL_PATH provider UI specs must forbid expected-result seeding, browser database/queue polling, `page.reload()`, direct decision APIs, cached global queue control flow, stale runtime/evidence reuse, and provider-auth-only acceptance.

Source inspection and builder prose are never evidence. Evidence rows must match the issue, current attempt and SHA, meet or exceed the required class, pass cleanup/process checks, and include a current read-only reviewer PASS. Bots never formally approve or merge.
