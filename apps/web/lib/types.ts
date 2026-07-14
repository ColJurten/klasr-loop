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
