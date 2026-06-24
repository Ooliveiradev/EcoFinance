// =============================================================================
// EcoFinance Shared Types
// =============================================================================

// ---------------------------------------------------------------------------
// Enum union types (mirrors the database enums)
// ---------------------------------------------------------------------------

export type AccountType = 'banco' | 'carteira';

export type TransactionCategory =
  | 'comida'
  | 'transporte'
  | 'assinaturas'
  | 'lazer'
  | 'saude'
  | 'educacao'
  | 'moradia'
  | 'salario'
  | 'investimento'
  | 'transferencia'
  | 'desconhecido';

export type TransactionSource =
  | 'notification'
  | 'pluggy'
  | 'ofx'
  | 'manual'
  | 'uber';

// ---------------------------------------------------------------------------
// Core domain interfaces
// ---------------------------------------------------------------------------

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  balance: string;
  pluggyItemId: string | null;
  pluggyAccountId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface Transaction {
  id: string;
  accountId: string;
  description: string;
  amount: string;
  date: Date;
  category: TransactionCategory;
  source: TransactionSource;
  externalId: string | null;
  latitude: number | null;
  longitude: number | null;
  uberMetadataId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UberTripMetadata {
  id: string;
  originAddress: string;
  destinationAddress: string;
  driverName: string | null;
  durationSeconds: number | null;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// API payloads & request/response types
// ---------------------------------------------------------------------------

export interface CreateTransactionPayload {
  accountId: string;
  description: string;
  amount: string;
  date: string;
  category?: TransactionCategory;
  source?: TransactionSource;
  externalId?: string;
  latitude?: number;
  longitude?: number;
  uberMetadataId?: string;
}

export interface NotificationTransactionPayload {
  description: string;
  amount: number;
  bankName: string;
  latitude: number | null;
  longitude: number | null;
  timestamp: string;
}

export interface PluggySyncRequest {
  itemId: string;
}

export interface PluggySyncResponse {
  synced: number;
  errors: string[];
}

export interface UberWebhookPayload {
  valor: number;
  data_hora: string;
  endereco_partida: string;
  endereco_destino: string;
}

export interface NearbySearchParams {
  latitude: number;
  longitude: number;
  radiusMeters: number;
}

export interface NearbyTransaction extends Transaction {
  distanceMeters: number;
}

// ---------------------------------------------------------------------------
// Pluggy API types
// ---------------------------------------------------------------------------

export interface PluggyAuthResponse {
  apiKey: string;
}

export interface PluggyAccount {
  id: string;
  itemId: string;
  name: string;
  type: string;
  subtype: string;
  number: string;
  balance: number;
  currencyCode: string;
  bankData: {
    transferNumber: string | null;
    closingBalance: number | null;
  } | null;
}

export interface PluggyTransaction {
  id: string;
  accountId: string;
  date: string;
  description: string;
  amount: number;
  type: string;
  category: string | null;
  categoryId: string | null;
  currencyCode: string;
  creditCardMetadata: {
    installmentNumber: number | null;
    totalInstallments: number | null;
    purchaseDate: string | null;
  } | null;
}

// ---------------------------------------------------------------------------
// OFX import types
// ---------------------------------------------------------------------------

export interface ImportOfxPayload {
  accountId: string;
  fileContent: string;
}
