#!/usr/bin/env bash
# Worker post job: verdict handling, state transition, single control-comment
# upsert, label sync, explicit next-stage dispatch.
# Env: REPO, TASK, ROLE, BRANCH, CYCLE, EVENT_KEY, RUN_OUTCOME, VERDICT_JSON, RUN_IDENTITY, GH_TOKEN, MAX_CYCLES
set -euo pipefail
MAX_CYCLES="${MAX_CYCLES:-5}"

QUEUED_DISPATCH=""
queue_dispatch() { # $1 = type, extra jq-merged fields in $2 (json)
  [ -z "$QUEUED_DISPATCH" ] || { STATUS="human-required"; QUEUED_DISPATCH=""; return; }
  QUEUED_DISPATCH=$(jq -n --arg t "$1" --arg key "internal:${GITHUB_RUN_ID}:$1" --argjson task "$TASK" \
    --argjson extra "${2:-{}}" \
    --argjson attempt "$ATTEMPT" --arg sha "$HEAD_SHA" \
    '{event_type:$t, client_payload:({version:1, event_key:$key, task:$task, actor:"worker", attempt:$attempt, head_sha:$sha} + $extra)}')
}

route_live_acceptance() {
  STATUS="live-acceptance"
  if [ "$LIVE_REQUIRED" != "true" ]; then
    queue_dispatch "agent.acceptance" "$(jq -n --arg b "$BRANCH" '{branch:$b}')"
    return
  fi
  LIVE_STATUS=$(gh api "repos/$REPO/commits/$HEAD_SHA/statuses" \
    --jq '[.[] | select(.context=="klasr/live-google")][0].state // "missing"' 2>/dev/null || echo "lookup-failed")
  case "$LIVE_STATUS" in
    success) queue_dispatch "agent.acceptance" "$(jq -n --arg b "$BRANCH" '{branch:$b}')" ;;
    pending|missing) ;;
    *) STATUS="human-required" ;;
  esac
}

STATUS="" ; NEW_CYCLE="$CYCLE" ; PR_NUM="" ; SPEC_VALID=false ; SECURITY_REQUIRED=false ; LIVE_REQUIRED=false ; ESCALATION="" ; CLEARANCE_JSON='{}'

# Load current state before deciding; it is also the transition source and lineage authority.
CONTROL_COMMENT_ID=$(gh api "repos/$REPO/issues/$TASK/comments" --paginate \
  --jq '[.[] | select(.body | contains("klasr-agent-state"))][0].id' 2>/dev/null || true)
if [ -n "$CONTROL_COMMENT_ID" ] && [ "$CONTROL_COMMENT_ID" != "null" ]; then
  gh api "repos/$REPO/issues/comments/$CONTROL_COMMENT_ID" --jq .body > /tmp/control.md
else
  printf '' > /tmp/control.md; CONTROL_COMMENT_ID=""
fi
readarray -t CONTROL_VALUES < <(node -e "import('./scripts/agent/lib/control.mjs').then(async m=>{const {readFileSync}=await import('node:fs');const c=m.parseControl(readFileSync('/tmp/control.md','utf8'))??m.emptyControl(Number(process.env.TASK));console.log(c.status);console.log(c.lifecycle.attempt);console.log(c.evidence.sha??'')})")
PREVIOUS_STATUS="${CONTROL_VALUES[0]}"; ATTEMPT="${CONTROL_VALUES[1]}"; PREVIOUS_SHA="${CONTROL_VALUES[2]}"
HEAD_SHA=$(gh api "repos/$REPO/commits/$BRANCH" --jq .sha 2>/dev/null || git rev-parse HEAD)

