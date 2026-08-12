export function hasSuccessfulLiveGoogleStatus(payload, expectedSha) {
  return payload?.sha === expectedSha
    && Array.isArray(payload.statuses)
    && payload.statuses.some(({ context, state }) => context === 'klasr/live-google' && state === 'success');
}
