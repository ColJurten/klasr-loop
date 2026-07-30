/** Shared view types mirroring the API's proposal payloads. */
export interface ProposalView {
  id: string;
  proposedName: string;
  destinationPath: string;
  confidence: number;
  source: 'RULE' | 'LLM';
  /** L'IA suggère de créer un dossier absent de l'arborescence (état pêche). */
  isNewFolder?: boolean;
  document: {
    id: string;
    name: string;
    mimeType: string;
    sizeBytes: number;
  };
}

export interface DashboardView {
  mode: 'local' | 'production';
  connection: null | {
    provider: 'GOOGLE_DRIVE' | 'ONEDRIVE';
    connectedAt: string;
    lastSyncAt: string | null;
  };
  metrics: {
    pending: number;
    analyzing: number;
    classified: number;
    documentsIn: number;
    ruleMatches: number;
    llmCalls: number;
    ocrRuns: number;
  };
  queue: {
    queued: number;
    ready: number;
    active: number;
    failed: number;
    inlineWorker: boolean;
    consuming: boolean;
  };
  proposals: ProposalView[];
  history: Array<{
    id: string;
    toName: string | null;
    toPath: string | null;
    executedAt: string;
    document: { name: string };
  }>;
}
