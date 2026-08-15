import { readFile } from 'node:fs/promises';
import { basename, extname, resolve } from 'node:path';
import { FolderNode } from './agents/agent.types';
import { createLlmProvider } from './llm/provider.factory';
import { SuggestionService } from './suggestion.service';

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2); const file = value(args, '--file');
  if (!file || !['filename', 'destination'].includes(command)) throw new Error('usage: filename|destination --file <path> [--dir <path>]');
  const absolute = await locate(file); const input = { content: await readFile(absolute), mimeType: mime(absolute), originalName: basename(absolute) };
  const service = new SuggestionService(createLlmProvider());
  const output = command === 'filename' ? await service.suggestFilename(input) : await service.suggestDestination(input, tree(values(args, '--dir')));
  process.stdout.write(`${JSON.stringify(output)}\n`);
}
function value(args: string[], flag: string): string | undefined { const index = args.indexOf(flag); return index >= 0 ? args[index + 1] : undefined; }
function values(args: string[], flag: string): string[] { return args.flatMap((item, index) => item === flag && args[index + 1] ? [args[index + 1]] : []); }
function mime(path: string): string { return extname(path).toLowerCase() === '.pdf' ? 'application/pdf' : extname(path).toLowerCase() === '.json' ? 'application/json' : 'text/plain'; }
async function locate(path: string): Promise<string> { for (const candidate of [resolve(path), resolve(process.cwd(), '../..', path)]) { try { await readFile(candidate); return candidate; } catch { continue; } } throw new Error('file_not_found'); }
function tree(paths: string[]): FolderNode[] { return paths.map((path, index) => ({ id: String(index), name: path.split('/').filter(Boolean).at(-1) ?? path, path, children: [] })); }
void main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : 'CLI failed'}\n`); process.exitCode = 1; });
