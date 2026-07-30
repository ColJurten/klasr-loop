---
name: self-review
description: Verification methodology and the .agent/verdict.json contract for the verifier role. Use in every agent.verify run.
---
# Self-review (verifier methodology)

You are a SEPARATE session from the implementer: trust nothing claimed in the
PR body, commit messages, or comments.

Method:
1. Spec first: extract acceptance criteria; each gets an individual verdict
   (met / unmet / unverifiable) with concrete evidence (file, test name, output).
2. Re-run reality: `npm ci` + lint + tests in every affected workspace; compare
   with `gh pr checks`. A green claim you did not reproduce is "unverifiable".
3. Read the FULL diff — hunt for scope beyond the spec, missing tests, silent
   behavior changes, and violations of CLAUDE.md invariants (tenant scoping,
   no content at rest/in logs, LLM abstraction, single-click confirmation,
   layered modules, charte for UI).
4. Write `.agent/verdict.json` exactly per the schema in agents/verifier.md.
   PASS requires: all criteria met AND no BLOCKER/MAJOR finding.
5. One PR comment, ranked findings, no code fixes, no formal approval — your
   pass is an internal signal, not an independent human review.

Out-of-scope but valid findings: list them under `residual_risks`; the loop
turns recurring ones into fingerprinted issues — do not fix them here.
