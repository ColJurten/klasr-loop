import { EVIDENCE_CLASSES } from './spec.mjs';
import { findingsPass } from './findings.mjs';

export function liveEvidenceEventKey({ issue, sha, attempt, status }) {
  return `live-evidence:${issue}:${sha}:${attempt}:${status}`;
}

export function validateEvidence(spec, manifest, current) {
  const errors = [];
  if (manifest?.issue !== current.issue) errors.push('wrong issue lineage');
  if (manifest?.attempt !== current.attempt) errors.push('wrong attempt lineage');
  if (manifest?.sha !== current.sha) errors.push('wrong current SHA');
  if (manifest?.status !== 'current') errors.push('evidence is stale or superseded');

  const requiredIds = new Set((spec.acceptance_criteria ?? []).map((criterion) => criterion.id));
  const rows = new Map();
  for (const row of manifest?.criteria ?? []) {
    if (!requiredIds.has(row.criterion_id)) errors.push(`unknown criterion: ${row.criterion_id}`);
    if (rows.has(row.criterion_id)) errors.push(`duplicate criterion: ${row.criterion_id}`);
    else rows.set(row.criterion_id, row);
  }
  for (const criterion of spec.acceptance_criteria ?? []) {
    const row = rows.get(criterion.id);
    if (!row) { errors.push(`missing criterion: ${criterion.id}`); continue; }
    if (row.passed !== true) errors.push(`criterion failed: ${criterion.id}`);
    if (!row.artifact) errors.push(`criterion missing artifact: ${criterion.id}`);
    if (EVIDENCE_CLASSES.indexOf(row.evidence_class) < EVIDENCE_CLASSES.indexOf(criterion.evidence_class)) {
      errors.push(`insufficient evidence class: ${criterion.id}`);
    }
  }
  if (manifest?.cleanup?.passed !== true || !manifest?.cleanup?.proof) errors.push('cleanup failed or proof absent');
  if (manifest?.processes?.active?.length) errors.push('active processes remain');
  if (manifest?.processes?.orphaned?.length) errors.push('orphan processes remain');
  if (manifest?.reviewer?.verdict !== 'PASS' || manifest?.reviewer?.approved !== true) errors.push('reviewer verdict is not approved PASS');
  if (manifest?.reviewer?.sha !== current.sha) errors.push('reviewer SHA is not current');
  if (manifest?.reviewer?.edited_files !== false) errors.push('reviewer edited files');
  if (!findingsPass(manifest?.reviewer?.findings)) errors.push('reviewer findings are malformed or blocking');
  return { ok: errors.length === 0, errors };
}

export function finalizeEvidence(spec, manifest, current) {
  const result = validateEvidence(spec, manifest, current);
  return { ...result, state: result.ok ? 'awaiting-human-verdict' : 'blocked' };
}
