import { defineConfig, devices } from '@playwright/test';
import { resolvePlaywrightRuntime } from './playwright-runtime';

const databaseUrl = 'postgresql://postgres:postgres@127.0.0.1:5432/klasr';
const mongoUrl = 'mongodb://127.0.0.1:27017';
process.env.DATABASE_URL ??= databaseUrl;
process.env.MONGO_URL ??= mongoUrl;
const apiUrl = 'http://127.0.0.1:4301/api/v1';
const runtime = resolvePlaywrightRuntime(process.env);
const { webUrl } = runtime;
const sharedEnv = [
  `DATABASE_URL=${databaseUrl}`,
  `MONGO_URL=${mongoUrl}`,
  'INTERNAL_API_SECRET=playwright-local-secret',
  'TOKEN_ENCRYPTION_KEY=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
  'KLASR_ACCEPTANCE_GOOGLE_SERVICE_ACCOUNT=false',
  'ANTHROPIC_API_KEY=',
].join(' ');

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  workers: 1,
  webServer: [
    {
      command: 'env BYOK_FIXTURE_PORT=4310 BYOK_FIXTURE_AUTH="Bearer synthetic-fixture-token" node ../../scripts/byok-provider-fixture.mjs',
      env: runtime.apiEnv,
      port: 4310,
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command:
        `docker compose up -d --wait && node ../../scripts/retry-command.mjs 30000 250 sh -c 'cd ../../apps/api-py && .venv/bin/alembic upgrade head' && env KLASR_DATABASE_URL=postgresql+psycopg://postgres:postgres@127.0.0.1:5432/klasr KLASR_MONGO_URL=${mongoUrl} KLASR_INLINE_WORKER=true ${sharedEnv} sh -c 'cd ../../apps/api-py && .venv/bin/uvicorn main:app --host 127.0.0.1 --port 4301 --app-dir src'`,
      env: runtime.apiEnv,
      url: `${apiUrl}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command:
        `${runtime.live ? '' : `env NEXTAUTH_URL=${webUrl} NEXTAUTH_SECRET=playwright-nextauth-secret `}API_URL=${apiUrl} NEXT_PUBLIC_API_URL=${apiUrl} ${sharedEnv} pnpm --filter @klasr/web build && mkdir -p .next/standalone/apps/web/.next/static .next/standalone/apps/web/public && cp -R .next/static/. .next/standalone/apps/web/.next/static/ && cp -R public/. .next/standalone/apps/web/public/ && env HOSTNAME=${runtime.hostname} PORT=${runtime.port} ${runtime.live ? '' : `NEXTAUTH_URL=${webUrl} NEXTAUTH_SECRET=playwright-nextauth-secret `}API_URL=${apiUrl} NEXT_PUBLIC_API_URL=${apiUrl} ${sharedEnv} node .next/standalone/apps/web/server.js`,
      env: runtime.webEnv,
      url: `${webUrl}/login`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? webUrl,
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile-390', use: { ...devices['Pixel 5'], viewport: { width: 390, height: 844 } } },
  ],
});
