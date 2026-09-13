#!/usr/bin/env bash
set -u
root=$(cd "$(dirname "$0")/.." && pwd)
cd "$root"
: "${KLASR_ITEM1_TASK:?KLASR_ITEM1_TASK is required}"
: "${KLASR_ITEM1_ATTEMPT:?KLASR_ITEM1_ATTEMPT is required}"
: "${KLASR_ITEM1_RUN:?KLASR_ITEM1_RUN is required}"
: "${KLASR_ITEM1_EVIDENCE_FILE:?KLASR_ITEM1_EVIDENCE_FILE is required}"
node --input-type=module -e "import('./apps/web/playwright-runtime.ts').then(({ resolveItem1EvidenceProvenance }) => resolveItem1EvidenceProvenance(process.env))" || exit $?
credential=.tmp/hermes/ux-clarity/.item1-staging-login.json
cleanup() {
  rm -f "$credential"
  unset NEXTAUTH_SECRET GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET
}
trap cleanup EXIT INT TERM
if [ ! -f "$credential" ]; then
  echo 'provider_result=human-gate protected-login-file-missing'
  exit 2
fi
set -a
. apps/web/.env.local
set +a
KLASR_ITEM1_LIVE=true \
pnpm --filter @klasr/web exec playwright test e2e/item-1-live.spec.ts --project=desktop --trace=off
status=$?
if [ "$status" -eq 0 ]; then
  echo "provider_result=pass sanitized_evidence=$KLASR_ITEM1_EVIDENCE_FILE"
else
  echo 'provider_result=failed-or-human-gate inspect_sanitized_evidence=true'
fi
exit "$status"
