const CLOSING = String.raw`(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)`;

export function closingIssueReference(body, repository) {
  const clauses = [...String(body ?? '').matchAll(new RegExp(String.raw`(?:^|\s)${CLOSING}\s+([^\r\n]+)`, 'gi'))];
  if (clauses.length !== 1 || !repository) return undefined;
  const match = clauses[0][1].match(/^(?:(?<repository>[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?\/[A-Za-z0-9._-]+))?#(?<issue>[1-9]\d*)$/);
  if (!match || (match.groups.repository && match.groups.repository.toLowerCase() !== repository.toLowerCase())) return undefined;
  return Number(match.groups.issue);
}

export function resolveCiPullRequest(pulls, repository, branch, sha) {
  const exact = pulls.flat().filter((pr) => pr?.state === 'open'
    && pr.head?.ref === branch && pr.head?.sha === sha
    && pr.head?.repo?.full_name?.toLowerCase() === repository.toLowerCase()
    && pr.base?.repo?.full_name?.toLowerCase() === repository.toLowerCase());
  if (exact.length !== 1) return undefined;
  const pr = exact[0];
  const issue = closingIssueReference(pr.body, repository);
  const conventional = Number(pr.head.ref.match(/^(?:feature|fix)\/(\d+)-/)?.[1]);
  if (!issue || (conventional && conventional !== issue)) return undefined;
  return { pr, issue };
}

export function pullRequestMatchesIssue(pr, sha, issue, expectedBranch, repository) {
  if (pr?.state !== 'open' || pr.head?.sha !== sha) return false;
  const explicitIssue = closingIssueReference(pr.body, repository);
  if (expectedBranch) return pr.head?.ref === expectedBranch && explicitIssue === issue;
  const conventional = Number(pr.head?.ref?.match(/^(?:feature|fix)\/(\d+)-/)?.[1]) === issue;
  const hasClosingClause = new RegExp(String.raw`(?:^|\s)${CLOSING}\s+`, 'i').test(pr.body ?? '');
  return conventional && (!hasClosingClause || explicitIssue === issue);
}

export function resolveLivePullRequest(pulls, sha, issue, expectedBranch, repository) {
  const matches = pulls.filter((pr) => pullRequestMatchesIssue(pr, sha, issue, expectedBranch, repository));
  return matches.length === 1 ? matches[0] : undefined;
}
