/**
 * Deterministic orchestrator core: turns a raw GitHub webhook payload into a
 * routing decision BEFORE any Claude session is started. Cheap, testable, and
 * the single place where eligibility, trust, and recursion rules live.
 *
 * Returned decision shape:
 *   { action: 'dispatch'|'ignore', reason, dispatchType?, key, task?, actor, refs? }
 */
import { eventKey, hasAgentLabel, isAgentBranch, isSelfGenerated } from './eligibility.mjs';
import { isSupervisor, parseCommand, parseSupervisors } from './allowlist.mjs';
import { specFromIssueBody } from './spec.mjs';

export const DISPATCH_TYPES = [
  'agent.intake',
  'agent.implement',
  'agent.verify',
  'agent.security_review',
  'agent.supervisor_feedback',
  'agent.ci_failure',
];

const READY_LABEL = 'agent:queued';
const TASK_LABEL = 'agent-task';

function ignore(reason, key, extra = {}) {
  return { action: 'ignore', reason, key, ...extra };
}

function dispatch(dispatchType, key, task, actor, refs = {}) {
  return { action: 'dispatch', reason: 'eligible', dispatchType, key, task, actor, refs };
}

/**
 * @param {string} kind - the GitHub event name
 * @param {object} payload - the webhook payload
 * @param {object} env - { supervisors: string, owner: string, extraBots?: string[] }
 */
