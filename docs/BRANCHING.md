# Klasr Branching & Release Model (GitFlow-lite)

## Permanent branches

- **`main`** — production. Only receives merges from `release/*` and `hotfix/*`. Every merge to `main` is tagged `vX.Y.Z` (SemVer). Protected: no direct pushes, PR + green CI required.
- **`develop`** — obsolète, ignorée. Les branches feature/fix ciblent `main` via PR.

## Working branches

| Type | From | Merges to | Naming | Example |
|---|---|---|---|---|
| Feature | `main` | `main` | `feature/<issue>-<slug>` | `feature/42-rule-engine` |
| Bug fix | `main` | `main` | `fix/<issue>-<slug>` | `fix/57-oauth-refresh` |
| Hotfix | `main` | `main` | `hotfix/<slug>` | `hotfix/tenant-leak` |
| Release | `main` | `main` | `release/vX.Y.Z` | `release/v0.3.0` |

## Commits — Conventional Commits

`<type>(<scope>): <subject>` — types: `feat`, `fix`, `chore`, `docs`, `refactor`, `test`, `ci`, `perf`.
Scopes: `api`, `web`, `intel`, `infra`, `docs`. Example: `feat(api): add tenant-scoped rules repository`.
Breaking changes: `!` after type/scope + `BREAKING CHANGE:` footer → major bump.

## Release procedure (also codified in the `release` skill)

1. `git checkout -b release/vX.Y.Z main`
2. Bump versions, generate changelog from Conventional Commits, final QA fixes only.
3. PR → `main`, CI green, merge, then `git tag -a vX.Y.Z -m "Klasr vX.Y.Z"` and push tag.
4. Tag push triggers `.github/workflows/release.yml`: builds and publishes Docker images (`ghcr.io/<owner>/klasr-{api,web,intelligence}:vX.Y.Z`) and a GitHub Release with changelog.

## Branch protection (configure in GitHub → Settings → Branches)

Pour `main` : PR obligatoire, check `ci / gate` au SHA courant, approbation humaine après le dernier push, conversations résolues, rejet des revues périmées, aucun bypass bot ni auto-merge, aucun force push.

## CI portability note (jury dossier)

The Klasr conception dossier lists GitLab CI/CD. The pipeline here is expressed in
GitHub Actions because the repo lives on GitHub and the nightly Claude automation
uses Actions. The stages are identical (lint → test → build → artifact) and map
1-to-1 to a `.gitlab-ci.yml` (`stages: [lint, test, build, publish]`); document this
equivalence in the dossier or maintain a GitLab mirror if the evaluation requires it.
