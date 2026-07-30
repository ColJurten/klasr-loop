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

  const referenceResponse = await fetch(`${apiBase}/organizations/${organizationId}/drive/reference-root`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-secret': internalSecret },
    body: JSON.stringify({ folderExternalId: 'local_root_cabinet' }),
  });
  if (!referenceResponse.ok) throw new Error(`HTTP reference failed: ${referenceResponse.status}`);
  const reference = await referenceResponse.json();
  if (reference.folders.length < 4) throw new Error('Reference descendant tree was not imported');

  const inputResponse = await fetch(`${apiBase}/organizations/${organizationId}/drive/input-items`, {
    headers: { 'x-internal-secret': internalSecret },
  });
  const inputItems = await inputResponse.json();
  if (!inputItems.some((item) => item.externalId === 'local_input_folder' && item.eligible)) {
    throw new Error('Local input folder is not eligible');
  }
  if (inputItems.some((item) => item.externalId === 'local_folder_compta' && item.eligible)) {
    throw new Error('Inherited destination subtree was offered as input');
  }

  const syncResponse = await fetch(`${apiBase}/organizations/${organizationId}/drive/launch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-secret': internalSecret },
    body: JSON.stringify({ itemExternalId: 'local_input_folder' }),
  });
  if (!syncResponse.ok) throw new Error(`HTTP launch failed: ${syncResponse.status}`);
  const sync = await syncResponse.json();
  if (sync.enqueued !== 3 || sync.manual !== 1) throw new Error(`Expected three enqueued jobs and one manual file, got ${JSON.stringify(sync)}`);

  const proposals = await waitForProposals(organizationId, 3);
  const facture = proposals.find((proposal) => proposal.document.externalId === 'local_file_facture_elec');
  const banque = proposals.find((proposal) => proposal.document.externalId === 'local_file_releve_banque');
  const paie = proposals.find((proposal) => proposal.document.externalId === 'local_file_note_paie');
  if (!facture || !banque || !paie) {
    throw new Error(`Missing expected proposals: ${proposals.map((proposal) => proposal.document.externalId).join(',')}`);
  }

  await assertDatabases(organizationId, proposals.map((proposal) => proposal.documentId));

  const confirmResponse = await fetch(
    `${apiBase}/organizations/${organizationId}/proposals/${facture.id}/confirm`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': internalSecret },
      body: '{}',
    },
  );
  if (!confirmResponse.ok) throw new Error(`HTTP confirm failed: ${confirmResponse.status}`);
  const folderBanque = await prisma.folder.findFirstOrThrow({ where: { organizationId, externalId: 'local_folder_banque' } });
  const correctResponse = await fetch(
    `${apiBase}/organizations/${organizationId}/proposals/${banque.id}/confirm`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-internal-secret': internalSecret },
      body: JSON.stringify({ finalName: 'Releve_Banque_2026-07.pdf', destinationFolderExternalId: folderBanque.externalId }),
    },
  );
  if (!correctResponse.ok) throw new Error(`HTTP correction failed: ${correctResponse.status}`);
  const rejectResponse = await fetch(
    `${apiBase}/organizations/${organizationId}/proposals/${paie.id}/reject`,
    { method: 'POST', headers: { 'x-internal-secret': internalSecret } },
  );
  if (!rejectResponse.ok) throw new Error(`HTTP reject failed: ${rejectResponse.status}`);

  const history = await prisma.actionHistory.findMany({ where: { organizationId } });
  if (history.length !== 3 || !history.some((item) => item.action === 'REJECT')) {
    throw new Error('Decisions did not persist action history');
  }
  const rejected = await prisma.document.findUniqueOrThrow({
    where: { organizationId_externalId: { organizationId, externalId: 'local_file_note_paie' } },
  });
  if (rejected.status !== 'MANUAL') {
    throw new Error('Rejected document was not marked MANUAL');
  }
  const relaunch = await fetch(`${apiBase}/organizations/${organizationId}/drive/launch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-secret': internalSecret },
    body: JSON.stringify({ itemExternalId: 'local_input_folder' }),
  });
  const relaunchPayload = await relaunch.json();
  if (relaunchPayload.enqueued !== 0) {
    throw new Error(`Rejected/proposed/classified items were resubmitted: ${JSON.stringify(relaunchPayload)}`);
  }

  const queueResponse = await fetch(`${apiBase}/organizations/${organizationId}/dashboard`, {
    headers: { 'x-internal-secret': internalSecret },
  });
  const dashboard = await queueResponse.json();
  if (dashboard.queue.queued !== 0 || dashboard.queue.active !== 0 || dashboard.queue.failed !== 0) {
    throw new Error(`Queue not idle after processing: ${JSON.stringify(dashboard.queue)}`);
  }

  console.log('integration ok: reference tree -> selected Drive launch -> pg-boss analysis -> Mongo/PostgreSQL assertions -> confirm/correct/reject');
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
  await prisma.classificationRule.createMany({
    data: [
      {
        organizationId,
        priority: 1,
        destinationPath: '/Comptabilité/Électricité',
        suggestedNameTemplate: 'Facture_Electricite_2026-07.pdf',
      },
      {
        organizationId,
        priority: 2,
        destinationPath: '/Comptabilité/Banque',
        suggestedNameTemplate: 'Releve_Banque_2026-07.pdf',
      },
      {
        organizationId,
        priority: 3,
        destinationPath: '/Social/Paie',
        suggestedNameTemplate: 'Note_Paie_2026-07.png',
      },
    ],
  });
  const rules = await prisma.classificationRule.findMany({ where: { organizationId }, orderBy: { priority: 'asc' } });
  await prisma.ruleCondition.createMany({
    data: [
      { ruleId: rules[0].id, field: 'CONTENT', operator: 'CONTAINS', value: 'électricité' },
      { ruleId: rules[1].id, field: 'CONTENT', operator: 'CONTAINS', value: 'bancaire' },
      { ruleId: rules[2].id, field: 'CONTENT', operator: 'CONTAINS', value: 'paie' },
    ],
  });
}

