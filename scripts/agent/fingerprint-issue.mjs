#!/usr/bin/env node
/**
 * Usage: node fingerprint-issue.mjs <finding.json>
 * finding: { category, workflow, job, path, signature, title, evidence }
 * Prints { fingerprint, marker, title, body } for a gh issue create/update step.
 */
import { readFileSync } from 'node:fs';
import { fingerprint, fingerprintMarker } from './lib/fingerprint.mjs';

const finding = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const fp = fingerprint(finding);
const body = [
  fingerprintMarker(fp),
  `**Category:** ${finding.category}`,
  `**Workflow / job:** ${finding.workflow} / ${finding.job}`,
  finding.path ? `**Affected path:** \`${finding.path}\`` : null,
  finding.run_url ? `**Run:** ${finding.run_url}` : null,
  finding.head_sha ? `**Commit:** ${finding.head_sha}` : null,
  '',
  '### Evidence',
  '```',
  (finding.evidence ?? finding.signature ?? '').slice(0, 2000),
  '```',
  '',
  '### Suggested acceptance criteria',
  `- CI workflow \`${finding.workflow}\` passes on the affected branch`,
  '- Root cause documented in the fix PR',
].filter((line) => line !== null).join('\n');
process.stdout.write(JSON.stringify({ fingerprint: fp, title: finding.title, body }, null, 2) + '\n');
