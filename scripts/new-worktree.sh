#!/usr/bin/env bash
# Usage: scripts/new-worktree.sh feature/42-rule-engine [base-branch]
# Creates ../klasr-worktrees/<branch> on a new branch from base (default: develop).
set -euo pipefail
branch="${1:?usage: new-worktree.sh <type>/<name> [base]}"
base="${2:-develop}"
case "$branch" in
  feature/*|fix/*|hotfix/*|release/*) ;;
  *) echo "Branch must start with feature/ fix/ hotfix/ or release/" >&2; exit 1 ;;
esac
# hotfixes branch from main by default
if [ "${branch%%/*}" = "hotfix" ] && [ "$base" = "develop" ]; then base="main"; fi
root=$(git rev-parse --show-toplevel)
dir="$(dirname "$root")/klasr-worktrees/${branch//\//-}"
git fetch origin "$base"
git worktree add -b "$branch" "$dir" "origin/$base"
echo "Worktree ready: $dir (branch $branch from $base)"
echo "cd $dir  # or: claude --worktree"
