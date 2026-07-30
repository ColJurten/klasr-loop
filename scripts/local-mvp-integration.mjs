import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';

const requireFromApi = createRequire(new URL('../apps/api/package.json', import.meta.url));
const { PrismaClient } = requireFromApi('@prisma/client');
const { MongoClient } = requireFromApi('mongodb');

const root = new URL('..', import.meta.url).pathname;
const apiPort = Number(process.env.KLASR_INTEGRATION_API_PORT ?? 3101);
const apiBase = `http://127.0.0.1:${apiPort}/api/v1`;
const databaseUrl = process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/klasr';
const mongoUrl = process.env.MONGO_URL ?? 'mongodb://localhost:27017';
const internalSecret = 'local-integration-secret';
const tokenKey = 'MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=';
const email = 'camille.local@klasr.test';

const prisma = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const mongo = new MongoClient(mongoUrl);
let api;

try {
  await resetLocalData();
  api = spawn(
    'pnpm',
    ['--filter', '@klasr/api', 'exec', 'nest', 'start'],
    {
      cwd: root,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NODE_ENV: 'test',
        PORT: String(apiPort),
        DATABASE_URL: databaseUrl,
        MONGO_URL: mongoUrl,
        INTERNAL_API_SECRET: internalSecret,
        TOKEN_ENCRYPTION_KEY: tokenKey,
        KLASR_LOCAL_MVP: 'true',
        KLASR_INLINE_WORKER: 'true',
        ANTHROPIC_API_KEY: '',
      },
    },
  );
  api.stdout.on('data', (chunk) => process.stdout.write(prefixApiOutput(chunk)));
  api.stderr.on('data', (chunk) => process.stderr.write(prefixApiOutput(chunk)));
  api.on('exit', (code) => {
    if (code !== null && code !== 0) {
      process.stderr.write(`api exited with ${code}\n`);
    }
  });

  await waitForHealth();
  const organizationId = await onboardLocalTenant();
  await seedRule(organizationId);

  const syncResponse = await fetch(`${apiBase}/organizations/${organizationId}/sync`, {
    method: 'POST',
    headers: { 'x-internal-secret': internalSecret },
  });
  if (!syncResponse.ok) throw new Error(`HTTP sync failed: ${syncResponse.status}`);
  const sync = await syncResponse.json();
  if (sync.enqueued !== 1) throw new Error(`Expected one enqueued analysis job, got ${JSON.stringify(sync)}`);

  const proposal = await waitForProposal(organizationId);
  if (proposal.proposedName !== 'Facture_Electricite_2026-07.pdf') {
    throw new Error(`Unexpected proposal name ${proposal.proposedName}`);
  }

  await assertDatabases(organizationId, proposal.documentId);

  const confirmResponse = await fetch(
    `${apiBase}/organizations/${organizationId}/proposals/${proposal.id}/confirm`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': internalSecret },
      body: '{}',
    },
  );
  if (!confirmResponse.ok) throw new Error(`HTTP confirm failed: ${confirmResponse.status}`);
  const history = await prisma.actionHistory.findMany({ where: { organizationId } });
  if (history.length !== 1 || history[0].toName !== 'Facture_Electricite_2026-07.pdf') {
    throw new Error('Confirmation did not persist action history');
  }

  const queueResponse = await fetch(`${apiBase}/organizations/${organizationId}/dashboard`, {
    headers: { 'x-internal-secret': internalSecret },
  });
  const dashboard = await queueResponse.json();
  if (dashboard.queue.queued !== 0 || dashboard.queue.active !== 0 || dashboard.queue.failed !== 0) {
    throw new Error(`Queue not idle after processing: ${JSON.stringify(dashboard.queue)}`);
  }

  console.log('integration ok: HTTP sync -> pg-boss analysis -> proposal -> Mongo/PostgreSQL assertions -> confirm');
} finally {
  stopApi();
  await mongo.close().catch(() => undefined);
  await prisma.$disconnect();
}

