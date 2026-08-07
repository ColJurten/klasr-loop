/**
 * One editable "Agent Control" comment per task holds a bounded,
 * machine-readable record. Updated in place — never one comment per transition.
 */
export const CONTROL_MARKER = 'klasr-agent-state';
const OPEN = `<!-- ${CONTROL_MARKER}`;
const CLOSE = '-->';
export const MAX_TRACKED_EVENTS = 30;

export function emptyControl(taskId) {
  return {
    version: 2,
    task_id: taskId,
    cycle: 0,
    status: 'needs-spec',
    branch: null,
    pull_request: null,
    last_processed_event: null,
    processed_events: [],
    last_commit: null,
    lifecycle: { attempt: 1, supersedes: null, superseded_by: null },
    evidence: { sha: null, manifest: null, status: 'missing' },
    clearance: {
      verifier: { status: 'missing', sha: null, attempt: null },
      security: { status: 'missing', sha: null, attempt: null },
    },
    human_verdict: 'pending',
  };
}

/** Parse the control record out of a comment body. Returns null when absent/corrupt. */
export function parseControl(commentBody) {
  if (typeof commentBody !== 'string') return null;
  const start = commentBody.indexOf(OPEN);
  if (start === -1) return null;
  const end = commentBody.indexOf(CLOSE, start);
  if (end === -1) return null;
  const raw = commentBody.slice(start + OPEN.length, end).trim();
  try {
    const record = JSON.parse(raw);
    if (!Array.isArray(record.processed_events)) return null;
    if (record.version === 1) return {
      ...record,
      version: 2,
      clearance: {
        verifier: { status: 'missing', sha: null, attempt: null },
        security: { status: 'missing', sha: null, attempt: null },
      },
    };
    if (record.version !== 2 || !record.clearance?.verifier || !record.clearance?.security) return null;
    return record;
  } catch {
    return null;
  }
}

export function hasProcessed(control, eventKey) {
  return Boolean(control && control.processed_events.includes(eventKey));
}

/** Shape the worker patch without allowing a role to invent evidence lineage. */
export function shapeWorkerPatch(role, fields, headSha, establishedSha, nextAttempt) {
  if (role === 'implementer' || role === 'feedback-responder') {
    return { ...fields, start_attempt: nextAttempt, sha: headSha };
  }
  return headSha && headSha === establishedSha ? { ...fields, sha: headSha } : fields;
}

/** Pure update: returns a new record with the event recorded and fields merged. */
export function recordEvent(control, eventKey, patch = {}) {
  if (patch.attempt !== undefined && patch.attempt !== control.lifecycle?.attempt) {
    throw new Error(`stale attempt ${patch.attempt}; current attempt is ${control.lifecycle?.attempt}`);
  }
  const processed = [...control.processed_events, eventKey].slice(-MAX_TRACKED_EVENTS);
  const { start_attempt: startAttempt, attempt: _attempt, sha, evidence, clearance, ...fields } = patch;
  if (!startAttempt && (sha !== undefined && sha !== control.evidence?.sha
    || evidence?.sha !== undefined && evidence.sha !== control.evidence?.sha)) {
    throw new Error('sha may only change when starting an attempt');
  }
  const lineagePatch = startAttempt ? {
    lifecycle: { attempt: startAttempt, supersedes: startAttempt === control.lifecycle?.attempt ? null : control.lifecycle?.attempt ?? null, superseded_by: null },
    evidence: { sha: sha ?? null, manifest: null, status: 'missing' },
    clearance: {
      verifier: { status: 'missing', sha: null, attempt: null },
      security: { status: 'missing', sha: null, attempt: null },
    },
    human_verdict: 'pending',
  } : {
    ...(evidence === undefined && sha === undefined ? {} : { evidence: { ...control.evidence, ...evidence, ...(sha === undefined ? {} : { sha }) } }),
    ...(clearance === undefined ? {} : { clearance: { ...control.clearance, ...clearance } }),
  };
  return {
    ...control,
    ...fields,
    ...lineagePatch,
    last_processed_event: eventKey,
    processed_events: processed,
  };
}

export function clearancePatch(role, passed, sha, attempt, securityRequired) {
  const decision = { status: passed ? 'PASS' : 'FAIL', sha, attempt };
  if (role === 'verifier') return {
    verifier: decision,
    ...(passed && !securityRequired ? { security: { status: 'NOT_REQUIRED', sha, attempt } } : {}),
  };
  if (role === 'security-reviewer') return { security: decision };
  return {};
}

export function hasAcceptanceClearance(control, sha, attempt, securityRequired) {
  if (!control || control.version !== 2 || control.evidence?.sha !== sha
    || control.lifecycle?.attempt !== attempt) return false;
  const exact = (decision, status) => decision?.status === status
    && decision.sha === sha && decision.attempt === attempt;
  return exact(control.clearance?.verifier, 'PASS')
    && exact(control.clearance?.security, securityRequired ? 'PASS' : 'NOT_REQUIRED');
}

/** Render the full comment body (human summary + machine record). */
export function renderControlComment(control) {
  const summary = [
    `**Agent control — task #${control.task_id}**`,
    `status: \`${control.status}\` · cycle: ${control.cycle}` +
      (control.pull_request ? ` · PR: #${control.pull_request}` : '') +
      (control.branch ? ` · branch: \`${control.branch}\`` : ''),
  ].join('\n');
  return `${summary}\n\n${OPEN}\n${JSON.stringify(control, null, 2)}\n${CLOSE}`;
}
