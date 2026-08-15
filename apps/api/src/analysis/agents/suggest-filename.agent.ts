import { extname } from 'node:path';
import { Agent } from './agent.types';
import { agentConfigs, taskConfigs } from '../config/load-config';
import { LlmProvider } from '../llm/llm.provider';
import { DocumentAnalysis, FilenameSuggestion, filenameSuggestionSchema } from '../schemas/results.schemas';

interface Input { analysis: DocumentAnalysis; originalName: string; convention: string; confidenceCap: number; }
export class SuggestFilenameAgent implements Agent<Input, FilenameSuggestion> {
  constructor(private readonly provider: LlmProvider, private readonly model?: string) {}
  async run(input: Input): Promise<FilenameSuggestion> {
    const extension = extname(input.originalName).toLowerCase(); const config = agentConfigs.suggest_filename; const task = taskConfigs.suggest_filename;
    try {
      const generated = await this.provider.generate({ task: 'suggest_filename', prompt: `${task.description}. ${task.expected_output}`, system: `${config.role}. ${config.goal}. ${config.backstory}. Convention: ${input.convention}.`, input: { analysis: input.analysis, extension }, model: this.model });
      const parsed = filenameSuggestionSchema.parse({ ...generated.value as object, provider: generated.provider, model: generated.model });
      const stem = sanitize(parsed.value.replace(new RegExp(`${escapeRegex(extname(parsed.value))}$`, 'i'), ''));
      if (!stem || ['document', 'scan', 'file', 'untitled'].includes(stem.toLowerCase())) throw new Error('unsafe_filename');
      return { ...parsed, value: `${stem}${extension}`, confidence: Math.min(parsed.confidence, input.confidenceCap), reviewRequired: parsed.reviewRequired || parsed.confidence > input.confidenceCap };
    } catch {
      return { value: `classement_manuel${extension}`, confidence: 0, signals: [], reviewRequired: true, failureReason: 'invalid_model_output', provider: 'none', model: this.model ?? '' };
    }
  }
}
function sanitize(value: string): string { return [...value.normalize('NFKC')].map((char) => '<>:"/\\|?*'.includes(char) || char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? '_' : char).join('').replace(/\s+/g, '_').replace(/_+/g, '_').replace(/^\.+|\.+$/g, '').slice(0, 180); }
function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
