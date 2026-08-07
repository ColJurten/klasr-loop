import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

const retry = new URL('../retry-command.mjs', import.meta.url);

function run(args) {
  return spawnSync(process.execPath, [retry.pathname, ...args], { encoding: 'utf8' });
}

test('repeatedly failing command times out with the command exit code', () => {
  const started = Date.now();
  const result = run(['100', '20', process.execPath, '-e', 'process.exit(7)']);

  assert.equal(result.status, 7);
  assert.ok(Date.now() - started >= 80);
});

test('command that fails and then succeeds exits zero', () => {
  const directory = mkdtempSync(join(tmpdir(), 'retry-command-'));
  const counter = join(directory, 'attempts');
  const command = `const fs=require('node:fs');const p=${JSON.stringify(counter)};const n=fs.existsSync(p)?+fs.readFileSync(p):0;fs.writeFileSync(p,String(n+1));process.exit(n?0:1)`;
  try {
    const result = run(['500', '20', process.execPath, '-e', command]);
    assert.equal(result.status, 0);
    assert.equal(readFileSync(counter, 'utf8'), '2');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('malformed arguments exit two', () => {
  assert.equal(run([]).status, 2);
  assert.equal(run(['100', '0', 'command']).status, 2);
});
