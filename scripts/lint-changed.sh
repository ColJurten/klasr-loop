#!/usr/bin/env bash
# PostToolUse hook (matcher: Edit|Write). Lints the file that was just modified. Non-blocking on missing tooling.
input=$(cat)
file=$(printf '%s' "$input" | python3 -c 'import json,sys; d=json.load(sys.stdin).get("tool_input",{}); print(d.get("file_path") or d.get("path") or "")' 2>/dev/null)
[ -z "$file" ] && exit 0
case "$file" in
  *.ts|*.tsx)
    if [[ "$file" == *"/apps/api/"* ]]; then (cd "${CLAUDE_PROJECT_DIR}/apps/api" && npx --no-install eslint --fix "$file" 2>/dev/null); fi
    if [[ "$file" == *"/apps/web/"* ]]; then (cd "${CLAUDE_PROJECT_DIR}/apps/web" && npx --no-install eslint --fix "$file" 2>/dev/null); fi
    ;;
esac
exit 0
