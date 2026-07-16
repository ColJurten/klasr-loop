#!/usr/bin/env node
/**
 * Usage: node validate-spec.mjs <issue-body-file>
 * Exit 0 with the parsed spec on stdout when valid; exit 1 with errors otherwise.
 */
import { readFileSync, appendFileSync } from 'node:fs';
import { specFromIssueBody } from './lib/spec.mjs';

const body = readFileSync(process.argv[2], 'utf8');
const result = specFromIssueBody(body);
process.stdout.write(JSON.stringify(result, null, 2) + '\n');
if (process.env.GITHUB_OUTPUT) {
  appendFileSync(process.env.GITHUB_OUTPUT, `valid=${result.ok}\n`);
}
process.exit(result.ok ? 0 : 1);
