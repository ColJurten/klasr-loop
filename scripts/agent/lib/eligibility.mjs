export const AGENT_LABEL_PREFIX = 'agent:';
export const AGENT_BRANCH_PREFIXES = ['feature/', 'fix/'];
export const SELF_MARKERS = ['klasr-agent-state', 'klasr-agent-status', 'klasr-fingerprint'];
export const BOT_ACTORS = ['github-actions[bot]', 'claude[bot]'];

export function hasAgentLabel(labels = []) {
  return labels.some((label) => (label.name ?? label).startsWith(AGENT_LABEL_PREFIX));
}

export function isAgentBranch(ref, prefixes = AGENT_BRANCH_PREFIXES) {
  return typeof ref === 'string' && prefixes.some((prefix) => ref.startsWith(prefix));
}

/** Self-generated noise: our own bot identity or bodies carrying our markers. */
export function isSelfGenerated({ actor, body }, extraBotLogins = []) {
  const bots = [...BOT_ACTORS, ...extraBotLogins.map((login) => login.toLowerCase())];
  if (actor && bots.includes(actor.toLowerCase())) return true;
  if (typeof body === 'string' && SELF_MARKERS.some((marker) => body.includes(marker))) return true;
  return false;
}

/** Stable deduplication key per normalized event. */
export function eventKey(kind, payload) {
  switch (kind) {
    case 'issues':
      return `issue:${payload.issue.number}:${payload.action}`;
    case 'issue_comment':
      return `issue-comment:${payload.comment.id}`;
    case 'pull_request':
      return `pr:${payload.pull_request.number}:${payload.action}:${payload.pull_request.head?.sha ?? ''}`;
    case 'pull_request_review':
      return `review:${payload.review.id}`;
    case 'pull_request_review_comment':
      return `review-comment:${payload.comment.id}`;
    case 'commit_comment':
      return `commit-comment:${payload.comment.id}`;
    case 'workflow_run':
      return `workflow-run:${payload.workflow_run.id}:${payload.workflow_run.run_attempt}`;
    case 'repository_dispatch':
      return `dispatch:${payload.client_payload?.delivery_id ?? payload.client_payload?.event_key ?? 'unknown'}`;
    default:
      return `unknown:${kind}`;
  }
}
