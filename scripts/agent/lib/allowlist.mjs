/**
 * Supervisor trust model. SUPERVISOR_ACTORS is a comma-separated repo variable.
 * FAIL CLOSED: when unset/empty, only the repository owner is trusted.
 * Bot actors are never trusted implicitly — they must be explicitly listed.
 */
export function parseSupervisors(rawVariable, repositoryOwner) {
  const fromVariable = (rawVariable ?? '')
    .split(',')
    .map((login) => login.trim().toLowerCase())
    .filter(Boolean);
  if (fromVariable.length > 0) return fromVariable;
  if (repositoryOwner) return [repositoryOwner.toLowerCase()];
  return []; // no configuration, no owner context: trust nobody
}

export function isSupervisor(actorLogin, supervisors) {
  if (!actorLogin) return false;
  return supervisors.includes(actorLogin.toLowerCase());
}

export const COMMANDS = ['spec', 'run', 'revise', 'approve', 'block', 'status'];

/**
 * Parse an explicit supervisor command from a comment body.
 * Accepted forms: `/agent <command> [free text]` on its own line.
 * Returns { command, argument } or null.
 */
export function parseCommand(body) {
  if (typeof body !== 'string') return null;
  const match = body.match(/^\/agent[ \t]+([a-z-]+)(?:[ \t]+(.*))?$/m);
  if (!match) return null;
  const command = match[1].toLowerCase();
  if (!COMMANDS.includes(command)) return null;
  return { command, argument: (match[2] ?? '').trim() };
}
