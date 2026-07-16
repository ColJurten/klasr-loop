#!/usr/bin/env node
/**
 * Usage: node update-control-state.mjs <existing-comment-body-file|-> <event_key> <patch.json>
 * Prints the new full comment body. Pure transformation; posting is a gh step.
 */
import { readFileSync } from 'node:fs';
import { emptyControl, parseControl, recordEvent, renderControlComment } from './lib/control.mjs';

const [, , bodyPath, eventKey, patchJson] = process.argv;
const patch = JSON.parse(patchJson ?? '{}');
const existing = bodyPath === '-' ? '' : readFileSync(bodyPath, 'utf8');
const control = parseControl(existing) ?? emptyControl(patch.task_id ?? null);
const updated = recordEvent(control, eventKey, patch);
process.stdout.write(renderControlComment(updated) + '\n');
