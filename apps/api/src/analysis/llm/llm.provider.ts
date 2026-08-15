import { StructuredGeneration, StructuredResult } from './llm.types';
export interface LlmProvider { generate(request: StructuredGeneration): Promise<StructuredResult>; }
