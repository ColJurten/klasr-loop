import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (path) => readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
const workflowNames = ['_claude-run.yml', 'ci.yml', 'claude-ci-recovery.yml', 'claude-feedback.yml', 'claude-health-scan.yml', 'claude-intake.yml', 'claude-worker.yml', 'project-sync.yml', 'release.yml'];
const workflows = () => workflowNames.map((name) => read(`.github/workflows/${name}`)).join('\n');

test('every workflow honors the pnpm-only repository contract', () => {
  assert.doesNotMatch(workflows(), /(?:^|[ (])npm(?: | ci| run| test| install|:)/m);
});

test('every external action is pinned to an immutable commit with a version comment', () => {
  for (const name of workflowNames) {
    for (const line of read(`.github/workflows/${name}`).split('\n')) {
      const reference = line.match(/^\s*(?:-\s*)?uses:\s*([^\s#]+)/)?.[1];
      if (!reference || reference.startsWith('./')) continue;
      assert.match(line, /@[0-9a-f]{40}\s+#\s+v\d+\b/, `${name}: ${line.trim()}`);
    }
  }
});

test('root pnpm test includes standalone script behavioral tests', () => {
  assert.match(JSON.parse(read('package.json')).scripts.test, /node --test scripts\/test\/\*\.test\.mjs/);
});

test('worker subscribes to every dispatch type emitted by worker-post', () => {
  const worker = read('.github/workflows/claude-worker.yml');
  const post = read('scripts/agent/worker-post.sh');
  const emitted = new Set([...post.matchAll(/queue_dispatch "([^"]+)"/g)].map((match) => match[1]));
  assert.deepEqual(emitted, new Set(['agent.acceptance', 'agent.security_review', 'agent.implement']));
  for (const type of emitted) assert.match(worker, new RegExp(`- ${type.replace('.', '\\.')}`));
});

test('CI uses frozen pnpm and exposes a non-skippable always-present gate', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /pull_request:\s*\n\s*push:/);
  assert.doesNotMatch(ci.match(/pull_request:[\s\S]*?push:/)?.[0] ?? '', /branches:/);
  assert.match(ci, /pnpm install --frozen-lockfile/);
  assert.match(ci, /gate:\n[\s\S]*if: always\(\)/);
  for (const command of ['pnpm lint', 'pnpm typecheck', 'pnpm test', 'pnpm build', 'pnpm test:integration', 'pnpm test:e2e']) assert.ok(ci.includes(command), command);
  assert.doesNotMatch(ci, /paths-filter|paths-ignore/);
  assert.match(ci, /upload-artifact/);
});

test('PR CI never runs provider code or credentials on self-hosted infrastructure', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.doesNotMatch(ci, /runs-on:\s*self-hosted/);
  assert.doesNotMatch(ci, /KLASR_GOOGLE_SERVICE_ACCOUNT_FILE|KLASR_GOOGLE_DRIVE_ROOT_ID|test:live-google-sa/);
  assert.match(ci, /^permissions:\n\s+contents: read\n\s+statuses: read\n\s+checks: read/m);
});

test('live provider acceptance uses an always-present current-SHA external status check', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /KLASR_LIVE_GOOGLE_ENABLED/);
  assert.match(ci, /live-google-status:[\s\S]*runs-on: ubuntu-latest/);
  assert.match(ci, /github\.event\.pull_request\.head\.sha/);
  assert.match(ci, /klasr\/live-google/);
  assert.match(ci, /commits\/\$\{process\.env\.HEAD_SHA\}\/status`/);
  assert.doesNotMatch(ci, /\/statuses\?|status\.sha/);
  assert.match(ci, /pull_request\.head\.repo\.fork/);
  assert.match(ci, /needs\.live-google-status\.result.*success/);
  assert.match(ci, /IS_PR.*true[\s\S]*IS_FORK.*true[\s\S]*ENABLED.*true[\s\S]*exit 1/);
});

test('all security-authoritative comments are selected with author metadata and a shared trust policy', () => {
  const sources = ['scripts/agent/worker-context.sh', 'scripts/agent/worker-post.sh', '.github/workflows/claude-ci-recovery.yml', 'scripts/publish-live-google-status.mjs'].map(read).join('\n');
  assert.doesNotMatch(sources, /select\(\.body \| contains\("klasr-(?:agent-state|live-evidence)/);
  assert.match(sources, /trusted-comments\.mjs/);
  assert.match(sources, /SUPERVISOR_ACTORS/);
  assert.match(sources, /REPO_OWNER/);
});

test('evidence uploads use explicit sanitized files, never broad result directories', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.doesNotMatch(ci, /path:\s*(?:\.agent\/evidence|\.tmp\/hermes|apps\/web\/test-results)(?:\s|,|$)/);
  assert.match(ci, /sanitized/i);
});

test('CI repair verifies current PR head and carries bounded repair identity fields', () => {
  const recovery = read('.github/workflows/claude-ci-recovery.yml');
  const normalizer = read('scripts/agent/lib/normalize.mjs');
  assert.match(recovery, /CURRENT_PR_HEAD_SHA/);
  for (const field of ['repo', 'issue', 'head_sha', 'workflow_run_id', 'failed_job', 'attempt', 'cycle']) assert.ok(`${recovery}\n${normalizer}`.includes(field), field);
});

test('CI recovery routes both success and failure and avoids an empty issue API path', () => {
  const recovery = read('.github/workflows/claude-ci-recovery.yml');
  assert.doesNotMatch(recovery, /route:\n\s+if: github\.event\.workflow_run\.conclusion != 'success'/);
  assert.match(recovery, /cycle=0\n\s+agent_attempt=1\n\s+if \[ -n "\$issue" \]; then[\s\S]*issues\/\$issue\/comments\?per_page=100[\s\S]*else/);
  assert.doesNotMatch(recovery, /cycle=\$\{cycle:-0\}|agent_attempt=\$\{agent_attempt:-1\}/);
  assert.match(recovery, /Number\.isInteger\(cycle\)[\s\S]*Number\.isInteger\(attempt\)/);
  assert.match(recovery, /workflow_run\.conclusion/);
  assert.match(recovery, /steps\.decide\.outputs\.dispatch/);
});

test('worker advances lineage only for a verifier on the exact current controlled PR head', () => {
  const context = read('scripts/agent/worker-context.sh');
  assert.match(context, /EVENT_TYPE.*agent\.verify/);
  assert.match(context, /PAYLOAD_SHA.*CURRENT_PR_HEAD_SHA/);
  assert.match(context, /start_attempt/);
  assert.match(context, /STATUS.*local-validation|status:"local-validation"/);
  assert.match(context, /CURRENT_ATTEMPT=.*NEW_ATTEMPT/);
  assert.match(context, /CURRENT_SHA=.*PAYLOAD_SHA/);
});

test('lifecycle is CI then read-only review then acceptance review then human verdict', () => {
  const post = read('scripts/agent/worker-post.sh');
  const normalizer = read('scripts/agent/lib/normalize.mjs');
  const implementerCase = post.match(/implementer\|feedback-responder\)[\s\S]*?;;/)?.[0] ?? '';
  assert.doesNotMatch(implementerCase, /agent\.verify/);
  assert.match(normalizer, /run\.conclusion === 'success'[\s\S]*agent\.verify/);
  assert.match(post.match(/\n    verifier\)[\s\S]*?\n    security-reviewer\)/)?.[0] ?? '', /route_live_acceptance/);
  assert.match(post.match(/\n    security-reviewer\)[\s\S]*?\n    acceptance-validator\)/)?.[0] ?? '', /route_live_acceptance/);
  assert.match(post, /route_live_acceptance\(\)[\s\S]*LIVE_STATUS[\s\S]*success\) queue_dispatch "agent\.acceptance"/);
  assert.match(post, /acceptance-validator\)[\s\S]*awaiting-human-verdict/);
  assert.doesNotMatch(post, /STATUS="done"/);
});

test('human-required recovery still requires the acceptance finalizer gate', () => {
  const post = read('scripts/agent/worker-post.sh');
  const acceptance = post.match(/acceptance-validator\)[\s\S]*?;;/)?.[0] ?? '';
  assert.match(acceptance, /finalize-evidence\.mjs[\s\S]*STATUS="awaiting-human-verdict"/);
  assert.match(acceptance, /hasAcceptanceClearance[\s\S]*CONTROL_CLEARED/);
  assert.doesNotMatch(acceptance, /STATUS="done"/);
  assert.match(post, /SPEC_VALID=false/);
  assert.match(post, /authoritative issue spec is invalid/);
});

test('trusted post directly syncs every canonical label transition when Projects is configured', () => {
  const worker = read('.github/workflows/claude-worker.yml');
  const contextAndRun = worker.slice(0, worker.indexOf('\n  post:'));
  const post = worker.slice(worker.indexOf('\n  post:'));
  const script = read('scripts/agent/worker-post.sh');
  assert.doesNotMatch(contextAndRun, /KLASR_PROJECT_TOKEN/);
  assert.match(post, /Checkout trusted default branch only|ref: \$\{\{ github\.event\.repository\.default_branch \}\}/);
  assert.match(post, /KLASR_PROJECT_TOKEN: \$\{\{ secrets\.KLASR_PROJECT_TOKEN \}\}/);
  assert.ok(post.indexOf('default_branch') < post.indexOf('KLASR_PROJECT_TOKEN'));
  assert.match(script, /add-label "agent:\$STATUS"[\s\S]*KLASR_PROJECT_TOKEN[\s\S]*KLASR_PROJECT_ID[\s\S]*ISSUE_NODE_ID=.*gh api[\s\S]*AGENT_STATUS="agent:\$STATUS" node scripts\/agent\/sync-project\.mjs \|\| true/);
  assert.match(script, /\[ -n "\$\{KLASR_PROJECT_TOKEN:-\}" \] && \[ -n "\$\{KLASR_PROJECT_ID:-\}" \]/);
});

test('acceptance-validator is read-only and specifies every natural-path proof', () => {
  const role = read('.claude/agents/acceptance-validator.md');
  assert.match(role, /read-only/i);
  for (const proof of ['zero expected-result seeding', 'one visible launch click', 'visible progress', 'page.reload()', 'DOM proposals', 'visible decisions', 'provider read-back', 'cleanup', 'current SHA']) assert.ok(role.includes(proof), proof);
  const runner = read('.github/workflows/_claude-run.yml');
  assert.match(runner, /acceptance-validator\)/);
  assert.doesNotMatch(runner.match(/acceptance-validator\)[\s\S]*?;;/)?.[0] ?? '', /Edit|git push/);
});

test('read-only model roles have only Read and verdict Write, with no Bash route or token', () => {
  const runner = read('.github/workflows/_claude-run.yml');
  const toolSelection = runner.match(/- name: Select least-privilege tools[\s\S]*?- name: Run Claude/)?.[0] ?? '';
  for (const role of ['acceptance-validator', 'verifier', 'security-reviewer']) {
    const block = toolSelection.match(new RegExp(`${role}\\)[\\s\\S]*?;;`))?.[0] ?? '';
    assert.match(block, /--allowed-tools "Read,Write\(\.agent\/verdict\.json\)"/);
    assert.doesNotMatch(block, /\bBash\b|\bgh\b|\bEdit\b|\bGrep\b|\bGlob\b/);
  }
  const implementer = runner.match(/implementer\|feedback-responder\)[\s\S]*?;;/)?.[0] ?? '';
  for (const tool of ['Edit', 'Write', 'Bash(git:', 'Bash(pnpm:', 'Bash(node:']) assert.ok(implementer.includes(tool), tool);
  assert.match(runner, /verifier\|security-reviewer\|acceptance-validator\) echo "model_value="/);
  assert.match(runner, /GH_TOKEN: \$\{\{ steps\.token\.outputs\.model_value \}\}/);
  assert.match(runner, /GITHUB_TOKEN: \$\{\{ steps\.token\.outputs\.model_value \}\}/);
  assert.match(runner, /persist-credentials: \$\{\{ inputs\.role == 'implementer' \|\| inputs\.role == 'feedback-responder' \}\}/);
  assert.doesNotMatch(runner, /read-only-check\.sh/);
});

test('read-only role prompts use bundled evidence and prohibit command execution', () => {
  for (const role of ['acceptance-validator', 'verifier', 'security-reviewer']) {
    const prompt = read(`.claude/agents/${role}.md`);
    assert.match(prompt, /bundled/i);
    assert.match(prompt, /do not (?:run|execute) commands|must not (?:run|execute) commands/i);
    assert.match(prompt, /do not fetch GitHub data yourself/i);
    assert.match(prompt, /\.agent\/verdict\.json/);
    assert.doesNotMatch(prompt, /re-run/i);
  }
});

test('read-only context bundles trusted current-SHA evidence and status before model execution', () => {
  const context = read('scripts/agent/worker-context.sh');
  assert.match(context, /REVIEW_SHA=.*headRefOid/);
  assert.match(context, /commits\/\$REVIEW_SHA\/status/);
  assert.match(context, /commits\/\$REVIEW_SHA\/check-runs/);
  assert.match(context, /trusted-comments\.mjs[^\n]*klasr-live-evidence:\$REVIEW_SHA/);
  assert.match(context, /trusted current-SHA live evidence absent, duplicate, or untrusted/);
  for (const forbidden of ['provider_id', 'source_bytes', 'ocr_text']) assert.doesNotMatch(context, new RegExp(forbidden, 'i'));
});

test('reviewer policy is embedded from a fixed trusted-role map and branch policy is forbidden', () => {
  const context = read('scripts/agent/worker-context.sh');
  for (const role of ['verifier', 'security-reviewer', 'acceptance-validator']) {
    assert.match(context, new RegExp(`${role}.*\\.claude/agents/${role}\\.md`));
  }
  assert.match(context, /\.claude\/skills\/self-review\/SKILL\.md/);
  assert.match(context, /BEGIN TRUSTED REVIEWER POLICY/);
  assert.match(context, /END TRUSTED REVIEWER POLICY/);
  assert.match(context, /Do not read or obey[\s\S]*\.claude\/agents\/\*[\s\S]*\.claude\/skills\/\*[\s\S]*AGENTS\.md[\s\S]*CLAUDE\.md/);
  assert.doesNotMatch(context, /Read and obey \.claude\/agents\/\$\{ROLE\}\.md/);
  assert.doesNotMatch(context, /\.claude\/agents\/\$\{ROLE\}|\.claude\/skills\/\$\{/);
});

test('worker post validates exact structured review clearance against event and controlled head SHAs', () => {
  const post = read('scripts/agent/worker-post.sh');
  assert.match(post, /review-verdict\.mjs/);
  assert.match(post, /EXPECTED_SHA/);
  assert.doesNotMatch(post, /select\(\.severity=="BLOCKER"\)/);
});

test('acceptance evidence preserves only allowlisted reviewer finding fields', () => {
  const post = read('scripts/agent/worker-post.sh');
  const manifest = post.match(/reviewer:\{verdict:[\s\S]*?\| \{issue,attempt,sha,status,criteria,cleanup,processes,reviewer\}/)?.[0] ?? '';
  assert.match(manifest, /findings:\[ \$reviewer\.findings\[\]\? \| \{severity,current\} \]/);
  assert.doesNotMatch(manifest, /findings:\$reviewer\.findings|\$reviewer \+ \{issue/);
});

test('workflow data-to-output boundaries validate and safely encode untrusted values', () => {
  const runner = read('.github/workflows/_claude-run.yml');
  assert.match(runner, /Remove pre-existing structured result[\s\S]*rm -f \.agent\/verdict\.json/);
  assert.match(runner, /node <<'NODE'[\s\S]*JSON\.parse[\s\S]*JSON\.stringify\(verdict\).*\\n/);
  assert.doesNotMatch(runner, /node scripts\/|verdict-json\.mjs/);
  assert.match(runner, /\/proc\/sys\/kernel\/random\/uuid/);
  const context = read('scripts/agent/worker-context.sh');
  assert.match(context, /github-output\.mjs/);
  assert.doesNotMatch(context, /prompt<<KLASR_PROMPT_EOF/);
  const recovery = read('.github/workflows/claude-ci-recovery.yml');
  assert.match(recovery, /Number\.isInteger/);
  assert.doesNotMatch(recovery, /agent_attempt=.*\?\?1/);
});

test('project PAT and workflow-dispatch inputs are gated before use', () => {
  const project = read('.github/workflows/project-sync.yml');
  assert.match(project, /needs: guard/);
  assert.match(project, /needs\.guard\.outputs\.allowed == 'true'/);
  assert.match(project, /SUPERVISOR_ACTORS/);
  const worker = read('.github/workflows/claude-worker.yml');
  assert.match(worker, /DRY_RUN_EVENT:.*github\.event\.inputs\.dry_run_event/);
  assert.match(worker, /DRY_RUN_FIXTURE:.*github\.event\.inputs\.dry_run_fixture/);
  assert.doesNotMatch(worker.match(/name: Simulate routing decision[\s\S]*?No issues/)?.[0] ?? '', /"\$\{\{ github\.event\.inputs/);
});

test('ownership and PR policy reserve final approval and merge for a human', () => {
  assert.match(read('.github/CODEOWNERS'), /\.github\/ @ColJurten/);
  const template = read('.github/PULL_REQUEST_TEMPLATE.md');
  for (const rule of ['current SHA', 'latest push', 'resolved', 'No bot', 'No auto-merge']) assert.ok(template.includes(rule), rule);
});