async function waitForProposals(organizationId, count) {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const proposals = await prisma.classificationProposal.findMany({
      where: { organizationId, status: 'PENDING' },
      include: { document: true },
    });
    if (proposals.length === count) return proposals;
    await delay(250);
  }
  throw new Error('Analysis jobs did not create the expected pending proposals');
}

async function assertDatabases(organizationId, documentIds) {
  const [documents, proposals, metrics] = await Promise.all([
    prisma.document.findMany({ where: { organizationId } }),
    prisma.classificationProposal.findMany({ where: { organizationId } }),
    prisma.usageMetric.findMany({ where: { organizationId } }),
  ]);
  if (documents.filter((document) => document.status === 'PROPOSED').length !== 3) {
    throw new Error('PostgreSQL document metadata was not updated by analysis');
  }
  if (proposals.length !== 3 || proposals.some((proposal) => proposal.source !== 'RULE' || !proposal.destinationFolderExternalId)) {
    throw new Error('PostgreSQL proposal was not created by classification');
  }
  if (!metrics.some((metric) => metric.documentsIn === 4 && metric.ocrRuns === 3 && metric.ruleMatches === 3)) {
    throw new Error('Usage metrics were not incremented by the pipeline');
  }
  const collection = mongo.db('klasr').collection('analyses');
  const indexes = await collection.indexes();
  if (!indexes.some((index) => index.expireAfterSeconds === 30 * 24 * 3600)) {
    throw new Error('Mongo analyses TTL index missing');
  }
  const analyses = await collection.find({ organizationId, documentId: { $in: documentIds } }).toArray();
  if (analyses.length !== 3 || analyses.some((analysis) => 'ocrExcerpt' in analysis)) {
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
