/** Explicit task lifecycle. Labels mirror `agent:<status>`. */
export const STATES = [
  'needs-spec',
  'spec-ready',
  'queued',
  'running',
  'reviewing',
  'awaiting-supervisor',
  'feedback-received',
  'blocked',
  'human-required',
  'ready',
  'done',
];

/** Legal transitions: from -> allowed targets. Deterministic, documented. */
export const TRANSITIONS = {
  'needs-spec': ['spec-ready', 'blocked', 'human-required'],
  'spec-ready': ['queued', 'needs-spec', 'human-required'],
  queued: ['running', 'human-required'],
  running: ['reviewing', 'blocked', 'human-required'],
  reviewing: ['awaiting-supervisor', 'running', 'blocked', 'human-required'],
  'awaiting-supervisor': ['feedback-received', 'ready', 'human-required', 'done'],
  'feedback-received': ['running', 'needs-spec', 'human-required'],
  blocked: ['queued', 'human-required', 'needs-spec'],
  'human-required': ['queued', 'needs-spec', 'done'],
  ready: ['done', 'feedback-received'],
  done: [],
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
  if (verdict === 'PASS') return 'awaiting-supervisor';
  if (verdict === 'BLOCKED') return 'blocked';
  if (verdict === 'REQUEST_CHANGES') {
    return cycle + 1 >= maxCycles ? 'human-required' : 'running';
  }
  throw new Error(`unknown verdict: ${verdict}`);
}

export function labelFor(state) {
  return `agent:${state}`;
}
