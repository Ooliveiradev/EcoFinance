import type { RecurrenceSchedule, ScheduleVersion,CardEntryType, ImportCandidate, ImportLayout, ImportMapping, ImportProgress, CategorySuggestion } from '@ecofinance/shared';
// Compile-time aliases to the frozen SQL schema retained for export/rollback.
import type * as finance from './schema';
import type * as auth from './auth-schema';
export interface Models {
  users: typeof finance.users.$inferSelect;
  categories: typeof finance.categories.$inferSelect & {revision?:string};
  accounts: typeof finance.accounts.$inferSelect & {color?:string; sortOrder?:number; revision?:string};
  uberTripsMetadata: typeof finance.uberTripsMetadata.$inferSelect;
  transactions: typeof finance.transactions.$inferSelect & {importReferences?:string[]; importUndoBatchId?:string|null; importUndoRevision?:string|null; notes?:string|null; transferId?:string|null; revision?:string;cardEntryType?:CardEntryType;refundOfId?:string|null;reconciledIntoId?:string|null;cardOriginal?:{kind:string;status:string;paidDate:string|null;competenceMonth:string}};
  recurrenceRules: typeof finance.recurrenceRules.$inferSelect & {versions?:ScheduleVersion[]; revision?:string};
  recurrenceOccurrences: typeof finance.recurrenceOccurrences.$inferSelect & {snapshot?:RecurrenceSchedule; overridden?:boolean; transactionId?:string|null; revision?:string};
  budgets: typeof finance.budgets.$inferSelect & {revision?:string};
  budgetCategories: typeof finance.budgetCategories.$inferSelect & {inactive?:boolean};
  cards: typeof finance.cards.$inferSelect & {revision?:string};
  invoices: typeof finance.invoices.$inferSelect & {revision?:string;previousBalance?:string;paymentAccountId?:string;closed?:boolean};
  installmentGroups: typeof finance.installmentGroups.$inferSelect;
  installments: typeof finance.installments.$inferSelect;
  importBatches: typeof finance.importBatches.$inferSelect & {revision?:string;filename?:string;mime?:string;payload?:string|null;format?:string;error?:string|null;accountHint?:string|null;processId?:string|null;layout?:ImportLayout|null;mapping?:ImportMapping|null;errorCode?:string|null;progress?:ImportProgress|null};
  importItems: typeof finance.importItems.$inferSelect & {revision?:string;externalId?:string|null;selected?:boolean;resolution?:'new'|'link'|'exclude';duplicateId?:string|null;candidates?:ImportCandidate[];createdTransaction?:boolean;committedRevision?:string|null;undoReason?:string|null;suggestion?:CategorySuggestion|null};
  preferences: typeof finance.preferences.$inferSelect;
  financialMigrationAudits: typeof finance.financialMigrationAudits.$inferSelect;
  authSessions: typeof auth.authSessions.$inferSelect;
  authAccounts: typeof auth.authAccounts.$inferSelect;
  authVerifications: typeof auth.authVerifications.$inferSelect;
  authRateLimits: typeof auth.authRateLimits.$inferSelect;
  planningMonths: {id:string;ownerId:string;competenceMonth:string;closedAt:Date|null;revision:string;updatedAt:Date};
  operations: {id:string; ownerId:string; action:string; hash:string; result:Record<string,unknown>; createdAt:Date};
}
export type Collection = keyof Models;
export type OwnedCollection = { [K in Collection]: Models[K] extends { ownerId: string } ? K : never }[Collection];
