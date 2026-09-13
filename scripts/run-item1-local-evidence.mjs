#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { currentTreeBinding } from './live-google-evidence.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
console.log(`tree_binding_observed=${JSON.stringify(currentTreeBinding(root))}`);
const result = spawnSync('pnpm', ['--filter', '@klasr/web', 'exec', 'playwright', 'test', 'e2e/item-1-auth.spec.ts', '--project=desktop', '--trace=off'], { cwd: root, stdio: 'inherit' });
const status = result.status ?? 1;
console.log(`playwright_exit=${status}`);
process.exit(status);
