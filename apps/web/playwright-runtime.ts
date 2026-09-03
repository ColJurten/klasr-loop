const LOCAL_ORIGIN = 'http://127.0.0.1:4300';
const OAUTH_KEYS = ['NEXTAUTH_URL', 'NEXTAUTH_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'] as const;

export function resolvePlaywrightRuntime(env: Readonly<Record<string, string | undefined>>) {
  const live = env.KLASR_ITEM1_LIVE === 'true';
  const apiEnv = withoutOAuth(env);
  if (!live) return runtime(false, new URL(LOCAL_ORIGIN), apiEnv, apiEnv);

  let url: URL;
  try { url = new URL(env.NEXTAUTH_URL ?? ''); } catch { throw invalid(); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.port || url.username || url.password || url.pathname !== '/' || url.search || url.hash
    || OAUTH_KEYS.some(key => !env[key])) throw invalid();
  return runtime(true, url, apiEnv, { ...apiEnv, ...Object.fromEntries(OAUTH_KEYS.map(key => [key, env[key]!])) });
}

export function resolveItem1EvidenceProvenance(env: Readonly<Record<string, string | undefined>>) {
  const task = env.KLASR_ITEM1_TASK ?? '';
  const attempt = env.KLASR_ITEM1_ATTEMPT ?? '';
  const run = env.KLASR_ITEM1_RUN ?? '';
  const outputFilename = env.KLASR_ITEM1_EVIDENCE_FILE ?? '';
  if (!/^t_[a-f0-9]{8}$/.test(task) || !/^[a-z0-9][a-z0-9-]{0,31}$/.test(attempt)
    || !/^[1-9]\d*$/.test(run) || !Number.isSafeInteger(Number(run))
    || outputFilename !== `provider-db-proof-attempt${attempt}.sanitized.json`) {
    throw new Error('Invalid Item-1 evidence provenance');
  }
  return { task, attempt, run: Number(run), outputFilename };
}

function runtime(live: boolean, url: URL, apiEnv: Record<string, string>, webEnv: Record<string, string>) {
  return { live, webUrl: url.origin, hostname: url.hostname, port: Number(url.port), callbackUrl: `${url.origin}/api/auth/callback/google`, apiEnv, webEnv };
}

function withoutOAuth(env: Readonly<Record<string, string | undefined>>) {
  return Object.fromEntries(Object.entries(env).filter(([key, value]) => value !== undefined && !OAUTH_KEYS.includes(key as typeof OAUTH_KEYS[number]))) as Record<string, string>;
}

function invalid(): Error { return new Error('Invalid Item-1 live OAuth configuration'); }
