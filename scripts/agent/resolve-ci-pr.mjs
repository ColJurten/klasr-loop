#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { resolveCiPullRequest } from './lib/pull-request.mjs';

const [repository, branch, sha, path] = process.argv.slice(2);
const resolved = resolveCiPullRequest(JSON.parse(readFileSync(path, 'utf8')), repository, branch, sha);
if (!resolved) process.exitCode = 1;
else process.stdout.write(`${JSON.stringify({ number: resolved.pr.number, head_sha: resolved.pr.head.sha, issue: resolved.issue })}\n`);
