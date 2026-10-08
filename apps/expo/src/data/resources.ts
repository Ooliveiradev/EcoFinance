import type {
  CardRecord, ImportBatchView, InvoiceView, ManualAccountRecord, ManualCategoryRecord, ManualEntryRecord,
  MetricsReport, MonthProjection, PlanningView,
} from '@ecofinance/shared';
import { apiRequest } from './api';
import { money } from './format';
import type { ResourceRef } from './outbox';

export interface EntriesPage { entries: ManualEntryRecord[]; page: number; hasMore: boolean }
export interface ImportSummary { id: string; filename: string; state: string; format: string; createdAt: string }
export interface References { accounts: ManualAccountRecord[]; categories: ManualCategoryRecord[] }

/** Read endpoints shared with the web; every number comes from the server's shared calculation. */
export const read = {
  report: (month: string) => apiRequest<{ report: MetricsReport; projection: MonthProjection }>({ path: '/api/reports', query: { from: month, to: month, basis: 'competence' } }),
  references: async (): Promise<References> => {
    const [accounts, categories] = await Promise.all([
      apiRequest<{ accounts: ManualAccountRecord[] }>({ path: '/api/accounts' }),
      apiRequest<{ categories: ManualCategoryRecord[] }>({ path: '/api/categories' }),
    ]);
    return { accounts: accounts.accounts, categories: categories.categories };
  },
  entries: (month: string, page = 1) => apiRequest<EntriesPage>({ path: '/api/entries', query: { competenceMonth: month + '-01', page: String(page), limit: '50' } }),
  entry: async (id: string) => {
    for (const archived of ['false', 'true']) {
      const page = await apiRequest<EntriesPage>({ path: '/api/entries', query: { id, archived } });
      if (page.entries[0]) return page.entries[0];
    }
    return null;
  },
  planning: (month: string) => apiRequest<PlanningView>({ path: `/api/planning/${month}` }),
  cards: () => apiRequest<{ cards: CardRecord[] }>({ path: '/api/cards' }),
  invoice: (cardId: string, month: string) => apiRequest<InvoiceView>({ path: `/api/cards/${cardId}/invoices/${month}` }),
  imports: () => apiRequest<{ batches: ImportSummary[]; hasMore: boolean }>({ path: '/api/imports' }),
  importBatch: (id: string) => apiRequest<ImportBatchView>({ path: `/api/imports/${id}` }),
};

export interface CurrentVersion { revision: string; summary: string }
/**
 * Reads the server's current version of a conflicting record, so the person can
 * compare it with their change before deciding to keep theirs or discard it.
 */
export async function currentVersion(ref: ResourceRef): Promise<CurrentVersion | null> {
  switch (ref.type) {
    case 'entry': {
      const row = await read.entry(ref.id);
      return row && { revision: row.revision, summary: `${row.description} · ${money(row.amount)} · ${row.purchaseDate}${row.archivedAt ? ' · excluído' : ''}` };
    }
    case 'account': case 'category': {
      const { accounts, categories } = await read.references();
      const row = (ref.type === 'account' ? accounts : categories).find(item => item.id === ref.id);
      return row ? { revision: row.revision, summary: `${row.name}${row.archivedAt ? ' · arquivado' : ''}` } : null;
    }
    case 'card': {
      const row = (await read.cards()).cards.find(item => item.id === ref.id);
      return row ? { revision: row.revision, summary: `${row.name} · fecha dia ${row.closingDay}, vence dia ${row.dueDay}` } : null;
    }
    case 'occurrence': {
      const row = (await read.planning(ref.month)).occurrences.find(item => item.id === ref.id);
      return row ? { revision: row.revision, summary: `${row.description} · ${money(row.amount)} · ${row.status}` } : null;
    }
    case 'budget': {
      const plan = (await read.planning(ref.month)).plan;
      return { revision: plan?.revision ?? 'new', summary: plan ? `Limite ${money(plan.limit)} · renda prevista ${money(plan.expectedIncome)}` : 'Sem orçamento salvo' };
    }
    case 'invoice': {
      const invoice = await read.invoice(ref.cardId, ref.month);
      return { revision: invoice.revision, summary: `Fatura ${invoice.month} · restante ${money(invoice.totals.remaining)}` };
    }
  }
}
