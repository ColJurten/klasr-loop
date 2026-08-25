import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { agentConfigSchema, taskConfigSchema } from '../schemas/config.schemas';

function parseYamlMap(filename: string): Record<string, Record<string, string>> {
  const candidates = [join(__dirname, filename), join(process.cwd(), 'src/analysis/config', filename), join(process.cwd(), 'apps/api/src/analysis/config', filename)];
  const text = readFileSync(candidates.find((path) => { try { readFileSync(path); return true; } catch { return false; } })!, 'utf8');
  const result: Record<string, Record<string, string>> = {}; let section = '';
  for (const line of text.split('\n')) {
    const top = line.match(/^([a-z_]+):\s*$/); if (top) { section = top[1]; result[section] = {}; continue; }
    const field = line.match(/^ {2}([a-z_]+):\s*(.+)$/); if (field && section) result[section][field[1]] = field[2];
  }
  return result;
}
export const agentConfigs = agentConfigSchema.parse(parseYamlMap('agents.yaml'));
export const taskConfigs = taskConfigSchema.parse(parseYamlMap('tasks.yaml'));
