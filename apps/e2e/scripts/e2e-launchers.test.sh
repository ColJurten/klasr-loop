#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
fixture=$(mktemp)
output=$(mktemp)
config=$(mktemp)
trap 'rm -f "$fixture" "$output" "$config"' EXIT

cat >"$fixture" <<'EOF'
KLASR_SA_FILE_OVERRIDE=/tmp/dummy-service-account.json
KLASR_GOOGLE_DRIVE_ROOT_ID=dummy-drive-root
KLASR_E2E_PROBE=/tmp/probe.mjs
EOF

KLASR_E2E_ENV_FILE=$fixture "$repo_root/apps/e2e/scripts/e2e-up.sh" --dry-run >"$output"
# shellcheck disable=SC2016 # Search for an unsubstituted template marker.
if grep -Fq '${' "$output"; then exit 1; fi
grep -q '127.0.0.1:3101:3001' "$output"
grep -q '/tmp/dummy-service-account.json:/run/secrets/google-service-account.json:ro' "$output"
[[ $(grep -c '^      KLASR_ACCEPTANCE_GOOGLE_SERVICE_ACCOUNT: "true"' "$output") -eq 3 ]]
grep -q 'NEXT_PUBLIC_KLASR_ACCEPTANCE_GOOGLE_SERVICE_ACCOUNT: "true"' "$output"
docker compose --env-file "$fixture" -f "$repo_root/docker-compose.yml" -f "$output" --profile api config >"$config"
[[ $(grep -c 'published: "3101"' "$config") -eq 1 ]]
[[ $(grep -c 'published: "3100"' "$config") -eq 1 ]]
if grep -q 'published: "3001"' "$config"; then exit 1; fi
if grep -q 'published: "3000"' "$config"; then exit 1; fi
echo 'E2E launcher dry-run substitution: PASS'
