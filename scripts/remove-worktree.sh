#!/usr/bin/env bash
# Usage: scripts/remove-worktree.sh feature/42-rule-engine
set -euo pipefail
branch="${1:?usage: remove-worktree.sh <branch>}"
root=$(git rev-parse --show-toplevel)
dir="$(dirname "$root")/klasr-worktrees/${branch//\//-}"
git worktree remove "$dir" --force || true
git branch -D "$branch" 2>/dev/null || true
git worktree prune
echo "Removed worktree and local branch $branch"
