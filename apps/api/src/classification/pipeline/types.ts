/** Inputs/outputs of the classification pipeline (business components, REAC C3). */

export interface PipelineRuleCondition {
  field: 'content' | 'filename' | 'mimeType';
  operator: 'contains' | 'equals';
  value: string;
}

export interface PipelineRule {
  id: string;
  priority: number;
  conditions: PipelineRuleCondition[];
  destinationPath: string;
  suggestedNameTemplate?: string;
}

export interface PipelineInput {
  organizationId: string;
  documentId: string;
  filename: string;
  mimeType: string;
  /** OCR-extracted text — UNTRUSTED input (prompt-injection surface). */
  text: string;
  folderPaths: string[];
  rules: PipelineRule[];
}

export interface PipelineProposal {
  documentId: string;
  proposedName: string;
  destinationPath: string;
  confidence: number;
  source: 'RULE' | 'LLM';
  /** Eco-design instrumentation: external LLM calls consumed. */
  llmCallsUsed: number;
  modelUsed?: string;
}
