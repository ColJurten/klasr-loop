const CLOSING = String.raw`(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)`;

export function pullRequestMatchesIssue(pr, sha, issue, expectedBranch) {
  if (pr?.state !== 'open' || pr.head?.sha !== sha) return false;
  const conventional = Number(pr.head?.ref?.match(/^(?:feature|fix)\/(\d+)-/)?.[1]) === issue;
  const explicitlyNamed = Boolean(expectedBranch) && pr.head?.ref === expectedBranch
    && new RegExp(String.raw`(?:^|\s)${CLOSING}\s+(?:[^\s]+\/[^\s]+)?#${issue}(?=\s|[.,;:!?)]|$)`, 'i').test(pr.body ?? '');
  return conventional || explicitlyNamed;
}
