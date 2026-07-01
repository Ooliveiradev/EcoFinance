import { z } from 'zod';

// =============================================================================
// EcoFinance Zod Validators
// =============================================================================

// ---------------------------------------------------------------------------
// Enum schemas
// ---------------------------------------------------------------------------

export const accountTypeSchema = z.enum(['banco', 'carteira']);

export const transactionCategorySchema = z.enum([
  'comida', 'transporte', 'assinaturas', 'lazer', 'saude',
  'educacao', 'moradia', 'salario', 'investimento', 'transferencia', 'desconhecido',
]);

export const transactionSourceSchema = z.enum([
  'notification', 'pluggy', 'ofx', 'manual', 'uber',
]);

// ---------------------------------------------------------------------------
// Create Transaction
// ---------------------------------------------------------------------------

export const createTransactionSchema = z.object({
  accountId: z.string().uuid({ message: 'accountId deve ser um UUID válido' }),
  description: z.string().min(1, { message: 'Descrição é obrigatória' }).max(500, { message: 'Descrição deve ter no máximo 500 caracteres' }),
  amount: z.string().regex(/^-?\d+(\.\d{1,2})?$/, { message: 'Valor deve ser um número com até 2 casas decimais (ex: "123.45")' }),
  date: z.string().datetime({ message: 'Data deve estar no formato ISO 8601' }),
  category: transactionCategorySchema.optional().default('desconhecido'),
  source: transactionSourceSchema.optional().default('manual'),
  externalId: z.string().max(255).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
  uberMetadataId: z.string().uuid({ message: 'uberMetadataId deve ser um UUID válido' }).optional(),
});

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;

// ---------------------------------------------------------------------------
// Notification Transaction (from Android notification interception)
// ---------------------------------------------------------------------------

export const notificationTransactionSchema = z.object({
  description: z.string().min(1, { message: 'Descrição da notificação é obrigatória' }),
  amount: z.number().positive({ message: 'Valor deve ser positivo' }),
  bankName: z.string().min(1, { message: 'Nome do banco é obrigatório' }),
  latitude: z.number().min(-90).max(90).nullable(),
  longitude: z.number().min(-180).max(180).nullable(),
  timestamp: z.string().datetime({ message: 'Timestamp deve estar no formato ISO 8601' }),
});

export type NotificationTransactionInput = z.infer<typeof notificationTransactionSchema>;

// ---------------------------------------------------------------------------
// Pluggy Sync
// ---------------------------------------------------------------------------

export const pluggySyncRequestSchema = z.object({
  itemId: z.string().min(1, { message: 'itemId do Pluggy é obrigatório' }),
});

export type PluggySyncRequestInput = z.infer<typeof pluggySyncRequestSchema>;

// ---------------------------------------------------------------------------
// Uber Webhook
// ---------------------------------------------------------------------------

export const uberWebhookPayloadSchema = z.object({
  valor: z.number().positive({ message: 'Valor da corrida deve ser positivo' }),
  data_hora: z.string().datetime({ message: 'data_hora deve estar no formato ISO 8601' }),
  endereco_partida: z.string().min(1, { message: 'Endereço de partida é obrigatório' }),
  endereco_destino: z.string().min(1, { message: 'Endereço de destino é obrigatório' }),
  nome_motorista: z.string().optional(),
  duracao_segundos: z.number().int().positive().optional(),
});

export type UberWebhookPayloadInput = z.infer<typeof uberWebhookPayloadSchema>;


// ---------------------------------------------------------------------------
// Nearby Search
// ---------------------------------------------------------------------------

export const nearbySearchParamsSchema = z.object({
  latitude: z.number().min(-90, { message: 'Latitude deve ser entre -90 e 90' }).max(90, { message: 'Latitude deve ser entre -90 e 90' }),
  longitude: z.number().min(-180, { message: 'Longitude deve ser entre -180 e 180' }).max(180, { message: 'Longitude deve ser entre -180 e 180' }),
  radiusMeters: z.number().positive({ message: 'Raio deve ser positivo' }).max(50000, { message: 'Raio máximo é 50km' }).default(1000),
});

export type NearbySearchParamsInput = z.infer<typeof nearbySearchParamsSchema>;

// ---------------------------------------------------------------------------
// OFX Import
// ---------------------------------------------------------------------------

export const importOfxSchema = z.object({
  accountId: z.string().uuid({ message: 'accountId deve ser um UUID válido' }),
  fileContent: z.string().min(1, { message: 'Conteúdo do arquivo OFX é obrigatório' }),
});

export type ImportOfxInput = z.infer<typeof importOfxSchema>;