async function resetLocalData() {
  await mongo.connect();
  await mongo.db('klasr').collection('analyses').deleteMany({ organizationId: 'local_mvp_org' });
  const membership = await prisma.membership.findFirst({
    where: { user: { email } },
    select: { organizationId: true, userId: true },
  });
  if (!membership) {
    await prisma.user.deleteMany({ where: { email } });
    return;
  }
  const organizationId = membership.organizationId;
  const rules = await prisma.classificationRule.findMany({ where: { organizationId }, select: { id: true } });
  await prisma.actionHistory.deleteMany({ where: { organizationId } });
  await prisma.classificationProposal.deleteMany({ where: { organizationId } });
  await prisma.document.deleteMany({ where: { organizationId } });
  await prisma.ruleCondition.deleteMany({ where: { ruleId: { in: rules.map((rule) => rule.id) } } });
  await prisma.classificationRule.deleteMany({ where: { organizationId } });
  await prisma.folder.deleteMany({ where: { organizationId } });
  await prisma.usageMetric.deleteMany({ where: { organizationId } });
  await prisma.driveConnection.deleteMany({ where: { organizationId } });
  await prisma.membership.deleteMany({ where: { organizationId } });
  await prisma.organization.deleteMany({ where: { id: organizationId } });
  await prisma.user.deleteMany({ where: { id: membership.userId } });
}

async function waitForHealth() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${apiBase}/health`);
      if (response.ok) return;
    } catch {
      // keep polling while Nest starts
    }
    await delay(250);
  }
  throw new Error('API health did not become ready');
}

async function onboardLocalTenant() {
  const response = await fetch(`${apiBase}/auth/onboarding`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-secret': internalSecret },
    body: JSON.stringify({
      email,
      displayName: 'Camille Local',
      provider: 'google',
      providerAccountId: 'local-google-account',
      refreshToken: 'throwaway-refresh-token',
      scopes: ['https://www.googleapis.com/auth/drive'],
    }),
  });
  if (!response.ok) throw new Error(`Onboarding failed: ${response.status}`);
  const payload = await response.json();
  return payload.organizationId;
}

async function seedRule(organizationId) {
  await prisma.classificationRule.create({
    data: {
      organizationId,
      priority: 1,
      destinationPath: '/Comptabilité/Électricité',
      suggestedNameTemplate: 'Facture_Electricite_2026-07.pdf',
      conditions: { create: [{ field: 'CONTENT', operator: 'CONTAINS', value: 'électricité' }] },
    },
  });
}

async function waitForProposal(organizationId) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const proposals = await prisma.classificationProposal.findMany({
      where: { organizationId, status: 'PENDING' },
      include: { document: true },
    });
    if (proposals.length === 1) return proposals[0];
    await delay(250);
  }
  throw new Error('Analysis job did not create a pending proposal');
}

async function assertDatabases(organizationId, documentId) {
  const [documents, proposals, metrics] = await Promise.all([
    prisma.document.findMany({ where: { organizationId } }),
    prisma.classificationProposal.findMany({ where: { organizationId } }),
    prisma.usageMetric.findMany({ where: { organizationId } }),
  ]);
  if (documents.length !== 1 || documents[0].status !== 'PROPOSED') {
    throw new Error('PostgreSQL document metadata was not updated by analysis');
  }
  if (proposals.length !== 1 || proposals[0].source !== 'RULE') {
    throw new Error('PostgreSQL proposal was not created by classification');
  }
  if (!metrics.some((metric) => metric.documentsIn === 1 && metric.ocrRuns === 1 && metric.ruleMatches === 1)) {
    throw new Error('Usage metrics were not incremented by the pipeline');
  }
  const collection = mongo.db('klasr').collection('analyses');
  const indexes = await collection.indexes();
  if (!indexes.some((index) => index.expireAfterSeconds === 30 * 24 * 3600)) {
    throw new Error('Mongo analyses TTL index missing');
  }
  const analyses = await collection.find({ organizationId, documentId }).toArray();
  if (analyses.length !== 1 || analyses[0].ocrExcerpt !== 'facture électricité juillet cabinet exemple comptabilité') {
    throw new Error('Mongo analysis metadata was not written by the pipeline');
  }
  const persisted = JSON.stringify([documents, proposals, analyses]);
  if (/%PDF-|client document bytes|Buffer\(|throwaway-refresh-token/i.test(persisted)) {
    throw new Error('Persisted document bytes or token-like content detected');
  }
}

function prefixApiOutput(chunk) {
  return String(chunk)
    .split('\n')
    .filter(Boolean)
    .map((line) => `[api] ${line}\n`)
    .join('');
}

function stopApi() {
  if (!api?.pid) return;
  try {
    process.kill(-api.pid, 'SIGTERM');
  } catch {
    api.kill('SIGTERM');
  }
}
