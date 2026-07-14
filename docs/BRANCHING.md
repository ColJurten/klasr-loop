# Klasr Branching & Release Model (GitFlow-lite)

## Permanent branches

- **`main`** — production. Only receives merges from `release/*` and `hotfix/*`. Every merge to `main` is tagged `vX.Y.Z` (SemVer). Protected: no direct pushes, PR + green CI required.
- **`develop`** — integration. All feature/fix branches merge here via PR. Protected: PR + green CI required.

## Working branches

| Type | From | Merges to | Naming | Example |
|---|---|---|---|---|
| Feature | `develop` | `develop` | `feature/<issue>-<slug>` | `feature/42-rule-engine` |
| Bug fix | `develop` | `develop` | `fix/<issue>-<slug>` | `fix/57-oauth-refresh` |
| Hotfix | `main` | `main` **and** `develop` | `hotfix/<slug>` | `hotfix/tenant-leak` |
| Release | `develop` | `main` **and** `develop` | `release/vX.Y.Z` | `release/v0.3.0` |

## Commits — Conventional Commits

`<type>(<scope>): <subject>` — types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`, `perf`.
Scopes: `api`, `web`, `intel`, `infra`, `docs`. Example: `feat(api): add tenant-scoped rules repository`.
Breaking changes: `!` after type/scope + `BREAKING CHANGE:` footer → major bump.

## Release procedure (also codified in the `release` skill)

1. `git checkout -b release/vX.Y.Z develop`
2. Bump versions, generate changelog from Conventional Commits, final QA fixes only.
3. PR → `main`, CI green, merge, then `git tag -a vX.Y.Z -m "Klasr vX.Y.Z"` and push tag.
4. Tag push triggers `.github/workflows/release.yml`: builds and publishes Docker images (`ghcr.io/<owner>/klasr-{api,web,intelligence}:vX.Y.Z`) and a GitHub Release with changelog.
5. Merge back `main` → `develop`.

## Branch protection (configure in GitHub → Settings → Branches)

For `main` and `develop`: require PR before merging, require status checks `ci / api`, `ci / web`, require branches up to date, no force pushes, linear history preferred.

## CI portability note (jury dossier)

The Klasr conception dossier lists GitLab CI/CD. The pipeline here is expressed in
GitHub Actions because the repo lives on GitHub and the nightly Claude automation
uses Actions. The stages are identical (lint → test → build → artifact) and map
1-to-1 to a `.gitlab-ci.yml` (`stages: [lint, test, build, publish]`); document this
equivalence in the dossier or maintain a GitLab mirror if the evaluation requires it.
