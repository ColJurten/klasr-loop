import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { findingsPass } from './findings.mjs';

export function reviewVerdictPasses(role, verdict, controlledSha, expectedSha) {
  if (!['verifier', 'security-reviewer'].includes(role)
    || !/^[0-9a-f]{40}$/.test(controlledSha)
    || controlledSha !== expectedSha
    || verdict?.verdict !== 'PASS'
    || verdict.approved !== true
    || verdict.reviewerEditedFiles !== false
    || verdict.sha !== controlledSha) return false;

  return findingsPass(verdict.findings);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  let verdict;
  try { verdict = JSON.parse(readFileSync(0, 'utf8')); } catch { verdict = null; }
  process.stdout.write(String(reviewVerdictPasses(process.argv[2], verdict, process.argv[3], process.argv[4])));
}
