import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { validateVerdictFile } from '../lib/verdict-json.mjs';

test('verdict validation preserves a realistic PASS verdict', () => {
  const dir = mkdtempSync(join(tmpdir(), 'klasr-verdict-'));
  try {
    const input = join(dir, 'input.json');
    const output = join(dir, 'output.json');
    const verdict = {
      verdict: 'PASS',
      approved: true,
      findings: [],
      sha: 'abc1234def',
    };
    writeFileSync(input, JSON.stringify(verdict));

    validateVerdictFile(input, output);

    assert.deepEqual(JSON.parse(readFileSync(output, 'utf8')), verdict);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verdict validation rejects invalid top-level JSON values', () => {
  const dir = mkdtempSync(join(tmpdir(), 'klasr-verdict-'));
  try {
    for (const [name, value] of [['boolean', 'true'], ['array', '[]'], ['null', 'null'], ['malformed', '{']]) {
      const input = join(dir, `${name}.json`);
      writeFileSync(input, value);
      assert.throws(() => validateVerdictFile(input, join(dir, `${name}.out.json`)), /object|JSON/i);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
