import { appendFileSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

export function appendMultilineOutput(path, name, value, uuid = randomUUID) {
  let delimiter;
  do delimiter = `KLASR_${uuid().replaceAll('-', '')}`;
  while (value.split('\n').includes(delimiter));
  appendFileSync(path, `${name}<<${delimiter}\n${value}${value.endsWith('\n') ? '' : '\n'}${delimiter}\n`);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const [, , outputPath, name, valuePath] = process.argv;
  appendMultilineOutput(outputPath, name, readFileSync(valuePath, 'utf8'));
}