# Does the validated spec require a security review?
gh api "repos/$REPO/issues/$TASK" --jq .body > /tmp/issue-body.md || true
if node scripts/agent/validate-spec.mjs /tmp/issue-body.md > /tmp/spec.json 2>/dev/null; then
  SPEC_VALID=true
  SECURITY_REQUIRED=$(jq -r '.spec.security_review_required // false' /tmp/spec.json)
  LIVE_REQUIRED=$(jq -r '[.spec.acceptance_criteria[]? | select(.evidence_class == "live-provider")] | length > 0' /tmp/spec.json)
fi
PR_NUM=$(gh pr list --repo "$REPO" --head "$BRANCH" --state open --json number --jq '.[0].number' 2>/dev/null || true)
[ "$PR_NUM" = "null" ] && PR_NUM=""

if [ "$SPEC_VALID" != "true" ]; then
  STATUS="human-required"
  ESCALATION="Agent run stopped because the authoritative issue spec is invalid; human attention required. <!-- klasr-agent-status -->"
elif [ "$RUN_OUTCOME" != "success" ]; then
  STATUS="human-required"
  if [ "$ROLE" = "verifier" ] || [ "$ROLE" = "security-reviewer" ]; then
    CLEARANCE_JSON=$(node -e "import('./scripts/agent/lib/control.mjs').then(m=>process.stdout.write(JSON.stringify(m.clearancePatch(process.argv[1],false,process.argv[2],Number(process.argv[3]),process.argv[4]==='true'))))" "$ROLE" "$HEAD_SHA" "$ATTEMPT" "$SECURITY_REQUIRED")
  fi
  ESCALATION="Agent run (${ROLE}) failed at the workflow level; human attention required. <!-- klasr-agent-status -->"
