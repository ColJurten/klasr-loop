import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function validateVerdictFile(input, output) {
  const verdict = JSON.parse(readFileSync(input, 'utf8'));
  if (verdict === null || Array.isArray(verdict) || typeof verdict !== 'object') {
    throw new TypeError('verdict must be a non-null, non-array object');
  }
  writeFileSync(output, JSON.stringify(verdict));
  return verdict;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  validateVerdictFile(process.argv[2], process.argv[3]);
}
