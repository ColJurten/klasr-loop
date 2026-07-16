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
    version: 1,
    task_id: taskId,
    cycle: 0,
    status: 'needs-spec',
    branch: null,
    pull_request: null,
    last_processed_event: null,
    processed_events: [],
    last_commit: null,
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
    if (record.version !== 1 || !Array.isArray(record.processed_events)) return null;
    return record;
  } catch {
    return null;
  }
}

export function hasProcessed(control, eventKey) {
  return Boolean(control && control.processed_events.includes(eventKey));
}

/** Pure update: returns a new record with the event recorded and fields merged. */
export function recordEvent(control, eventKey, patch = {}) {
  const processed = [...control.processed_events, eventKey].slice(-MAX_TRACKED_EVENTS);
  return {
    ...control,
    ...patch,
    last_processed_event: eventKey,
    processed_events: processed,
  };
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
