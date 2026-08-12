import assert from 'node:assert/strict';
import { test } from 'node:test';
import { trustedComment } from '../lib/trusted-comments.mjs';

const comment = (id, login, body = '<!-- klasr-agent-state {} -->') => ({ id, body, user: { login } });
const trust = { supervisors: 'Supervisor, Second', repositoryOwner: 'Owner' };

test('trusted comments accept the owner, configured supervisors, and workflow bots', () => {
  for (const login of ['owner', 'SUPERVISOR', 'github-actions[bot]', 'claude[bot]']) {
    assert.equal(trustedComment([comment(1, login)], 'klasr-agent-state', trust).id, 1);
  }
});

test('an untrusted marker shadow is ignored', () => {
  assert.equal(trustedComment([comment(1, 'public-user')], 'klasr-agent-state', trust), null);
});

test('one trusted marker wins over untrusted marker shadows', () => {
  assert.equal(trustedComment([comment(1, 'public-user'), comment(2, 'owner')], 'klasr-agent-state', trust).id, 2);
  assert.equal(trustedComment([[comment(1, 'owner')], [comment(2, 'public-user')]], 'klasr-agent-state', trust).id, 1);
});

test('duplicate trusted markers fail closed', () => {
  assert.throws(() => trustedComment([comment(1, 'owner'), comment(2, 'supervisor')], 'klasr-agent-state', trust), /at most one/);
});

test('missing marker is safe and returns no state', () => {
  assert.equal(trustedComment([comment(1, 'owner', 'ordinary comment')], 'klasr-agent-state', trust), null);
});
