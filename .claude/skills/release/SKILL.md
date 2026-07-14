---
name: release
description: Cut and publish a Klasr release — release branch, changelog, version bump, tag, artifact publication. Use when asked to prepare or ship a release.
---
# Release Procedure (SemVer)

1. Decide version from Conventional Commits since last tag: `git log $(git describe --tags --abbrev=0)..origin/develop --oneline` — feat → minor, fix only → patch, BREAKING CHANGE → major.
2. `git checkout -b release/vX.Y.Z origin/develop` (in a worktree).
3. Bump versions: apps/api/package.json, apps/web/package.json, services/intelligence/pyproject.toml — keep them in lockstep.
4. Generate/append CHANGELOG.md section grouped by type (Features / Fixes / Chore), linking PRs.
5. Only QA fixes on this branch; no new features.
6. PR release/vX.Y.Z → main. After merge with green CI: `git tag -a vX.Y.Z -m "Klasr vX.Y.Z" && git push origin vX.Y.Z`.
7. Tag push triggers .github/workflows/release.yml → Docker images to ghcr.io + GitHub Release. Verify all three images published.
8. Merge main back into develop. Update docs/STATE.md (Done + version).
