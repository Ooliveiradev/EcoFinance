import { z } from 'zod';
import { civilDateSchema } from './finance';
export const EntryQuerySchema = z.object({
  accountId: z.string().uuid().optional(), id: z.string().uuid().optional(),
  startDate: civilDateSchema.optional(), endDate: civilDateSchema.optional(),
  description: z.string().max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).strict().refine(value => !value.startDate || !value.endDate || value.startDate <= value.endDate, 'Intervalo inválido');
export type EntryQuery = z.infer<typeof EntryQuerySchema>;
