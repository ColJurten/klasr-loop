import { createHash } from 'node:crypto';

export const FINGERPRINT_MARKER = 'klasr-fingerprint';

/** Strip volatile parts (timestamps, hex ids, line numbers, durations, paths noise). */
export function normalizeSignature(text) {
  return (text ?? '')
    .replace(/\d{4}-\d{2}-\d{2}[T ][\d:.Z+-]+/g, '<ts>')
    .replace(/\b[0-9a-f]{7,40}\b/gi, '<sha>')
    .replace(/:\d+(?::\d+)?/g, ':<n>')
    .replace(/\b\d+(\.\d+)?(ms|s|m)\b/g, '<dur>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400);
}

/** Stable fingerprint for autonomous issue deduplication. */
export function fingerprint({ category, workflow, job, path, signature }) {
  const material = [category, workflow, job, path, normalizeSignature(signature)].join('|');
  return createHash('sha256').update(material).digest('hex').slice(0, 12);
}

export function fingerprintMarker(fp) {
  return `<!-- ${FINGERPRINT_MARKER}:${fp} -->`;
}

export function extractFingerprint(body) {
  const match = (body ?? '').match(new RegExp(`${FINGERPRINT_MARKER}:([0-9a-f]{12})`));
  return match ? match[1] : null;
}
