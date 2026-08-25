import { z } from 'zod';

export const signalSchema = z.enum(['document_type', 'document_date', 'issuer', 'invoice_number', 'parties', 'amount', 'topics', 'matched_folder_path']);
export const analysisSchema = z.object({
  subject: z.string().min(1).nullable(), documentType: z.string().min(1).nullable(), dates: z.array(z.string().date()),
  topics: z.array(z.string().min(1)), purpose: z.string().min(1).nullable(), parties: z.array(z.string().min(1)),
  identifiers: z.array(z.string().min(1)), amount: z.string().min(1).nullable().optional(), signals: z.array(signalSchema),
});
const failureSchema = z.enum(['extraction_failed', 'empty_content', 'sparse_content', 'invalid_model_output', 'insufficient_evidence', 'ambiguous_destination', 'no_destination_match', 'unsafe_filename', 'out_of_tree']);
export const filenameSuggestionSchema = z.object({ value: z.string().min(1), confidence: z.number().min(0).max(1), signals: z.array(signalSchema), reviewRequired: z.boolean(), failureReason: failureSchema.nullable(), provider: z.string(), model: z.string() });
export const destinationSuggestionSchema = z.object({ path: z.string().min(1).nullable(), confidence: z.number().min(0).max(1), signals: z.array(signalSchema), reviewRequired: z.boolean(), failureReason: failureSchema.nullable(), provider: z.string(), model: z.string() });
export type DocumentAnalysis = z.infer<typeof analysisSchema>;
export type FilenameSuggestion = z.infer<typeof filenameSuggestionSchema>;
export type DestinationSuggestion = z.infer<typeof destinationSuggestionSchema>;