export function normalizeEvent(kind, payload, env) {
  const supervisors = parseSupervisors(env.supervisors, env.owner);
  const key = eventKey(kind, payload);
  const extraBots = env.extraBots ?? [];

  switch (kind) {
    case 'issues': {
      const { issue, action, sender } = payload;
      const labels = issue.labels ?? [];
      if (!labels.some((l) => (l.name ?? l) === TASK_LABEL) && !hasAgentLabel(labels)) {
        return ignore('not an agent-managed issue', key);
      }
      if (isSelfGenerated({ actor: sender?.login, body: issue.body }, extraBots) && action === 'edited') {
        return ignore('self-generated edit', key);
      }
      if (action === 'labeled' && payload.label?.name === READY_LABEL) {
        if (!isSupervisor(sender?.login, supervisors)) {
          return ignore('ready label applied by non-supervisor', key, { actor: sender?.login });
        }
        const spec = specFromIssueBody(issue.body);
        if (!spec.ok) {
          return ignore(`ready label but spec invalid: ${spec.errors[0]}`, key, {
            escalate: 'spec-invalid',
            task: issue.number,
          });
        }
        return dispatch('agent.implement', key, issue.number, sender?.login);
      }
      if (['opened', 'edited', 'reopened'].includes(action)) {
        const spec = specFromIssueBody(issue.body);
        if (spec.ok) return ignore('spec already valid; waiting for ready label', key, { task: issue.number });
        return dispatch('agent.intake', key, issue.number, sender?.login);
      }
      return ignore(`unhandled issues action: ${action}`, key);
    }

    case 'issue_comment': {
      const { issue, comment, sender } = payload;
      if (isSelfGenerated({ actor: sender?.login, body: comment.body }, extraBots)) {
        return ignore('self-generated comment', key);
      }
      const command = parseCommand(comment.body);
      const supervisor = isSupervisor(sender?.login, supervisors);
      if (command && !supervisor) {
        return ignore('command from unauthorized actor', key, { actor: sender?.login });
      }
      if (!command) {
        // Plain discussion never starts a privileged run.
        return ignore('no supervisor command in comment', key);
      }
      const isPr = Boolean(issue.pull_request);
      const task = issue.number;
      switch (command.command) {
        case 'spec':
          return dispatch('agent.intake', key, task, sender.login, { command });
        case 'run': {
          // Same gate as the ready label: no implementation without a valid spec.
          const spec = specFromIssueBody(issue.body);
          if (!spec.ok) {
            return ignore(`run command but spec invalid: ${spec.errors[0]}`, key, {
              escalate: 'spec-invalid',
              task,
              actor: sender.login,
            });
          }
          return dispatch('agent.implement', key, task, sender.login, { command });
        }
        case 'revise':
          return dispatch('agent.supervisor_feedback', key, task, sender.login, {
            command,
            comment_id: comment.id,
            surface: isPr ? 'pr-conversation' : 'issue',
          });
        case 'approve':
          return dispatch('agent.supervisor_feedback', key, task, sender.login, {
            command,
            comment_id: comment.id,
            approval: true,
          });
        case 'block':
        case 'status':
          return dispatch('agent.supervisor_feedback', key, task, sender.login, { command, comment_id: comment.id });
        default:
          return ignore('unknown command', key);
      }
    }

    case 'pull_request': {
      const { pull_request: pr, action, sender } = payload;
      if (pr.head.repo?.full_name !== pr.base.repo?.full_name) {
        return ignore('fork PR: never processed with privileges', key);
      }
      if (!isAgentBranch(pr.head.ref) || !hasAgentLabel(pr.labels ?? [])) {
        return ignore('not an agent-managed PR', key);
      }
      if (action === 'synchronize') {
        if (isSelfGenerated({ actor: sender?.login }, extraBots)) {
          return ignore('agent push: verification is dispatched explicitly by the worker', key);
        }
        // A human pushed to the agent branch: re-verify.
        return dispatch('agent.verify', key, prTask(pr), sender?.login, { pull_request: pr.number });
      }
      return ignore(`unhandled pull_request action: ${action}`, key);
    }

    case 'pull_request_review': {
      const { review, pull_request: pr, sender } = payload;
      if (pr.head.repo?.full_name !== pr.base.repo?.full_name) return ignore('fork PR', key);
      if (!hasAgentLabel(pr.labels ?? [])) return ignore('not an agent-managed PR', key);
      if (isSelfGenerated({ actor: sender?.login, body: review.body }, extraBots)) {
        return ignore('self-generated review', key);
      }
      if (!isSupervisor(sender?.login, supervisors)) {
        return ignore('review from non-supervisor: recorded but not dispatched', key, { actor: sender?.login });
      }
      if (review.state === 'commented' && !(review.body ?? '').trim()) {
        return ignore('empty review shell', key);
      }
      return dispatch('agent.supervisor_feedback', key, prTask(pr), sender.login, {
        review_id: review.id,
        review_state: review.state,
        pull_request: pr.number,
      });
    }

    case 'pull_request_review_comment': {
      const { comment, pull_request: pr, sender } = payload;
      if (pr.head.repo?.full_name !== pr.base.repo?.full_name) return ignore('fork PR', key);
      if (!hasAgentLabel(pr.labels ?? [])) return ignore('not an agent-managed PR', key);
      if (isSelfGenerated({ actor: sender?.login, body: comment.body }, extraBots)) {
        return ignore('self-generated inline comment', key);
      }
      if (!isSupervisor(sender?.login, supervisors)) {
        return ignore('inline comment from non-supervisor', key, { actor: sender?.login });
      }
      return dispatch('agent.supervisor_feedback', key, prTask(pr), sender.login, {
        review_comment_id: comment.id,
        pull_request: pr.number,
        path: comment.path,
      });
    }

    case 'commit_comment': {
      const { comment, sender } = payload;
      if (isSelfGenerated({ actor: sender?.login, body: comment.body }, extraBots)) {
        return ignore('self-generated commit comment', key);
      }
      const command = parseCommand(comment.body);
      if (!command) return ignore('commit comment without supervisor command', key);
      if (!isSupervisor(sender?.login, supervisors)) {
        return ignore('commit command from unauthorized actor', key, { actor: sender?.login });
      }
      return dispatch('agent.supervisor_feedback', key, null, sender.login, {
        commit_comment_id: comment.id,
        commit_sha: comment.commit_id,
        command,
        needs_task_resolution: true, // worker resolves the PR containing this commit
      });
    }

    case 'workflow_run': {
      const run = payload.workflow_run;
      if (run.conclusion === 'success') return ignore('CI success: no action', key);
      if (run.conclusion !== 'failure') return ignore(`CI conclusion ${run.conclusion}: no action`, key);
      const branch = run.head_branch;
      const agentPr = (run.pull_requests ?? []).find((pr) => isAgentBranch(pr.head?.ref ?? branch));
      if (agentPr || isAgentBranch(branch)) {
        return dispatch('agent.ci_failure', key, agentPr?.number ?? null, 'ci', {
          run_id: run.id,
          run_attempt: run.run_attempt,
          head_branch: branch,
          head_sha: run.head_sha,
        });
      }
      if (['main', 'develop'].includes(branch)) {
        // Deterministic path: fingerprinted issue creation, no Claude session.
        return {
          action: 'protected-branch-failure',
          reason: 'CI failed on a protected branch',
          key,
          refs: { run_id: run.id, run_attempt: run.run_attempt, head_branch: branch, head_sha: run.head_sha },
        };
      }
      return ignore('CI failure on unmanaged branch', key);
    }

    default:
      return ignore(`unsupported event kind: ${kind}`, key);
  }
}

function prTask(pr) {
  // Convention: agent branches are `feature/<issue>-slug` — the issue is canonical.
  const match = pr.head.ref.match(/^(?:feature|fix)\/(\d+)-/);
  return match ? Number(match[1]) : pr.number;
}
