#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { finalizeEvidence } from './lib/evidence.mjs';

const [, , specPath, manifestPath, issue, attempt, sha] = process.argv;
const result = finalizeEvidence(
  JSON.parse(readFileSync(specPath, 'utf8')),
  JSON.parse(readFileSync(manifestPath, 'utf8')),
  { issue: Number(issue), attempt: Number(attempt), sha },
);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
process.exit(result.ok ? 0 : 1);
