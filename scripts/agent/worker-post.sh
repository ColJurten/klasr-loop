#!/usr/bin/env bash
# Worker post job: verdict handling, state transition, single control-comment
# upsert, label sync, explicit next-stage dispatch.
# Env: REPO, TASK, ROLE, BRANCH, CYCLE, EVENT_KEY, RUN_OUTCOME, VERDICT_JSON, GH_TOKEN, MAX_CYCLES
set -euo pipefail
MAX_CYCLES="${MAX_CYCLES:-5}"

dispatch_next() { # $1 = type, extra jq-merged fields in $2 (json)
  local payload
  payload=$(jq -n --arg t "$1" --arg key "internal:${GITHUB_RUN_ID}:$1" --argjson task "$TASK" \
    --argjson extra "${2:-{}}" \
    '{event_type:$t, client_payload:({version:1, event_key:$key, task:$task, actor:"worker"} + $extra)}')
  gh api "repos/$REPO/dispatches" --input - <<< "$payload"
  echo "::notice::dispatched $1"
}

STATUS="" ; NEW_CYCLE="$CYCLE" ; PR_NUM="" ; SECURITY_REQUIRED=false

# Does the validated spec require a security review?
gh api "repos/$REPO/issues/$TASK" --jq .body > /tmp/issue-body.md || true
if node scripts/agent/validate-spec.mjs /tmp/issue-body.md > /tmp/spec.json 2>/dev/null; then
  SECURITY_REQUIRED=$(jq -r '.spec.security_review_required // false' /tmp/spec.json)
fi
PR_NUM=$(gh pr list --repo "$REPO" --head "$BRANCH" --state open --json number --jq '.[0].number' 2>/dev/null || true)
[ "$PR_NUM" = "null" ] && PR_NUM=""

if [ "$RUN_OUTCOME" != "success" ]; then
  STATUS="human-required"
  gh issue comment "$TASK" --repo "$REPO" --body "Agent run (${ROLE}) failed at the workflow level — human attention required. Run: ${GITHUB_SERVER_URL}/${REPO}/actions/runs/${GITHUB_RUN_ID} <!-- klasr-agent-status -->" || true
else
  case "$ROLE" in
    spec-writer)
      if [ "$(jq -r .ok /tmp/spec.json 2>/dev/null)" = "true" ]; then STATUS="spec-ready"; else STATUS="needs-spec"; fi ;;
    implementer|feedback-responder)
      NEW_CYCLE=$((CYCLE + 1))
      STATUS="reviewing"
      dispatch_next "agent.verify" "$(jq -n --arg b "$BRANCH" '{branch:$b}')" ;;
    verifier)
      VERDICT=$(jq -r '.verdict // empty' <<< "${VERDICT_JSON:-}" 2>/dev/null || true)
      [ -z "$VERDICT" ] && VERDICT="BLOCKED"
      STATUS=$(node -e "import('./scripts/agent/lib/state-machine.mjs').then(m=>console.log(m.afterVerification('$VERDICT', $CYCLE, $MAX_CYCLES)))")
      if [ "$VERDICT" = "PASS" ] && [ "$SECURITY_REQUIRED" = "true" ]; then
        dispatch_next "agent.security_review" "$(jq -n --arg b "$BRANCH" '{branch:$b}')"
      elif [ "$STATUS" = "running" ]; then
        dispatch_next "agent.implement" "$(jq -n --arg b "$BRANCH" '{branch:$b, revision:true}')"
      fi
      if [ "$STATUS" = "awaiting-supervisor" ] && [ -n "$PR_NUM" ]; then
        gh pr ready "$PR_NUM" --repo "$REPO" 2>/dev/null || true
      fi ;;
    security-reviewer)
      BLOCKING=$(jq -r '[.findings[]? | select(.severity=="BLOCKER")] | length' <<< "${VERDICT_JSON:-{}}" 2>/dev/null || echo 0)
      if [ "${BLOCKING:-0}" -gt 0 ]; then STATUS="human-required"; else STATUS="awaiting-supervisor"; fi ;;
  esac
fi

# --- Label sync: exactly one agent:<status> label ---
CURRENT=$(gh issue view "$TASK" --repo "$REPO" --json labels --jq '[.labels[].name | select(startswith("agent:"))] | join(",")')
IFS=',' read -ra OLD <<< "$CURRENT"
for label in "${OLD[@]}"; do [ -n "$label" ] && gh issue edit "$TASK" --repo "$REPO" --remove-label "$label" 2>/dev/null || true; done
gh api "repos/$REPO/labels" -f name="agent:$STATUS" -f color="7F77DD" 2>/dev/null || true
gh issue edit "$TASK" --repo "$REPO" --add-label "agent:$STATUS" 2>/dev/null || true

# --- Control comment upsert (single comment, updated in place) ---
CONTROL_COMMENT_ID=$(gh api "repos/$REPO/issues/$TASK/comments" --paginate \
  --jq '[.[] | select(.body | contains("klasr-agent-state"))][0].id' 2>/dev/null || true)
if [ -n "$CONTROL_COMMENT_ID" ] && [ "$CONTROL_COMMENT_ID" != "null" ]; then
  gh api "repos/$REPO/issues/comments/$CONTROL_COMMENT_ID" --jq .body > /tmp/control.md
else
  printf '' > /tmp/control.md; CONTROL_COMMENT_ID=""
fi
PATCH=$(jq -n --argjson task "$TASK" --arg s "$STATUS" --arg b "$BRANCH" --argjson c "$NEW_CYCLE" \
  --argjson pr "${PR_NUM:-null}" '{task_id:$task, status:$s, branch:$b, cycle:$c, pull_request:$pr}')
node scripts/agent/update-control-state.mjs "$([ -s /tmp/control.md ] && echo /tmp/control.md || echo -)" "$EVENT_KEY" "$PATCH" > /tmp/new-control.md
if [ -n "$CONTROL_COMMENT_ID" ]; then
  gh api --method PATCH "repos/$REPO/issues/comments/$CONTROL_COMMENT_ID" -f body="$(cat /tmp/new-control.md)" > /dev/null
else
  gh issue comment "$TASK" --repo "$REPO" --body-file /tmp/new-control.md > /dev/null
fi
echo "::notice::task #$TASK -> agent:$STATUS (cycle $NEW_CYCLE)"
