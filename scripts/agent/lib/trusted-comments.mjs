import { readFileSync } from 'node:fs';
import { parseSupervisors } from './allowlist.mjs';

export const WORKFLOW_BOTS = ['github-actions[bot]', 'claude[bot]'];

export function trustedComment(comments, marker, { supervisors = '', repositoryOwner = '', bots = WORKFLOW_BOTS } = {}) {
  const matches = comments.flat().filter((comment) => comment?.body?.includes(marker));
  if (matches.length === 0) return null;
  if (matches.length !== 1) throw new Error(`expected at most one ${marker} comment`);
  const trusted = new Set([...parseSupervisors(supervisors, repositoryOwner), repositoryOwner, ...bots].filter(Boolean).map((login) => login.toLowerCase()));
  const author = matches[0]?.user?.login?.toLowerCase();
  if (!author || !trusted.has(author)) throw new Error(`untrusted ${marker} comment author`);
  return matches[0];
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const [, , path, marker, field = 'id'] = process.argv;
  try {
    const comment = trustedComment(JSON.parse(readFileSync(path, 'utf8')), marker, {
      supervisors: process.env.SUPERVISOR_ACTORS,
      repositoryOwner: process.env.REPO_OWNER,
      bots: [...WORKFLOW_BOTS, ...(process.env.TRUSTED_BOT_ACTORS ?? '').split(',').map((v) => v.trim()).filter(Boolean)],
    });
    process.stdout.write(comment == null ? '' : String(comment[field] ?? ''));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
