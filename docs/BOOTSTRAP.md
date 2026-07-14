# Bootstrap Checklist (one-time, ~20 min)

## 1. Create the repo
```bash
cd klasr-loop && git init -b main
git add -A && git commit -m "chore: loop engineering bootstrap"
gh repo create klasr --private --source=. --push
git checkout -b develop && git push -u origin develop
```

## 2. Protect branches
GitHub → Settings → Branches → add rules for `main` and `develop`:
require PR, require status checks (`ci / api`, `ci / web`),
block force pushes. (Checks appear after the first CI run.)

## 3. Secrets
Settings → Secrets and variables → Actions:
- `ANTHROPIC_API_KEY` (nightly triage automation)
- later: `SONAR_TOKEN`, `SONAR_HOST_URL`

## 4. Local Claude Code setup
```bash
cd klasr && claude          # CLAUDE.md, skills, agents, hooks load automatically
/agents                     # confirm planner / implementer / verifier / security-reviewer
claude mcp add github -- npx -y @modelcontextprotocol/server-github   # connector (verify current install cmd in docs)
```

## 5. First loop run (dry run)
```bash
/loop-triage                              # run triage manually once
scripts/new-worktree.sh feature/1-bootstrap
# in the worktree:
claude
> Use the planner agent to plan the NestJS + Next.js + FastAPI scaffolding, then implement, then verify.
/goal apps/api lints and its tests pass
```

## 6. Enable the nightly automation
Actions tab → claude-nightly-triage → Run workflow (manual test) → then let the cron take over.

## 7. Jury note
Export a diagram of docs/LOOP.md for the dossier: the maker/checker split, quality
gates, and GitFlow releases are directly citable REAC evidence (industrialization,
CI/CD, quality assurance).
