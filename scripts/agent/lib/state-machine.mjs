/** Explicit task lifecycle. Labels mirror `agent:<status>`. */
export const STATES = [
  'needs-spec',
  'spec-ready',
  'local-validation',
  'code-review',
  'live-acceptance',
  'changes-requested',
  'awaiting-human-verdict',
  'blocked',
  'human-required',
];

/** Legal transitions: from -> allowed targets. Deterministic, documented. */
export const TRANSITIONS = {
  'needs-spec': ['needs-spec', 'spec-ready', 'local-validation', 'human-required'],
  'spec-ready': ['spec-ready', 'local-validation', 'needs-spec', 'human-required'],
  'local-validation': ['local-validation', 'live-acceptance', 'changes-requested', 'code-review', 'blocked', 'human-required'],
  'code-review': ['local-validation', 'live-acceptance', 'human-required'],
  'live-acceptance': ['local-validation', 'live-acceptance', 'code-review', 'awaiting-human-verdict', 'changes-requested', 'human-required'],
  'changes-requested': ['local-validation', 'human-required'],
  'awaiting-human-verdict': ['local-validation', 'changes-requested', 'human-required'],
  blocked: ['local-validation', 'human-required'],
  'human-required': ['human-required', 'local-validation', 'code-review', 'live-acceptance', 'spec-ready', 'needs-spec', 'awaiting-human-verdict'],
};

export function isLegalTransition(from, to) {
  return Boolean(TRANSITIONS[from]?.includes(to));
}

export function assertTransition(from, to) {
  if (!isLegalTransition(from, to)) {
    throw new Error(`illegal state transition: ${from} -> ${to}`);
  }
  return to;
}

/** Given a verifier verdict, the current cycle and the cap, pick the next state. */
export function afterVerification(verdict, cycle, maxCycles) {
  if (verdict === 'PASS') return 'live-acceptance';
  if (verdict === 'BLOCKED') return 'blocked';
  if (verdict === 'REQUEST_CHANGES') {
    return cycle + 1 >= maxCycles ? 'human-required' : 'changes-requested';
  }
  throw new Error(`unknown verdict: ${verdict}`);
}

export function labelFor(state) {
  return `agent:${state}`;
}

export function assertCurrentAttempt(attempt, currentAttempt) {
  if (attempt !== currentAttempt) throw new Error(`stale attempt ${attempt}; current attempt is ${currentAttempt}`);
  return attempt;
}
