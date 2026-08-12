#!/usr/bin/env node
import { planProjectSync, syncProject } from './lib/project-sync.mjs';

const config = {
  projectId: process.env.KLASR_PROJECT_ID,
  token: process.env.KLASR_PROJECT_TOKEN,
};
const event = { issueNodeId: process.env.ISSUE_NODE_ID, status: process.env.AGENT_STATUS?.replace(/^agent:/, '') };
const result = process.argv.includes('--dry-run') ? planProjectSync(config, event) : await syncProject(config, event);
process.stdout.write(`${JSON.stringify(result)}\n`);
if (result.action === 'error') process.stderr.write('Project sync unavailable; Agent Control remains authoritative.\n');
