import { describe, expect, it } from 'vitest';
import { resolveItem1EvidenceProvenance, resolvePlaywrightRuntime } from '../playwright-runtime';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

describe('Playwright live OAuth runtime', () => {
  const evidenceEnv = {
    KLASR_ITEM1_TASK: 't_f9f99790', KLASR_ITEM1_ATTEMPT: '5d',
    KLASR_ITEM1_RUN: '58', KLASR_ITEM1_EVIDENCE_FILE: 'provider-db-proof-attempt5d.sanitized.json',
  };

  it.each([
    ['t_d8cdd3ad', '5f', '62', 'provider-db-proof-attempt5f.sanitized.json'],
    ['t_0123abcd', 'next-1', '7', 'provider-db-proof-attemptnext-1.sanitized.json'],
  ])('preserves valid invocation provenance', (task, attempt, run, outputFilename) => {
    expect(resolveItem1EvidenceProvenance({ KLASR_ITEM1_TASK: task, KLASR_ITEM1_ATTEMPT: attempt, KLASR_ITEM1_RUN: run, KLASR_ITEM1_EVIDENCE_FILE: outputFilename }))
      .toEqual({ task, attempt, run: Number(run), outputFilename });
  });

  it.each([
    {},
    { ...evidenceEnv, KLASR_ITEM1_TASK: 'task unsafe' },
    { ...evidenceEnv, KLASR_ITEM1_ATTEMPT: '../5d' },
    { ...evidenceEnv, KLASR_ITEM1_RUN: '057' },
    { ...evidenceEnv, KLASR_ITEM1_RUN: '999999999999999999999' },
    { ...evidenceEnv, KLASR_ITEM1_EVIDENCE_FILE: '../proof.json' },
    { ...evidenceEnv, KLASR_ITEM1_EVIDENCE_FILE: 'provider-db-proof-attempt5c.sanitized.json' },
  ])('fails closed for missing, malformed, or inconsistent evidence provenance %#', (candidate) => {
    expect(() => resolveItem1EvidenceProvenance(candidate)).toThrow('Invalid Item-1 evidence provenance');
  });

  it('keeps the committed launcher invocation-bound without stale provenance', () => {
    const launcher = '../../scripts/run-item1-live.sh';
    const source = readFileSync(launcher, 'utf8');
    expect(statSync(launcher).mode & 0o111).not.toBe(0);
    for (const key of Object.keys(evidenceEnv)) expect(source).toContain(key);
    for (const stale of ['t_f9f99790', '5d', '58', 'provider-db-proof-attempt5d.sanitized.json']) expect(source).not.toContain(stale);
    for (const key of Object.keys(evidenceEnv)) expect(source).not.toMatch(new RegExp(`${key}=[^"'$\\s]`));
    expect(source.indexOf('resolveItem1EvidenceProvenance(process.env)')).toBeLessThan(source.indexOf('credential=.tmp/'));
    expect(source).toContain('sanitized_evidence=$KLASR_ITEM1_EVIDENCE_FILE');
  });

  it.each(['KLASR_ITEM1_TASK', 'KLASR_ITEM1_ATTEMPT', 'KLASR_ITEM1_RUN', 'KLASR_ITEM1_EVIDENCE_FILE'])('fails before env, credential, or pnpm access when %s is missing', (missing) => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'item1-launcher-'));
    try {
      mkdirSync(path.join(fixture, 'scripts'));
      mkdirSync(path.join(fixture, 'apps/web'), { recursive: true });
      cpSync('../../scripts/run-item1-live.sh', path.join(fixture, 'scripts/run-item1-live.sh'));
      cpSync('playwright-runtime.ts', path.join(fixture, 'apps/web/playwright-runtime.ts'));
      writeFileSync(path.join(fixture, 'apps/web/.env.local'), 'touch "$KLASR_SENTINEL/env"\n');
      mkdirSync(path.join(fixture, '.tmp/hermes/ux-clarity'), { recursive: true });
      writeFileSync(path.join(fixture, '.tmp/hermes/ux-clarity/.item1-staging-login.json'), '{}');
      mkdirSync(path.join(fixture, 'bin'));
      writeFileSync(path.join(fixture, 'bin/pnpm'), '#!/bin/sh\ntouch "$KLASR_SENTINEL/pnpm"\nexit 99\n', { mode: 0o755 });
      const sentinel = path.join(fixture, 'sentinel');
      mkdirSync(sentinel);
      const env = { ...process.env, PATH: `${path.join(fixture, 'bin')}:${process.env.PATH}`, KLASR_SENTINEL: sentinel, ...evidenceEnv };
      delete env[missing];
      expect(() => execFileSync('bash', [path.join(fixture, 'scripts/run-item1-live.sh')], { env, stdio: 'pipe' })).toThrow();
      expect(readFileSync(path.join(fixture, 'apps/web/.env.local'), 'utf8')).not.toContain('accessed');
      expect(readFileSync(path.join(fixture, '.tmp/hermes/ux-clarity/.item1-staging-login.json'), 'utf8')).toBe('{}');
      expect(() => statSync(path.join(sentinel, 'env'))).toThrow();
      expect(() => statSync(path.join(sentinel, 'pnpm'))).toThrow();
    } finally { rmSync(fixture, { recursive: true, force: true }); }
  });

  it.each([
    { ...evidenceEnv, KLASR_ITEM1_TASK: 'unsafe task' },
    { ...evidenceEnv, KLASR_ITEM1_ATTEMPT: '../5f' },
    { ...evidenceEnv, KLASR_ITEM1_RUN: '062' },
    { ...evidenceEnv, KLASR_ITEM1_EVIDENCE_FILE: 'provider-db-proof-attempt5e.sanitized.json' },
  ])('rejects malformed provenance before env or pnpm access', (candidate) => {
    const fixture = mkdtempSync(path.join(tmpdir(), 'item1-launcher-'));
    try {
      mkdirSync(path.join(fixture, 'scripts'));
      mkdirSync(path.join(fixture, 'apps/web'), { recursive: true });
      cpSync('../../scripts/run-item1-live.sh', path.join(fixture, 'scripts/run-item1-live.sh'));
      cpSync('playwright-runtime.ts', path.join(fixture, 'apps/web/playwright-runtime.ts'));
      writeFileSync(path.join(fixture, 'apps/web/.env.local'), 'touch "$KLASR_SENTINEL/env"\n');
      mkdirSync(path.join(fixture, '.tmp/hermes/ux-clarity'), { recursive: true });
      const credential = path.join(fixture, '.tmp/hermes/ux-clarity/.item1-staging-login.json');
      writeFileSync(credential, '{}');
      mkdirSync(path.join(fixture, 'bin'));
      writeFileSync(path.join(fixture, 'bin/pnpm'), '#!/bin/sh\ntouch "$KLASR_SENTINEL/pnpm"\nexit 99\n', { mode: 0o755 });
      const sentinel = path.join(fixture, 'sentinel');
      mkdirSync(sentinel);
      expect(() => execFileSync('bash', [path.join(fixture, 'scripts/run-item1-live.sh')], { env: { ...process.env, PATH: `${path.join(fixture, 'bin')}:${process.env.PATH}`, KLASR_SENTINEL: sentinel, ...candidate }, stdio: 'pipe' })).toThrow();
      expect(() => statSync(path.join(sentinel, 'env'))).toThrow();
      expect(() => statSync(path.join(sentinel, 'pnpm'))).toThrow();
      expect(readFileSync(credential, 'utf8')).toBe('{}');
      expect(() => statSync(path.join(fixture, '.tmp/hermes/ux-clarity/evidence/item-1', candidate.KLASR_ITEM1_EVIDENCE_FILE))).toThrow();
    } finally { rmSync(fixture, { recursive: true, force: true }); }
  });

  it('disconnects the local evidence Prisma client in a finally block', () => {
    const source = readFileSync('e2e/item-1-auth.spec.ts', 'utf8');
    expect(source).toMatch(/test\.afterAll[\s\S]*?try\s*{[\s\S]*?}\s*finally\s*{[\s\S]*?\$disconnect\(\)/);
    expect(source).toMatch(/const prisma = new PrismaClient\(\);\s*try\s*{[\s\S]*?organization\.count[\s\S]*?}\s*finally\s*{[\s\S]*?\$disconnect\(\)/);
  });

  it('validates provenance before the live spec can read protected credentials', () => {
    const source = readFileSync('e2e/item-1-live.spec.ts', 'utf8');
    expect(source.indexOf('resolveItem1EvidenceProvenance(process.env)')).toBeLessThan(source.indexOf('readFileSync(credentialPath'));
    expect(source).not.toContain("provider-db-proof-attempt5b.sanitized.json");
  });
  it('keeps ordinary E2E on 127.0.0.1:4300 without forwarding OAuth credentials', () => {
    const runtime = resolvePlaywrightRuntime({ GOOGLE_CLIENT_SECRET: 'not-for-children' });
    expect(runtime).toMatchObject({ live: false, webUrl: 'http://127.0.0.1:4300', hostname: '127.0.0.1', port: 4300 });
    expect(runtime.callbackUrl).toBe('http://127.0.0.1:4300/api/auth/callback/google');
    expect(runtime.apiEnv).not.toHaveProperty('GOOGLE_CLIENT_SECRET');
  });

  it('uses the exact authorized live origin and scopes OAuth env to the web child', () => {
    const runtime = resolvePlaywrightRuntime({
      PATH: '/bin', KLASR_ITEM1_LIVE: 'true', NEXTAUTH_URL: 'http://127.0.0.1:4400',
      NEXTAUTH_SECRET: 'auth-secret', GOOGLE_CLIENT_ID: 'client-id', GOOGLE_CLIENT_SECRET: 'client-secret',
    });
    expect(runtime).toMatchObject({ live: true, webUrl: 'http://127.0.0.1:4400', hostname: '127.0.0.1', port: 4400 });
    expect(runtime.callbackUrl).toBe('http://127.0.0.1:4400/api/auth/callback/google');
    expect(runtime.webEnv).toMatchObject({ NEXTAUTH_URL: 'http://127.0.0.1:4400', NEXTAUTH_SECRET: 'auth-secret', GOOGLE_CLIENT_ID: 'client-id', GOOGLE_CLIENT_SECRET: 'client-secret' });
    for (const key of ['NEXTAUTH_URL', 'NEXTAUTH_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']) expect(runtime.apiEnv).not.toHaveProperty(key);
  });

  it.each([
    {},
    { NEXTAUTH_URL: 'not-a-url' },
    { NEXTAUTH_URL: 'ftp://127.0.0.1:4400' },
    { NEXTAUTH_URL: 'http://127.0.0.1' },
    { NEXTAUTH_URL: 'http://user:password@127.0.0.1:4400' },
    { NEXTAUTH_URL: 'http://127.0.0.1:4400/path' },
  ])('fails closed for invalid live config %#', (candidate) => {
    expect(() => resolvePlaywrightRuntime({ KLASR_ITEM1_LIVE: 'true', NEXTAUTH_SECRET: 'x', GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'x', ...candidate })).toThrow('Invalid Item-1 live OAuth configuration');
  });

  it.each(['NEXTAUTH_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'])('fails closed when %s is missing', (missing) => {
    const env: Record<string, string> = { KLASR_ITEM1_LIVE: 'true', NEXTAUTH_URL: 'http://127.0.0.1:4400', NEXTAUTH_SECRET: 'x', GOOGLE_CLIENT_ID: 'x', GOOGLE_CLIENT_SECRET: 'x' };
    delete env[missing];
    expect(() => resolvePlaywrightRuntime(env)).toThrow('Invalid Item-1 live OAuth configuration');
  });
});
