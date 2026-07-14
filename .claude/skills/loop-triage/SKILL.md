---
name: loop-triage
description: Recurring triage procedure — reads CI failures, open issues, and recent commits, then updates the loop state and opens/labels issues. Invoked by the nightly automation or manually with /loop-triage.
---
# Loop Triage Procedure

Goal: surface the work so humans and agents act on a curated list, not raw noise.

1. **Read state first**: docs/STATE.md (In progress, Backlog, Failures).
2. **CI health**: `gh run list --limit 15 --json conclusion,name,headBranch,url`. For each failure on develop/main in the last 24h: `gh run view <id> --log-failed`, summarize root cause in one line.
3. **Issues**: `gh issue list --limit 30 --json number,title,labels,updatedAt`. Flag: unlabeled issues (propose bug/feature + priority label), stale in-progress items (>5 days without commits).
4. **Commits**: `git log origin/develop --since=yesterday --oneline` — note anything merged without an issue reference.
5. **Act**:
   - Open an issue (label `ci-failure`, priority) for each new distinct CI failure: `gh issue create ...`.
   - Apply missing labels.
   - Update docs/STATE.md: refresh Backlog order, add findings under a dated "Triage" note, record failures/lessons.
6. **Report**: end with a ≤10-line digest: top 3 actionable items, anything blocked, anything that needs a human decision. If nothing was found, say so explicitly and change nothing else.

Constraints: never modify code during triage; never close issues; keep STATE.md edits append-or-move only (no deleting history).
