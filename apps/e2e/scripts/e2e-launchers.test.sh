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
TOKEN_ENCRYPTION_KEY=synthetic-token-key
INTERNAL_API_SECRET=synthetic-internal-secret
GOOGLE_CLIENT_ID=synthetic-client-id
GOOGLE_CLIENT_SECRET=synthetic-client-secret
KLASR_LLM_API_KEY=synthetic-llm-key
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

missing_fixture=$(mktemp)
trap 'rm -f "$fixture" "$output" "$config" "$missing_fixture"' EXIT
cat >"$missing_fixture" <<'EOF'
KLASR_GOOGLE_DRIVE_ROOT_ID=dummy-drive-root
EOF
if KLASR_E2E_ENV_FILE=$missing_fixture "$repo_root/apps/e2e/scripts/e2e-up.sh" --dry-run >"$output" 2>&1; then exit 1; fi
grep -q 'TOKEN_ENCRYPTION_KEY.*INTERNAL_API_SECRET.*GOOGLE_CLIENT_ID.*GOOGLE_CLIENT_SECRET.*KLASR_LLM_API_KEY.*KLASR_SA_FILE_OVERRIDE' "$output"
[[ $(stat -c '%a' "$missing_fixture") == 600 ]]
echo 'E2E launcher dry-run substitution: PASS'
