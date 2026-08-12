import { defineConfig, devices } from '@playwright/test';

const databaseUrl = 'postgresql://postgres:postgres@127.0.0.1:5432/klasr';
const mongoUrl = 'mongodb://127.0.0.1:27017';
const apiUrl = 'http://127.0.0.1:4301/api/v1';
const webUrl = 'http://127.0.0.1:4300';
const sharedEnv = [
  `DATABASE_URL=${databaseUrl}`,
  `MONGO_URL=${mongoUrl}`,
  'INTERNAL_API_SECRET=playwright-local-secret',
  'TOKEN_ENCRYPTION_KEY=MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=',
  'KLASR_LOCAL_MVP=true',
  'KLASR_ACCEPTANCE_GOOGLE_SERVICE_ACCOUNT=false',
  'KLASR_ACCEPTANCE_LOCAL_MVP=true',
  'ANTHROPIC_API_KEY=',
].join(' ');

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  workers: 1,
  webServer: [
    {
      command:
        `docker compose up -d --wait && node ../../scripts/retry-command.mjs 30000 250 env DATABASE_URL=${databaseUrl} pnpm --filter @klasr/api prisma:deploy && pnpm --filter @klasr/api build && env NODE_ENV=test PORT=4301 KLASR_INLINE_WORKER=true ${sharedEnv} pnpm --filter @klasr/api exec node dist/main.js`,
      url: `${apiUrl}/health`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command:
        `env NEXTAUTH_URL=${webUrl} NEXTAUTH_SECRET=playwright-nextauth-secret NEXT_PUBLIC_KLASR_LOCAL_MVP=true API_URL=${apiUrl} NEXT_PUBLIC_API_URL=${apiUrl} ${sharedEnv} pnpm --filter @klasr/web build && mkdir -p .next/standalone/apps/web/.next/static && cp -R .next/static/. .next/standalone/apps/web/.next/static/ && env HOSTNAME=127.0.0.1 PORT=4300 NEXTAUTH_URL=${webUrl} NEXTAUTH_SECRET=playwright-nextauth-secret NEXT_PUBLIC_KLASR_LOCAL_MVP=true API_URL=${apiUrl} NEXT_PUBLIC_API_URL=${apiUrl} ${sharedEnv} node .next/standalone/apps/web/server.js`,
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
