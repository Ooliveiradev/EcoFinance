import type { ImportLayout } from '@ecofinance/shared';
import { FinanceError } from './finance-operation';

/** Actionable parser diagnostic persisted on the batch; `layout` enables assisted mapping. */
export class ImportParseError extends FinanceError {
  constructor(code: string, message: string, public format = 'Não identificado', public layout: ImportLayout | null = null) { super(code, 422, message); }
}
export function parseError(code: string, message: string, format?: string, layout?: ImportLayout): never { throw new ImportParseError(code, message, format, layout ?? null); }
