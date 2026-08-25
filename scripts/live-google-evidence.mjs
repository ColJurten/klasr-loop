import { createHash } from 'node:crypto';
import { existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const excluded = /(^|\/)(?:\.tmp)(?:\/|$)|(^|\/)\.env(?:\.local|\.(?!example$)[^/]*)?$|\.(?:log|png|jpg|jpeg|webp|trace|zip)$/i;

export function currentTreeBinding(root) {
  const head = git(root, ['rev-parse', 'HEAD']).trim();
  const tracked = split0(git(root, ['ls-files', '-z']));
  const untracked = split0(git(root, ['ls-files', '--others', '--exclude-standard', '-z']));
  const dirty = git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all']).length > 0;
  return computeTreeBinding(root, { head, tracked, untracked, dirty });
}

export function computeTreeBinding(root, { head, tracked, untracked, dirty = true }) {
  const hash = createHash('sha256');
  frame(hash, 'schema', 'klasr-tree-v1'); frame(hash, 'head', head);
  const names = [...tracked.filter((value) => !/(^|\/)\.env(?:\.local|\.(?!example$)[^/]*)?$|(^|\/)\.tmp(?:\/|$)/i.test(value)), ...untracked.filter((value) => !excluded.test(value))];
  for (const name of [...new Set(names)].sort()) {
    const file = path.join(root, name); frame(hash, 'path', name);
    if (!existsSync(file)) { frame(hash, 'mode', 'deleted'); frame(hash, 'content', Buffer.alloc(0)); continue; }
    const stat = lstatSync(file);
    frame(hash, 'mode', stat.isSymbolicLink() ? '120000' : stat.mode & 0o111 ? '100755' : '100644');
    frame(hash, 'content', stat.isSymbolicLink() ? readlinkSync(file) : readFileSync(file));
  }
  return { schema: 'klasr-tree-v1', mode: dirty ? 'worktree' : 'sha', head, digest: dirty ? hash.digest('hex') : head };
}

function git(root, args) { return execFileSync('git', args, { cwd: root, encoding: 'utf8' }); }
function split0(value) { return value.split('\0').filter(Boolean); }

export function assertTreeBinding(expected, actual) {
  if (JSON.stringify(expected) !== JSON.stringify(actual)) throw new Error('tree_binding_mismatch');
}

export function parseObservedRecord(text, tree) {
  let value; try { value = JSON.parse(text); } catch { throw new Error('observed_record_malformed'); }
  const keys = Object.keys(value).sort().join(',');
  if (keys !== 'modelCount,modelUsed,schema,selectedModelId,stage,tree' || value.schema !== 'klasr-live-observed-v1' || value.stage !== 'settings-deleted'
    || !Number.isInteger(value.modelCount) || value.modelCount < 1 || !/^[a-z0-9._-]{1,200}$/i.test(value.selectedModelId ?? '')
    || value.modelUsed !== `anthropic/${value.selectedModelId}`) throw new Error('observed_record_schema');
  assertTreeBinding(tree, value.tree); return value;
}

function frame(hash, type, value) {
  for (const part of [Buffer.from(type), Buffer.isBuffer(value) ? value : Buffer.from(value)]) {
    const length = Buffer.alloc(8); length.writeBigUInt64BE(BigInt(part.length)); hash.update(length).update(part);
  }
}
