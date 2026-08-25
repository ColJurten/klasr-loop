import { Agent, FolderNode } from './agent.types';
import { agentConfigs, taskConfigs } from '../config/load-config';
import { LlmProvider } from '../llm/llm.provider';
import { DestinationSuggestion, destinationSuggestionSchema, DocumentAnalysis } from '../schemas/results.schemas';

interface Input { analysis: DocumentAnalysis; tree: FolderNode[]; confidenceCap: number; }
export class SuggestDestinationAgent implements Agent<Input, DestinationSuggestion> {
  constructor(private readonly provider: LlmProvider, private readonly model?: string) {}
  async run(input: Input): Promise<DestinationSuggestion> {
    const paths = flatten(input.tree); const config = agentConfigs.suggest_destination; const task = taskConfigs.suggest_destination;
    try {
      const generated = await this.provider.generate({ task: 'suggest_destination', prompt: `${task.description}. ${task.expected_output}`, system: `${config.role}. ${config.goal}. ${config.backstory}.`, input: { analysis: input.analysis, folders: input.tree }, model: this.model });
      const parsed = destinationSuggestionSchema.parse({ ...generated.value as object, provider: generated.provider, model: generated.model });
      if (parsed.path && (parsed.path.includes('..') || !paths.has(parsed.path))) return { ...parsed, path: null, confidence: 0, reviewRequired: true, failureReason: 'out_of_tree' };
      return { ...parsed, confidence: Math.min(parsed.confidence, input.confidenceCap), reviewRequired: parsed.reviewRequired || parsed.confidence > input.confidenceCap || !parsed.path };
    } catch {
      return { path: null, confidence: 0, signals: [], reviewRequired: true, failureReason: 'invalid_model_output', provider: 'none', model: this.model ?? '' };
    }
  }
}
function flatten(nodes: FolderNode[], result = new Set<string>()): Set<string> { for (const node of nodes) { result.add(node.path); flatten(node.children, result); } return result; }
