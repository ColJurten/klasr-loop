/** Shared view types mirroring the API's proposal payloads. */
export interface ProposalView {
  id: string;
  proposedName: string;
  destinationPath: string;
  destinationFolderExternalId: string | null;
  confidence: number;
  filenameConfidence?: number | null;
  destinationConfidence?: number | null;
  reviewRequired?: boolean;
  reviewReason?: string | null;
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

export interface FolderChoiceView {
  externalId: string;
  name: string;
  parentExternalId: string | null;
  path: string;
  holding?: boolean;
}

export interface DriveInputItemView {
  externalId: string;
  name: string;
  mimeType: string;
  type: 'folder' | 'file';
  parentExternalId: string | null;
  supported: boolean;
  eligible: boolean;
  reason?: string;
}

export interface DashboardView {
  mode: 'local' | 'production' | 'service-account-staging';
  connection: null | {
    provider: 'GOOGLE_DRIVE' | 'ONEDRIVE';
    connectedAt: string;
    lastSyncAt: string | null;
  };
  metrics: {
    pending: number;
    analyzing: number;
    classified: number;
    outcomes: number;
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
  analysisFailures: number;
  referenceRoot: null | {
    externalId: string;
    name: string;
  };
  folders: FolderChoiceView[];
  inputItems: DriveInputItemView[];
  proposals: ProposalView[];
  history: Array<{
    id: string;
    toName: string | null;
    toPath: string | null;
    executedAt: string;
    document: { name: string };
  }>;
}
