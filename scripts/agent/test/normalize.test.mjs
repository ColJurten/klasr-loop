import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { normalizeEvent } from '../lib/normalize.mjs';
import { buildDispatchPayload } from '../lib/dispatch.mjs';

const env = { supervisors: 'ColJurten', owner: 'ColJurten' };
const load = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));

test('issue opened without spec -> agent.intake (spec refinement)', () => {
  const d = normalizeEvent('issues', load('01-issue-opened.json'), env);
  assert.equal(d.action, 'dispatch');
  assert.equal(d.dispatchType, 'agent.intake');
  assert.equal(d.task, 42);
});

test('ready label by supervisor with valid spec -> agent.implement', () => {
  const d = normalizeEvent('issues', load('02-ready-label.json'), env);
  assert.equal(d.action, 'dispatch');
  assert.equal(d.dispatchType, 'agent.implement');
});

test('ready label with valid spec but non-supervisor -> ignored', () => {
  const payload = load('02-ready-label.json');
  payload.sender.login = 'someone-else';
  const d = normalizeEvent('issues', payload, env);
  assert.equal(d.action, 'ignore');
  assert.match(d.reason, /non-supervisor/);
});

test('ready label with INVALID spec -> escalation, never implementation', () => {
  const payload = load('02-ready-label.json');
  payload.issue.body = 'no spec here';
  const d = normalizeEvent('issues', payload, env);
  assert.equal(d.action, 'ignore');
  assert.equal(d.escalate, 'spec-invalid');
});

test('supervisor /agent revise on issue -> supervisor_feedback dispatch', () => {
  const d = normalizeEvent('issue_comment', load('03-supervisor-issue-comment.json'), env);
  assert.equal(d.dispatchType, 'agent.supervisor_feedback');
  assert.equal(d.refs.comment_id, 9001);
});

test('supervisor command on PR conversation -> supervisor_feedback', () => {
  const d = normalizeEvent('issue_comment', load('04-pr-conversation-comment.json'), env);
  assert.equal(d.dispatchType, 'agent.supervisor_feedback');
  assert.equal(d.refs.surface, 'pr-conversation');
});

test('submitted supervisor review -> supervisor_feedback with review id', () => {
  const d = normalizeEvent('pull_request_review', load('05-pr-review-submitted.json'), env);
  assert.equal(d.dispatchType, 'agent.supervisor_feedback');
  assert.equal(d.refs.review_id, 77001);
  assert.equal(d.task, 42); // canonical issue parsed from branch name
});

test('inline review comment -> supervisor_feedback with comment + path', () => {
  const d = normalizeEvent('pull_request_review_comment', load('06-inline-review-comment.json'), env);
  assert.equal(d.dispatchType, 'agent.supervisor_feedback');
  assert.equal(d.refs.review_comment_id, 88001);
});

test('commit comment with command -> supervisor_feedback needing task resolution', () => {
  const d = normalizeEvent('commit_comment', load('07-commit-comment.json'), env);
  assert.equal(d.dispatchType, 'agent.supervisor_feedback');
  assert.equal(d.refs.needs_task_resolution, true);
});

test('human push to agent branch (synchronize) -> agent.verify', () => {
  const d = normalizeEvent('pull_request', load('08-pr-synchronize-human.json'), env);
  assert.equal(d.dispatchType, 'agent.verify');
});

test('agent own push (synchronize by bot) is NOT re-dispatched', () => {
  const payload = load('08-pr-synchronize-human.json');
  payload.sender.login = 'github-actions[bot]';
  const d = normalizeEvent('pull_request', payload, env);
  assert.equal(d.action, 'ignore');
});

test('CI success -> no action', () => {
  const d = normalizeEvent('workflow_run', load('09-ci-success.json'), env);
  assert.equal(d.action, 'ignore');
});

test('CI failure on agent PR -> agent.ci_failure with run identifiers', () => {
  const d = normalizeEvent('workflow_run', load('10-ci-failure-agent.json'), env);
  assert.equal(d.dispatchType, 'agent.ci_failure');
  assert.equal(d.refs.run_id, 556);
});

test('CI failure on protected branch -> deterministic issue path (no Claude)', () => {
  const d = normalizeEvent('workflow_run', load('15-ci-failure-main.json'), env);
  assert.equal(d.action, 'protected-branch-failure');
});

test('unauthorized actor command -> ignored', () => {
  const d = normalizeEvent('issue_comment', load('12-unauthorized-actor.json'), env);
  assert.equal(d.action, 'ignore');
  assert.match(d.reason, /unauthorized/);
});

test('self-generated bot status comment -> ignored (no recursion)', () => {
  const d = normalizeEvent('issue_comment', load('13-self-bot-comment.json'), env);
  assert.equal(d.action, 'ignore');
  assert.match(d.reason, /self-generated/);
});

test('non-agent PR review -> ignored', () => {
  const d = normalizeEvent('pull_request_review', load('14-non-agent-pr-review.json'), env);
  assert.equal(d.action, 'ignore');
});

test('fork PR review is never processed with privileges', () => {
  const d = normalizeEvent('pull_request_review', load('16-fork-pr-review.json'), env);
  assert.equal(d.action, 'ignore');
  assert.match(d.reason, /fork/);
});

test('plain discussion comment without command never dispatches', () => {
  const payload = load('03-supervisor-issue-comment.json');
  payload.comment.body = 'Great work, thanks!';
  payload.comment.id = 9999;
  const d = normalizeEvent('issue_comment', payload, env);
  assert.equal(d.action, 'ignore');
});

test('dispatch payload carries identifiers only and a version', () => {
  const d = normalizeEvent('pull_request_review', load('05-pr-review-submitted.json'), env);
  const payload = buildDispatchPayload(d);
  assert.equal(payload.event_type, 'agent.supervisor_feedback');
  assert.equal(payload.client_payload.version, 1);
  assert.equal(payload.client_payload.review_id, 77001);
  assert.ok(!('body' in payload.client_payload));
});

test('/agent run with INVALID spec is refused (criterion 1, command path)', () => {
  const payload = load('03-supervisor-issue-comment.json');
  payload.comment.body = '/agent run';
  payload.comment.id = 9300;
  payload.issue.body = 'no spec here';
  const d = normalizeEvent('issue_comment', payload, env);
  assert.equal(d.action, 'ignore');
  assert.equal(d.escalate, 'spec-invalid');
});

test('/agent run with valid spec dispatches implementation', () => {
  const payload = load('03-supervisor-issue-comment.json');
  payload.comment.body = '/agent run';
  payload.comment.id = 9301;
  const d = normalizeEvent('issue_comment', payload, env);
  assert.equal(d.dispatchType, 'agent.implement');
});
