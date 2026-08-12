const severities = new Set(['BLOCKER', 'MAJOR', 'MINOR']);

export function findingsPass(findings) {
  return Array.isArray(findings) && findings.every((finding) =>
    finding && severities.has(finding.severity) && typeof finding.current === 'boolean'
      && !(finding.current && ['BLOCKER', 'MAJOR'].includes(finding.severity)));
}
