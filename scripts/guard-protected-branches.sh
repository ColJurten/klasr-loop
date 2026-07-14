#!/usr/bin/env bash
# PreToolUse hook (matcher: Bash). Blocks commits/pushes made directly on main or develop.
input=$(cat)
cmd=$(printf '%s' "$input" | python3 -c 'import json,sys; print(json.load(sys.stdin).get("tool_input",{}).get("command",""))' 2>/dev/null)
case "$cmd" in
  *"git commit"*|*"git push"*|*"git merge"* )
    branch=$(git -C "${CLAUDE_PROJECT_DIR:-.}" rev-parse --abbrev-ref HEAD 2>/dev/null || echo "")
    if [ "$branch" = "main" ] || [ "$branch" = "develop" ]; then
      echo "BLOCKED: direct git write on protected branch '$branch'. Create a worktree with scripts/new-worktree.sh and work on a feature/fix branch." >&2
      exit 2   # exit 2 = block the tool call and feed stderr back to Claude
    fi
    ;;
esac
exit 0
