#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
cd "$repo_root"

env_file=${KLASR_E2E_ENV_FILE:-.hosttest}
template=docs/e2e/docker-compose.e2e.yml
rendered=.tmp/hermes/compose-e2e/docker-compose.e2e.yml

[[ -f "$env_file" ]] || { echo "Missing $env_file" >&2; exit 1; }
chmod 600 "$env_file"
set -a
# shellcheck disable=SC1090 # The caller may select another env-only file for a dry run.
source "$env_file"
set +a

: "${KLASR_GOOGLE_DRIVE_ROOT_ID:?Set KLASR_GOOGLE_DRIVE_ROOT_ID in $env_file}"
required=(TOKEN_ENCRYPTION_KEY INTERNAL_API_SECRET GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET KLASR_LLM_API_KEY KLASR_SA_FILE_OVERRIDE)
missing=()
for name in "${required[@]}"; do
  [[ -n ${!name:-} ]] || missing+=("$name")
done
if ((${#missing[@]})); then
  printf 'Missing required E2E values: %s\n' "${missing[*]}" >&2
  exit 1
fi
export KLASR_E2E_PROBE=${KLASR_E2E_PROBE:-apps/e2e/scripts/probe.mjs}
export KLASR_ACCEPTANCE_GOOGLE_SERVICE_ACCOUNT=true
export NEXT_PUBLIC_KLASR_ACCEPTANCE_GOOGLE_SERVICE_ACCOUNT=true

mkdir -p "$(dirname "$rendered")"
python3 - "$template" "$rendered" <<'PY'
import os
import pathlib
import string
import sys

source, destination = map(pathlib.Path, sys.argv[1:])
destination.write_text(string.Template(source.read_text()).substitute(os.environ))
destination.chmod(0o600)
PY

if [[ ${1:-} == --dry-run ]]; then
  cat "$rendered"
  exit 0
fi

[[ -f "$KLASR_SA_FILE_OVERRIDE" ]] || { echo "Missing service-account file: $KLASR_SA_FILE_OVERRIDE" >&2; exit 1; }
compose=(docker compose --project-name klasr-e2e --env-file "$env_file" -f docker-compose.yml -f "$rendered" --profile api)
"${compose[@]}" build
"${compose[@]}" up -d

for _ in {1..60}; do
  if curl --fail --silent --show-error http://127.0.0.1:3101/api/v1/health >/dev/null; then
    printf '%s\n' 'Compose E2E is healthy.'
    # shellcheck disable=SC2016 # Print the command for the caller's shell.
    printf '%s\n' 'set -a; source .hosttest; set +a; node "$KLASR_E2E_PROBE"'
    exit 0
  fi
  sleep 2
done

echo 'API health check timed out; inspect: docker compose --project-name klasr-e2e logs' >&2
exit 1