else
  case "$ROLE" in
    spec-writer)
      if [ "$(jq -r .ok /tmp/spec.json 2>/dev/null)" = "true" ]; then STATUS="spec-ready"; else STATUS="needs-spec"; fi ;;
    implementer|feedback-responder)
      NEW_CYCLE=$((CYCLE + 1))
      STATUS="local-validation"
      if [ "$RUN_IDENTITY" != "app" ]; then
        STATUS="human-required"
        ESCALATION="Agent implementation could not trigger CI; human attention required. <!-- klasr-agent-status -->"
      fi ;;
    verifier)
      VERDICT=$(jq -r '.verdict // empty' <<< "${VERDICT_JSON:-}" 2>/dev/null || true)
      case "$VERDICT" in PASS|REQUEST_CHANGES|BLOCKED) ;; *) VERDICT="BLOCKED" ;; esac
      CLEARANCE_JSON=$(node -e "import('./scripts/agent/lib/control.mjs').then(m=>process.stdout.write(JSON.stringify(m.clearancePatch('verifier',process.argv[1]==='PASS',process.argv[2],Number(process.argv[3]),process.argv[4]==='true'))))" "$VERDICT" "$HEAD_SHA" "$ATTEMPT" "$SECURITY_REQUIRED")
      STATUS=$(node -e "import('./scripts/agent/lib/state-machine.mjs').then(m=>console.log(m.afterVerification('$VERDICT', $CYCLE, $MAX_CYCLES)))")
      if [ "$VERDICT" = "PASS" ] && [ "$SECURITY_REQUIRED" = "true" ]; then
        STATUS="code-review"
        queue_dispatch "agent.security_review" "$(jq -n --arg b "$BRANCH" '{branch:$b}')"
      elif [ "$VERDICT" = "PASS" ]; then
        route_live_acceptance
      elif [ "$STATUS" = "changes-requested" ]; then
        queue_dispatch "agent.implement" "$(jq -n --arg b "$BRANCH" '{branch:$b, revision:true}')"
      fi
      ;;
    security-reviewer)
      BLOCKING=$(jq -er 'if (.findings | type) == "array" then [.findings[] | select(.severity=="BLOCKER")] | length else error("missing findings") end' <<< "${VERDICT_JSON:-{}}" 2>/dev/null || echo 1)
      CLEARANCE_JSON=$(node -e "import('./scripts/agent/lib/control.mjs').then(m=>process.stdout.write(JSON.stringify(m.clearancePatch('security-reviewer',process.argv[1]==='0',process.argv[2],Number(process.argv[3]),true))))" "${BLOCKING:-0}" "$HEAD_SHA" "$ATTEMPT")
      if [ "${BLOCKING:-0}" -gt 0 ]; then STATUS="human-required"; else route_live_acceptance; fi ;;
    acceptance-validator)
      VERDICT=$(jq -r '.verdict // empty' <<< "${VERDICT_JSON:-}" 2>/dev/null || true)
      if [ "$VERDICT" = "PASS" ]; then
        CONTROL_CLEARED=$(node -e "import('./scripts/agent/lib/control.mjs').then(async m=>{const {readFileSync}=await import('node:fs');const c=m.parseControl(readFileSync('/tmp/control.md','utf8'));process.stdout.write(String(m.hasAcceptanceClearance(c,process.argv[1],Number(process.argv[2]),process.argv[3]==='true')))})" "$HEAD_SHA" "$ATTEMPT" "$SECURITY_REQUIRED")
        MARKER="klasr-live-evidence:$HEAD_SHA"
        if ! gh api "repos/$REPO/issues/$TASK/comments" --paginate --jq "[.[] | select(.body | contains(\"$MARKER\"))] | if length == 1 then .[0].body else error(\"expected one evidence comment\") end" > /tmp/evidence-comment.md 2>/dev/null; then
          printf '' > /tmp/evidence-comment.md
        fi
        sed -n '/^```json$/,/^```$/p' /tmp/evidence-comment.md | sed '1d;$d' > /tmp/live-manifest.json || true
        if ! jq --argjson reviewer "$VERDICT_JSON" --argjson issue "$TASK" --argjson attempt "$ATTEMPT" --arg sha "$HEAD_SHA" '
          .spec as $spec | $reviewer + {issue:$issue,attempt:$attempt,sha:$sha,status:"current",
          cleanup:{passed:($reviewer.cleanup.passed == true),proof:$reviewer.cleanup.proof},
          processes:{active:($reviewer.processes.active // []),orphaned:($reviewer.processes.orphaned // [])},
          reviewer:{verdict:$reviewer.verdict,approved:$reviewer.approved,sha:$reviewer.sha,edited_files:$reviewer.reviewerEditedFiles}}
          | {issue,attempt,sha,status,criteria,cleanup,processes,reviewer}' /tmp/spec.json > /tmp/final-manifest.json; then
          STATUS="human-required"
        elif [ "$CONTROL_CLEARED" = "true" ] \
          && { [ "$LIVE_REQUIRED" != "true" ] || jq -e --argjson issue "$TASK" --argjson attempt "$ATTEMPT" --arg sha "$HEAD_SHA" '.issue==$issue and .attempt==$attempt and .sha==$sha and .status=="PASS"' /tmp/live-manifest.json >/dev/null; } \
          && jq '.spec' /tmp/spec.json > /tmp/final-spec.json \
          && node scripts/agent/finalize-evidence.mjs /tmp/final-spec.json /tmp/final-manifest.json "$TASK" "$ATTEMPT" "$HEAD_SHA"; then
          STATUS="awaiting-human-verdict"
          FINAL_EVIDENCE_MARKER="klasr-live-evidence:$HEAD_SHA"
        else STATUS="human-required"; fi
      elif [ "$VERDICT" = "REQUEST_CHANGES" ] && jq -e '[.findings[]? | select(.kind=="deterministic-product" and .current==true)] | length > 0' <<< "$VERDICT_JSON" >/dev/null; then
        STATUS="changes-requested"; queue_dispatch "agent.implement" "$(jq -n --arg b "$BRANCH" '{branch:$b, revision:true}')"
      else STATUS="human-required"; fi ;;
  esac
fi

if ! TRANSITION_ERROR=$(node -e "import('./scripts/agent/lib/state-machine.mjs').then(m=>m.assertTransition(process.argv[1],process.argv[2])).catch(e=>{console.error(e.message);process.exit(1)})" "$PREVIOUS_STATUS" "$STATUS" 2>&1); then
  ESCALATION="Illegal agent transition ${PREVIOUS_STATUS} -> ${STATUS}; human attention required. <!-- klasr-agent-status -->"
  STATUS="human-required"
  QUEUED_DISPATCH=""
fi

# --- Control comment upsert (single comment, updated in place) ---
NEW_ATTEMPT="$ATTEMPT"
if { [ "$ROLE" = "implementer" ] || [ "$ROLE" = "feedback-responder" ]; } && [ -n "$PREVIOUS_SHA" ] && [ "$HEAD_SHA" != "$PREVIOUS_SHA" ]; then NEW_ATTEMPT=$((ATTEMPT + 1)); fi
BASE_PATCH=$(jq -n --argjson task "$TASK" --arg s "$STATUS" --arg b "$BRANCH" --argjson c "$NEW_CYCLE" \
  --argjson pr "${PR_NUM:-null}" --argjson attempt "$ATTEMPT" --arg sha "$HEAD_SHA" --arg manifest "${FINAL_EVIDENCE_MARKER:-}" \
  --argjson clearance "$CLEARANCE_JSON" \
  '{task_id:$task, status:$s, branch:$b, cycle:$c, pull_request:$pr, attempt:$attempt}
   + (if ($clearance | length) == 0 then {} else {clearance:$clearance} end)
   + (if $manifest == "" then {} else {evidence:{sha:$sha,manifest:$manifest,status:"current"},human_verdict:"pending"} end)')
PATCH=$(node -e "import('./scripts/agent/lib/control.mjs').then(m=>process.stdout.write(JSON.stringify(m.shapeWorkerPatch(process.argv[1],JSON.parse(process.argv[2]),process.argv[3],process.argv[4]||null,Number(process.argv[5])))))" "$ROLE" "$BASE_PATCH" "$HEAD_SHA" "$PREVIOUS_SHA" "$NEW_ATTEMPT")
node scripts/agent/update-control-state.mjs "$([ -s /tmp/control.md ] && echo /tmp/control.md || echo -)" "$EVENT_KEY" "$PATCH" > /tmp/new-control.md
if [ -n "$CONTROL_COMMENT_ID" ]; then
  gh api --method PATCH "repos/$REPO/issues/comments/$CONTROL_COMMENT_ID" -f body="$(cat /tmp/new-control.md)" > /dev/null
else
  gh issue comment "$TASK" --repo "$REPO" --body-file /tmp/new-control.md > /dev/null
fi

# --- Label sync: durable control is authoritative and is written first. ---
CURRENT=$(gh issue view "$TASK" --repo "$REPO" --json labels --jq '[.labels[].name | select(startswith("agent:"))] | join(",")' 2>/dev/null || true)
IFS=',' read -ra OLD <<< "$CURRENT"
for label in "${OLD[@]}"; do [ -n "$label" ] && gh issue edit "$TASK" --repo "$REPO" --remove-label "$label" 2>/dev/null || true; done
gh api "repos/$REPO/labels" -f name="agent:$STATUS" -f color="7F77DD" 2>/dev/null || true
gh issue edit "$TASK" --repo "$REPO" --add-label "agent:$STATUS" 2>/dev/null || true
# project-sync.yml is the single fail-safe Projects v2 synchronization path.

[ -z "$ESCALATION" ] || gh issue comment "$TASK" --repo "$REPO" --body "$ESCALATION" || true
if [ -n "$QUEUED_DISPATCH" ]; then
  gh api "repos/$REPO/dispatches" --input - <<< "$QUEUED_DISPATCH"
  echo "::notice::dispatched $(jq -r .event_type <<< "$QUEUED_DISPATCH")"
fi
echo "::notice::task #$TASK -> agent:$STATUS (cycle $NEW_CYCLE)"
