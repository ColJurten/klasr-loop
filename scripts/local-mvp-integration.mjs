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
let providerFixture;

try {
  await resetLocalData();
  providerFixture = spawn(process.execPath, ['scripts/byok-provider-fixture.mjs'], { cwd: root, detached: true, stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, BYOK_FIXTURE_PORT: '3110', BYOK_FIXTURE_AUTH: 'Bearer synthetic-fixture-token' } });
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
  await assertByok(organizationId);
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
  if (!inputItems.some((item) => item.externalId === 'local_folder_compta' && item.eligible)) {
    throw new Error('Normal inherited subtree was not offered as input');
  }
  if (inputItems.some((item) => item.externalId === 'local_root_cabinet')) {
    throw new Error('Reference root was offered as input');
  }

  const syncResponse = await fetch(`${apiBase}/organizations/${organizationId}/drive/launch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-secret': internalSecret },
    body: JSON.stringify({ itemExternalId: 'local_input_folder' }),
  });
  if (!syncResponse.ok) throw new Error(`HTTP launch failed: ${syncResponse.status}`);
  const sync = await syncResponse.json();
  if (sync.enqueued !== 4 || sync.manual !== 0) throw new Error(`Expected four reviewable jobs, got ${JSON.stringify(sync)}`);

  const proposals = await waitForProposals(organizationId, 4);
  const facture = proposals.find((proposal) => proposal.document.externalId === 'local_file_facture_elec');
  const banque = proposals.find((proposal) => proposal.document.externalId === 'local_file_releve_banque');
  const paie = proposals.find((proposal) => proposal.document.externalId === 'local_file_note_paie');
  const archive = proposals.find((proposal) => proposal.document.externalId === 'local_file_unsupported');
  if (!facture || !banque || !paie || !archive) {
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
  const ignoreResponse = await fetch(
    `${apiBase}/organizations/${organizationId}/proposals/${paie.id}/ignore`,
    { method: 'POST', headers: { 'x-internal-secret': internalSecret } },
  );
  if (!ignoreResponse.ok) throw new Error(`HTTP ignore failed: ${ignoreResponse.status}`);
  const archiveIgnoreResponse = await fetch(
    `${apiBase}/organizations/${organizationId}/proposals/${archive.id}/ignore`,
    { method: 'POST', headers: { 'x-internal-secret': internalSecret } },
  );
  if (!archiveIgnoreResponse.ok) throw new Error(`HTTP archive ignore failed: ${archiveIgnoreResponse.status}`);

  const history = await prisma.actionHistory.findMany({ where: { organizationId } });
  const ignoredHistory = history.filter((item) => item.action === 'IGNORED');
  if (history.length !== 4 || ignoredHistory.length !== 2 || ignoredHistory.some((item) => item.toPath !== null || item.toName !== null)) {
    throw new Error('Decisions did not persist action history');
  }
  const ignored = await prisma.document.findUniqueOrThrow({
    where: { organizationId_externalId: { organizationId, externalId: 'local_file_note_paie' } },
  });
  if (ignored.status !== 'IGNORED') {
    throw new Error('Ignored document was not marked IGNORED');
  }
  if (await prisma.classificationProposal.count({ where: { organizationId, status: 'PENDING' } }) !== 0) {
    throw new Error('Ignored proposals remained in the review list');
  }
  const relaunch = await fetch(`${apiBase}/organizations/${organizationId}/drive/launch`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-internal-secret': internalSecret },
    body: JSON.stringify({ itemExternalId: 'local_input_folder' }),
  });
  const relaunchPayload = await relaunch.json();
  if (relaunchPayload.enqueued !== 0) {
    throw new Error(`Ignored/proposed/classified items were resubmitted: ${JSON.stringify(relaunchPayload)}`);
  }

  const jobStates = await prisma.$queryRaw`
    SELECT state::text AS state, COUNT(*)::int AS count
    FROM pgboss.job
    WHERE name = 'analysis'
      AND data->>'organizationId' = ${organizationId}
    GROUP BY state
  `;
  if (jobStates.some(({ state }) => state !== 'completed')) {
    throw new Error(`Analysis jobs did not all complete: ${JSON.stringify(jobStates)}`);
  }

  console.log('integration ok: ignored state terminal; pending review count 0; re-analysis enqueued 0; IGNORED history has null destination/name');
} finally {
  stopApi();
  stopProcess(providerFixture);
  await resetLocalData();
  await mongo.close().catch(() => undefined);
  await prisma.$disconnect();
}

async function assertByok(organizationId) {
  const input = { provider: 'openai-compatible', apiKey: 'synthetic-fixture-token', baseUrl: 'http://127.0.0.1:3110/v1' };
  const headers = { 'content-type': 'application/json', 'x-internal-secret': internalSecret };
  await assertByokRejections(organizationId, input, headers);
  const discovery = await fetch(`${apiBase}/organizations/${organizationId}/llm-settings/models`, { method: 'POST', headers, body: JSON.stringify(input) });
  if (!discovery.ok || JSON.stringify(await discovery.json()) !== JSON.stringify({ models: ['fixture-a', 'fixture-z'] })) throw new Error('BYOK model discovery failed');
  const save = await fetch(`${apiBase}/organizations/${organizationId}/llm-settings`, { method: 'PUT', headers, body: JSON.stringify({ ...input, model: 'fixture-z' }) });
  if (!save.ok) throw new Error(`BYOK save failed: ${save.status}`);
  const safeBody = JSON.stringify(await save.json());
  if (safeBody.includes(input.apiKey) || safeBody.includes('encryptedApiKey')) throw new Error('BYOK safe response disclosed credential material');
  const stored = await prisma.llmSetting.findUniqueOrThrow({ where: { organizationId } });
  if (stored.encryptedApiKey === input.apiKey || stored.model !== 'fixture-z') throw new Error('BYOK encrypted persistence failed');
  const other = await fetch(`${apiBase}/organizations/nonexistent-tenant/llm-settings`, { headers: { 'x-internal-secret': internalSecret } });
  if (!other.ok || (await other.json()).configured !== false) throw new Error('BYOK tenant isolation failed');
}

/**
 * Every rejection below crosses the real Nest HTTP boundary and the real fixture socket
 * before any valid configuration exists, so a stored row afterwards would be a persistence leak.
 */
async function assertByokRejections(organizationId, input, headers) {
  const wrongKey = { ...input, apiKey: 'wrong-synthetic-fixture-token' };
  const settingsUrl = `${apiBase}/organizations/${organizationId}/llm-settings`;
  const attempt = async (method, path, body) => {
    const response = await fetch(`${settingsUrl}${path}`, { method, headers, body: JSON.stringify(body) });
    const payload = await response.json();
    const serialized = JSON.stringify(payload);
    if (serialized.includes(body.apiKey) || /encryptedApiKey|choices|prompt/.test(serialized)) {
      throw new Error('BYOK rejection disclosed credential material or a raw provider body');
    }
    return { status: response.status, payload };
  };

  const rejectedDiscovery = await attempt('POST', '/models', wrongKey);
  if (rejectedDiscovery.status !== 400 || rejectedDiscovery.payload.code !== 'invalid_key') {
    throw new Error(`BYOK wrong key was not reported as invalid: ${JSON.stringify(rejectedDiscovery)}`);
  }
  const rejectedSave = await attempt('PUT', '', { ...wrongKey, model: 'fixture-z' });
  if (rejectedSave.status !== 400 || rejectedSave.payload.code !== 'invalid_key') {
    throw new Error(`BYOK wrong key save was not reported as invalid: ${JSON.stringify(rejectedSave)}`);
  }

  for (const model of ['fixture-legacy', 'fixture-unprocessable']) {
    const refusedModel = await attempt('PUT', '', { ...input, model });
    if (refusedModel.status !== 400 || refusedModel.payload.code !== 'model_incompatible') {
      throw new Error(`BYOK refused model ${model} was not reported as incompatible: ${JSON.stringify(refusedModel)}`);
    }
  }
  const unusableEndpoint = await attempt('POST', '/models', { ...input, baseUrl: 'http://127.0.0.1:3110/refuse/v1' });
  if (unusableEndpoint.status !== 400 || unusableEndpoint.payload.code !== 'endpoint_unavailable') {
    throw new Error(`BYOK unusable endpoint was not distinguished from an incompatible model: ${JSON.stringify(unusableEndpoint)}`);
  }

  if (await prisma.llmSetting.count({ where: { organizationId } }) !== 0) {
    throw new Error('BYOK persisted a setting for a rejected key or model');
  }
}

async function resetLocalData() {
  await mongo.connect();
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
  await mongo.db('klasr').collection('analyses').deleteMany({ organizationId });
  await prisma.$executeRaw`DELETE FROM pgboss.job WHERE name = 'analysis' AND data->>'organizationId' = ${organizationId}`;
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
      emailVerified: true,
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
  if (documents.filter((document) => document.status === 'PROPOSED').length !== 4) {
    throw new Error('PostgreSQL document metadata was not updated by analysis');
  }
  const reviewProposal = proposals.find((proposal) => !proposal.destinationFolderExternalId);
  if (proposals.length !== 4 || proposals.filter((proposal) => proposal.source === 'RULE' && proposal.destinationFolderExternalId).length !== 3 || !reviewProposal?.reviewRequired) {
    throw new Error('PostgreSQL proposal was not created by classification');
  }
  if (!metrics.some((metric) => metric.documentsIn === 4 && metric.ocrRuns === 4 && metric.ruleMatches === 3)) {
    throw new Error('Usage metrics were not incremented by the pipeline');
  }
  const collection = mongo.db('klasr').collection('analyses');
  const indexes = await collection.indexes();
  if (!indexes.some((index) => index.expireAfterSeconds === 30 * 24 * 3600)) {
    throw new Error('Mongo analyses TTL index missing');
  }
  const analyses = await collection.find({ organizationId, documentId: { $in: documentIds } }).toArray();
  if (analyses.length !== 4 || analyses.some((analysis) => 'ocrExcerpt' in analysis)) {
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
function stopProcess(processHandle) {
  if (!processHandle?.pid) return;
  try { process.kill(-processHandle.pid, 'SIGTERM'); } catch { processHandle.kill('SIGTERM'); }
}
