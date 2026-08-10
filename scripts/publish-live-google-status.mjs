import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { liveEvidenceEventKey } from './agent/lib/evidence.mjs';
import { pullRequestMatchesIssue } from './agent/lib/pull-request.mjs';
import { trustedComment } from './agent/lib/trusted-comments.mjs';

const EXPECTED_SHA = process.env.EXPECTED_SHA ?? execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const CONTEXT = 'klasr/live-google';
const RESULT_KEYS = ['service_account_auth', 'drive_listing', 'drive_download_ocr', 'proposal_review', 'confirm_mutation', 'correction_mutation', 'reject_mutation', 'terminal_no_reenqueue', 'desktop_browser', 'mobile_390_browser', 'launch_completion', 'fresh_provider_metadata'];
const CLEANUP_KEYS = ['fixture_restored', 'created_items_removed', 'tenant_cleaned'];
const PROCESS_KEYS = ['apps_stopped', 'no_orphans'];
const dryRun = process.argv.includes('--dry-run');
const marker = (sha) => `<!-- klasr-live-evidence:${sha} -->`;
const input = process.argv.find((arg) => !arg.startsWith('--') && arg !== process.argv[0] && arg !== process.argv[1]);

try {
  if (!/^[0-9a-f]{40}$/.test(EXPECTED_SHA)) throw new Error('Expected SHA is invalid');
  const manifest = JSON.parse(input === '-' ? readFileSync(0, 'utf8') : readFileSync(input ?? '.tmp/hermes/drive-reference-organization-flow/manifest.sanitized.json', 'utf8'));
  exactKeys(manifest, ['version', 'identity', 'sha', 'issue', 'attempt', 'status', 'results', 'cleanup', 'processes']);
  exactKeys(manifest.results, RESULT_KEYS); exactKeys(manifest.cleanup, CLEANUP_KEYS); exactKeys(manifest.processes, PROCESS_KEYS);
  if (manifest.version !== 1 || manifest.identity !== 'Google service account non-production acceptance' || !['PASS', 'FAIL'].includes(manifest.status)) throw new Error('Manifest labels are invalid');
  if (!/^[0-9a-f]{40}$/.test(manifest.sha) || manifest.sha !== EXPECTED_SHA) throw new Error('Manifest SHA is not the approved current head');
  if (!Number.isInteger(manifest.issue) || manifest.issue < 1 || !Number.isInteger(manifest.attempt) || manifest.attempt < 1) throw new Error('Manifest lineage is invalid');

  const complete = manifest.status === 'PASS' && RESULT_KEYS.every((key) => manifest.results[key] === true)
    && CLEANUP_KEYS.every((key) => manifest.cleanup[key] === true) && PROCESS_KEYS.every((key) => manifest.processes[key] === true);
  const repository = process.env.GITHUB_REPOSITORY ?? (dryRun ? 'dry-run/repository' : required('GITHUB_REPOSITORY'));
  const headers = dryRun ? null : { accept: 'application/vnd.github+json', authorization: `Bearer ${required('GH_TOKEN')}`, 'content-type': 'application/json', 'x-github-api-version': '2022-11-28' };
  const currentHead = dryRun ? process.env.DRY_RUN_CURRENT_HEAD_SHA : await currentPrHead(repository, manifest.sha, manifest.issue, process.env.EXPECTED_BRANCH, headers);
  if (currentHead !== manifest.sha) throw new Error('Manifest SHA is not the current PR head');

  const status = { state: complete ? 'success' : 'failure', context: CONTEXT, description: complete ? 'Sanitized live Google evidence passed' : 'Sanitized live Google evidence failed' };
  const comment = `${marker(manifest.sha)}\n\`\`\`json\n${JSON.stringify(manifest)}\n\`\`\``;
  const dispatch = { event_type: 'agent.acceptance', client_payload: { version: 1, event_key: liveEvidenceEventKey({ ...manifest, status: complete ? 'PASS' : 'FAIL' }), task: manifest.issue, attempt: manifest.attempt, head_sha: manifest.sha, actor: 'trusted-vps' } };
  let rerun; let successDispatch;
  if (complete) {
    const runs = dryRun ? JSON.parse(process.env.DRY_RUN_WORKFLOW_RUNS ?? '[]') : await apiJson(`https://api.github.com/repos/${repository}/actions/workflows/ci.yml/runs?head_sha=${manifest.sha}&status=completed&per_page=100`, headers);
    const latest = (runs.workflow_runs ?? runs).filter((run) => run.head_sha === manifest.sha).sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
    if (!latest) throw new Error('No completed CI workflow run matches the current head SHA');
    if (latest.conclusion === 'success') successDispatch = dispatch;
    else if (latest.conclusion === 'failure') {
      const pending = dryRun ? latest.live_evidence_pending === true : await failedForPendingLiveEvidence(repository, latest.id, headers);
      if (!pending) throw new Error('Latest CI failure was not the pending live-evidence gate');
      rerun = { workflow_run_id: latest.id, endpoint: `/repos/${repository}/actions/runs/${latest.id}/rerun-failed-jobs` };
    } else throw new Error(`Latest CI run has unsupported conclusion: ${latest.conclusion}`);
  }
  const actions = { comment: { issue: manifest.issue, marker: marker(manifest.sha), body: comment }, status, ...(complete ? (rerun ? { rerun } : { success_dispatch: successDispatch }) : { failure_dispatch: dispatch }) };
  if (dryRun) process.stdout.write(`${JSON.stringify(actions)}\n`);
  else {
    await upsertComment(repository, manifest.issue, marker(manifest.sha), comment, headers);
    await api(`https://api.github.com/repos/${repository}/statuses/${manifest.sha}`, { method: 'POST', headers, body: JSON.stringify(status) }, 'status publish');
    if (rerun) await api(`https://api.github.com${rerun.endpoint}`, { method: 'POST', headers }, 'failed-job rerun');
    else if (successDispatch) await api(`https://api.github.com/repos/${repository}/dispatches`, { method: 'POST', headers, body: JSON.stringify(successDispatch) }, 'success acceptance dispatch');
    else await api(`https://api.github.com/repos/${repository}/dispatches`, { method: 'POST', headers, body: JSON.stringify(dispatch) }, 'failure acceptance dispatch');
  }
  if (!complete) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`Live status was not published: ${error.message}\n`); process.exitCode = 1;
}

