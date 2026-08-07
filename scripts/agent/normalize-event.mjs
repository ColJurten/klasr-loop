#!/usr/bin/env node
/**
 * Usage: node normalize-event.mjs <event_name> <payload.json>
 * Env:   SUPERVISOR_ACTORS, REPO_OWNER, EXTRA_BOT_ACTORS
 * Emits the routing decision as JSON on stdout, plus GitHub-output lines.
 */
import { readFileSync, appendFileSync } from 'node:fs';
import { normalizeEvent } from './lib/normalize.mjs';
import { buildDispatchPayload } from './lib/dispatch.mjs';

const [, , kind, payloadPath] = process.argv;
const payload = JSON.parse(readFileSync(payloadPath, 'utf8'));
const decision = normalizeEvent(kind, payload, {
  supervisors: process.env.SUPERVISOR_ACTORS ?? '',
  owner: process.env.REPO_OWNER ?? '',
  extraBots: (process.env.EXTRA_BOT_ACTORS ?? '').split(',').map((s) => s.trim()).filter(Boolean),
  repo: process.env.REPO,
  currentPrHeadSha: process.env.CURRENT_PR_HEAD_SHA,
  failedJob: process.env.FAILED_JOB,
  failedJobs: process.env.FAILED_JOBS,
  liveStatusState: process.env.LIVE_STATUS_STATE,
  cycle: process.env.REPAIR_CYCLE,
  currentAttempt: process.env.CURRENT_AGENT_ATTEMPT,
});
const output = { decision };
if (decision.action === 'dispatch') output.dispatch = buildDispatchPayload(decision);
process.stdout.write(JSON.stringify(output, null, 2) + '\n');
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `action=${decision.action}\n`);
  appendFileSync(
    process.env.GITHUB_OUTPUT,
    `dispatch=${output.dispatch ? JSON.stringify(output.dispatch) : ''}\n`,
  );
  appendFileSync(process.env.GITHUB_OUTPUT, `reason=${decision.reason}\n`);
  appendFileSync(process.env.GITHUB_OUTPUT, `key=${decision.key}\n`);
  appendFileSync(process.env.GITHUB_OUTPUT, `task=${decision.task ?? ''}\n`);
}
