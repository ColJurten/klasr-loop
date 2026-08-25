export type StructuredTask = 'analyse_document' | 'suggest_filename' | 'suggest_destination';
export interface StructuredGeneration { task: StructuredTask; prompt: string; system: string; input: unknown; model?: string; }
export interface StructuredResult { value: unknown; provider: string; model: string; }
