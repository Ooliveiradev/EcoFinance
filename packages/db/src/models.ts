// Compile-time aliases to the frozen SQL schema retained for export/rollback.
import type * as finance from './schema';
import type * as auth from './auth-schema';
export interface Models {
  users: typeof finance.users.$inferSelect;
  categories: typeof finance.categories.$inferSelect;
  accounts: typeof finance.accounts.$inferSelect;
  uberTripsMetadata: typeof finance.uberTripsMetadata.$inferSelect;
  transactions: typeof finance.transactions.$inferSelect;
  recurrenceRules: typeof finance.recurrenceRules.$inferSelect;
  recurrenceOccurrences: typeof finance.recurrenceOccurrences.$inferSelect;
  budgets: typeof finance.budgets.$inferSelect;
  budgetCategories: typeof finance.budgetCategories.$inferSelect;
  cards: typeof finance.cards.$inferSelect;
  invoices: typeof finance.invoices.$inferSelect;
  installmentGroups: typeof finance.installmentGroups.$inferSelect;
  installments: typeof finance.installments.$inferSelect;
  importBatches: typeof finance.importBatches.$inferSelect;
  importItems: typeof finance.importItems.$inferSelect;
  preferences: typeof finance.preferences.$inferSelect;
  financialMigrationAudits: typeof finance.financialMigrationAudits.$inferSelect;
  authSessions: typeof auth.authSessions.$inferSelect;
  authAccounts: typeof auth.authAccounts.$inferSelect;
  authVerifications: typeof auth.authVerifications.$inferSelect;
  authRateLimits: typeof auth.authRateLimits.$inferSelect;
}
export type Collection = keyof Models;
export type OwnedCollection = { [K in Collection]: Models[K] extends { ownerId: string } ? K : never }[Collection];
