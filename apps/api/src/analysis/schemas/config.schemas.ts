import { z } from 'zod';

export const agentConfigSchema = z.record(z.string(), z.object({ role: z.string().min(1), goal: z.string().min(1), backstory: z.string().min(1), model: z.string().min(1) }));
export const taskConfigSchema = z.record(z.string(), z.object({ description: z.string().min(1), expected_output: z.string().min(1), agent: z.string().min(1) }));
