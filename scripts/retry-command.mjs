import { spawnSync } from 'node:child_process';

const [timeoutValue, intervalValue, command, ...args] = process.argv.slice(2);
const timeout = Number(timeoutValue);
const interval = Number(intervalValue);

if (!Number.isFinite(timeout) || timeout <= 0 || !Number.isFinite(interval) || interval <= 0 || interval > timeout || !command) {
  console.error('Usage: node scripts/retry-command.mjs <timeout-ms> <interval-ms> <command> [args...]');
  process.exit(2);
}

const deadline = Date.now() + timeout;
let lastExit = 1;

do {
  const result = spawnSync(command, args, { stdio: 'inherit', timeout: Math.max(1, deadline - Date.now()) });
  if (result.status === 0) process.exit(0);
  if (result.status !== null) lastExit = result.status;

  const remaining = deadline - Date.now();
  if (remaining <= 0) break;
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(interval, remaining));
} while (Date.now() < deadline);

process.exit(lastExit);
