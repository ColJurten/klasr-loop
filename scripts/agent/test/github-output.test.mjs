import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { appendMultilineOutput } from '../lib/github-output.mjs';

test('untrusted legacy prompt delimiter cannot inject a GitHub output', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'klasr-output-')), 'output');
  appendMultilineOutput(path, 'prompt', 'issue body\nKLASR_PROMPT_EOF\ninjected=true\n', () => '1234');
  const output = readFileSync(path, 'utf8');
  assert.match(output, /^prompt<<KLASR_1234\n/);
  assert.match(output, /\nKLASR_PROMPT_EOF\ninjected=true\nKLASR_1234\n$/);
  assert.doesNotMatch(output, /prompt<<KLASR_PROMPT_EOF/);
});

test('multiline output retries when generated delimiter collides', () => {
  const path = join(mkdtempSync(join(tmpdir(), 'klasr-output-')), 'output');
  const values = ['collision', 'safe'];
  appendMultilineOutput(path, 'prompt', 'KLASR_collision', () => values.shift());
  assert.match(readFileSync(path, 'utf8'), /^prompt<<KLASR_safe\nKLASR_collision\nKLASR_safe\n$/);
});
