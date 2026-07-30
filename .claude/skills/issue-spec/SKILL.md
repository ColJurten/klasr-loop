---
name: issue-spec
description: The klasr-agent-spec:v1 task specification format — how to read, write, edit idempotently, and validate it. Use whenever creating or consuming an agent task specification.
---
# Task specification (klasr-agent-spec:v1)

Every agent-managed task has ONE canonical GitHub issue whose body embeds the
machine-readable spec between stable markers, clearly separated from the
untrusted free-form discussion around it:

```
<!-- klasr-agent-spec:v1
version: 1
task_id: 123                      # the canonical issue number
title: Short imperative title
problem: What is wrong or missing, observably
desired_outcome: The observable end result
acceptance_criteria:              # each one objectively checkable
  - Confirming a proposal decrements the pending counter without reload
constraints:                      # invariants that must survive (CLAUDE.md)
  - Organization scoping preserved on every query
non_goals:                        # explicit scope boundary
  - No dashboard redesign
affected_areas:                   # workspaces/paths
  - apps/web
risk_level: low | medium | high
security_review_required: false   # true for auth/OAuth/Drive/scoping/stores/logging/workflows
test_plan:
  - Vitest component test on the counter behavior
dependencies: []
-->
```

Rules:
- Editing is IDEMPOTENT: replace only the block between the markers; never touch
  the human discussion around it.
- Validate with `node scripts/agent/validate-spec.mjs <body-file>` (exit 0 = valid).
  The validator rejects missing fields, vague acceptance criteria (<8 chars),
  unknown risk levels, and non-boolean security decisions.
- The worker refuses to start an implementer without a valid spec — never work
  around that.
- Real test suites to name in test_plan: Jest (`apps/api`), Vitest (`apps/web`),
  node:test (`scripts/agent`).
