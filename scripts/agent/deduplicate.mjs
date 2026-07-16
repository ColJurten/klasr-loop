#!/usr/bin/env node
/**
 * Usage: node deduplicate.mjs <control-comment-body-file|-> <event_key>
 * Exit 0 = fresh event (proceed) · exit 78 = duplicate (skip, "neutral").
 */
import { readFileSync, appendFileSync } from 'node:fs';
import { hasProcessed, parseControl } from './lib/control.mjs';

const [, , bodyPath, eventKey] = process.argv;
const body = bodyPath === '-' ? '' : readFileSync(bodyPath, 'utf8');
const control = parseControl(body);
const duplicate = hasProcessed(control, eventKey);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `duplicate=${duplicate}\n`);
console.log(JSON.stringify({ duplicate, event_key: eventKey }));
process.exit(duplicate ? 78 : 0);
