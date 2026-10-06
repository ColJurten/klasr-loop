#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
cd "$repo_root"

env_file=${KLASR_E2E_ENV_FILE:-.hosttest}
rendered=.tmp/hermes/compose-e2e/docker-compose.e2e.yml
[[ -f "$env_file" ]] || { echo "Missing $env_file" >&2; exit 1; }
[[ -f "$rendered" ]] || { echo "Missing rendered override; run apps/e2e/scripts/e2e-up.sh first" >&2; exit 1; }

compose=(docker compose --project-name klasr-e2e --env-file "$env_file" -f docker-compose.yml -f "$rendered" --profile api)
"${compose[@]}" down --volumes --remove-orphans

[[ -z $("${compose[@]}" ps -q) ]] || { echo 'Compose E2E containers remain' >&2; exit 1; }
python3 - <<'PY'
import socket

for port in (3100, 3101, 27018, 55432):
    with socket.socket() as sock:
        try:
            sock.bind(("127.0.0.1", port))
        except OSError as error:
            raise SystemExit(f"Port {port} is still in use: {error}") from error
PY
echo 'Compose E2E removed; shifted ports are free.'
