#!/usr/bin/env bash
set -euo pipefail
unset GH_TOKEN GITHUB_TOKEN

case "${1:-}" in
  lint|typecheck|test|build) exec pnpm "$1" ;;
  agent-tests) exec node --test scripts/agent/test/*.test.mjs scripts/test/*.test.mjs ;;
  shell-syntax) exec bash -n scripts/agent/*.sh ;;
  *) echo "usage: $0 lint|typecheck|test|build|agent-tests|shell-syntax" >&2; exit 2 ;;
esac
