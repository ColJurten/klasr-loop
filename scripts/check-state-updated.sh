#!/usr/bin/env bash
# Stop hook: if code changed in this session but docs/STATE.md didn't, remind the agent (non-blocking warning).
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
changed=$(git status --porcelain 2>/dev/null)
if [ -n "$changed" ] && ! printf '%s' "$changed" | grep -q "docs/STATE.md"; then
  echo "Reminder: working tree has changes but docs/STATE.md was not updated. Update the loop state (In progress / Done / Decisions) before finishing." >&2
fi
exit 0
