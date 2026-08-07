import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planProjectSync, syncProject } from '../lib/project-sync.mjs';

test('project sync is a safe no-op when repository variables are absent', () => {
  assert.deepEqual(planProjectSync({}, { issueNodeId: 'I_1', status: 'build' }), {
    action: 'noop', reason: 'project configuration absent',
  });
});

test('project sync plans discovery from project, issue, and supplied status only', () => {
  const plan = planProjectSync({ projectId: 'PVT_1', token: 'secret' }, { issueNodeId: 'I_1', status: 'build' });
  assert.equal(plan.action, 'graphql');
  assert.match(plan.query, /node\(id:\$project\)/);
  assert.deepEqual(plan.variables, { project: 'PVT_1', cursor: null });
  assert.doesNotMatch(JSON.stringify(plan.variables), /body|title|content/i);
});

test('project sync reuses an existing item and discovers the matching Status option', async () => {
  const calls = [];
  const request = async (query, variables) => {
    calls.push({ query, variables });
    if (calls.length === 1) return { node: { fields: { nodes: [{ id: 'F_1', name: 'Status', options: [{ id: 'O_1', name: 'build' }] }] }, items: { nodes: [{ id: 'ITEM_1', content: { id: 'I_1' } }] } } };
    return { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'ITEM_1' } } };
  };
  assert.deepEqual(await syncProject({ projectId: 'P_1', token: 'secret' }, { issueNodeId: 'I_1', status: 'build' }, request), { action: 'updated', itemId: 'ITEM_1', optionId: 'O_1' });
  assert.equal(calls.length, 2);
  assert.match(calls[1].query, /updateProjectV2ItemFieldValue/);
});

test('project sync adds missing issue content before updating and fails safely', async () => {
  const responses = [
    { node: { fields: { nodes: [{ id: 'F_1', name: 'Status', options: [{ id: 'O_1', name: 'reviewing' }] }] }, items: { nodes: [] } } },
    { addProjectV2ItemById: { item: { id: 'ITEM_2' } } },
    { updateProjectV2ItemFieldValue: { projectV2Item: { id: 'ITEM_2' } } },
  ];
  assert.equal((await syncProject({ projectId: 'P_1', token: 'secret' }, { issueNodeId: 'I_1', status: 'reviewing' }, async () => responses.shift())).action, 'updated');
  assert.deepEqual(await syncProject({ projectId: 'P_1' }, { issueNodeId: 'I_1', status: 'build' }), { action: 'noop', reason: 'project configuration absent' });
  assert.equal((await syncProject({ projectId: 'P_1', token: 'secret' }, { issueNodeId: 'I_1', status: 'missing' }, async () => responses[0])).action, 'error');
});
