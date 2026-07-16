import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isSupervisor, parseCommand, parseSupervisors } from '../lib/allowlist.mjs';

test('SUPERVISOR_ACTORS parsed case-insensitively', () => {
  const s = parseSupervisors('ColJurten, external-reviewer-bot ', 'owner');
  assert.deepEqual(s, ['coljurten', 'external-reviewer-bot']);
  assert.ok(isSupervisor('COLJURTEN', s));
});

test('missing configuration fails closed to the repository owner only', () => {
  const s = parseSupervisors('', 'ColJurten');
  assert.deepEqual(s, ['coljurten']);
  assert.ok(!isSupervisor('random-collaborator', s));
});

test('missing configuration AND missing owner trusts nobody', () => {
  const s = parseSupervisors(undefined, undefined);
  assert.deepEqual(s, []);
  assert.ok(!isSupervisor('anyone', s));
});

test('command parsing: valid forms', () => {
  assert.deepEqual(parseCommand('/agent revise\nfix naming'), { command: 'revise', argument: '' });
  assert.deepEqual(parseCommand('intro text\n/agent run now'), { command: 'run', argument: 'now' });
});

test('command parsing: rejects unknown commands and mid-line usage', () => {
  assert.equal(parseCommand('/agent selfdestruct'), null);
  assert.equal(parseCommand('please /agent run'), null);
  assert.equal(parseCommand(null), null);
});
