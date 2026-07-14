---
name: git-workflow
description: How to branch, commit, open PRs, and merge in this repo. Use for any git operation, PR creation, or when starting/finishing a task.
---
# Git Workflow

Full model in docs/BRANCHING.md. Operational summary:

## Starting a task
1. Sync: `git fetch origin && git checkout develop && git pull`.
2. Create an isolated worktree: `scripts/new-worktree.sh feature/<issue>-<slug>` (or `fix/...`). Work there.
3. Update docs/STATE.md: move item to "In progress" with branch name.

## Committing
Conventional Commits, small and atomic: `feat(api): ...`, `fix(web): ...`, `test(intel): ...`.
Never `--no-verify`. Never commit secrets or .env files.

## Finishing
1. Rebase on develop: `git fetch origin && git rebase origin/develop`.
2. Lint + tests green locally.
3. Hand off to the `verifier` agent (and `security-reviewer` if the diff touches auth, OAuth, uploads, tenant scoping, or personal data).
4. Push and open PR to develop: `gh pr create --base develop --fill` using .github/PULL_REQUEST_TEMPLATE.md. Link the issue (`Closes #N`).
5. After merge: `scripts/remove-worktree.sh <branch>`, update STATE.md (Done + lessons).

## Forbidden
Direct pushes to main/develop, force-push to shared branches, merge with red CI, tags outside the release procedure (see the `release` skill).