async function currentPrHead(repository, sha, issue, expectedBranch, headers) {
  const pulls = await apiJson(`https://api.github.com/repos/${repository}/commits/${sha}/pulls`, headers);
  const pr = pulls.find((item) => pullRequestMatchesIssue(item, sha, issue, expectedBranch, repository));
  return pr?.head?.sha;
}
async function failedForPendingLiveEvidence(repository, runId, headers) {
  const jobs = await apiJson(`https://api.github.com/repos/${repository}/actions/runs/${runId}/jobs?per_page=100`, headers);
  return jobs.jobs?.some((job) => job.steps?.some((step) => step.name === 'Require trusted live evidence for the current internal PR head' && step.conclusion === 'failure')) === true;
}
async function upsertComment(repository, issue, mark, body, headers) {
  const comments = await apiJsonPages(`https://api.github.com/repos/${repository}/issues/${issue}/comments?per_page=100`, headers);
  const existing = trustedComment(comments, mark, {
    supervisors: process.env.SUPERVISOR_ACTORS,
    repositoryOwner: repository.split('/')[0],
    bots: ['github-actions[bot]', 'claude[bot]', ...(process.env.TRUSTED_BOT_ACTORS ?? '').split(',').map((value) => value.trim()).filter(Boolean)],
  });
  await api(existing ? `https://api.github.com/repos/${repository}/issues/comments/${existing.id}` : `https://api.github.com/repos/${repository}/issues/${issue}/comments`, { method: existing ? 'PATCH' : 'POST', headers, body: JSON.stringify({ body }) }, 'comment publish');
}
async function apiJson(url, headers) { const response = await fetch(url, { headers }); if (!response.ok) throw new Error(`GitHub lookup failed (${response.status})`); return response.json(); }
async function apiJsonPages(url, headers) {
  const values = [];
  while (url) {
    const response = await fetch(url, { headers });
    if (!response.ok) throw new Error(`GitHub lookup failed (${response.status})`);
    values.push(...await response.json());
    url = response.headers.get('link')?.match(/<([^>]+)>; rel="next"/)?.[1];
  }
  return values;
}
async function api(url, options, operation) { const response = await fetch(url, options); if (!response.ok) throw new Error(`GitHub ${operation} failed (${response.status})`); }
function required(name) { if (!process.env[name]) throw new Error(`Missing ${name}`); return process.env[name]; }
function exactKeys(value, allowed) { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...allowed].sort().join(',')) throw new Error('Manifest schema is not sanitized'); }
