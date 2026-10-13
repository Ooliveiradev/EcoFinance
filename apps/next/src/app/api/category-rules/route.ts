import { db } from '@ecofinance/db';
import { financeRead, financeWrite } from '@/lib/finance-http';
import { categoryRules, saveUserRule } from '@/lib/category-rules';
import { assistConfig } from '@/lib/assist-ollama';
export const dynamic = 'force-dynamic';
/** Rules plus whether a local model is configured; the model address is never exposed. */
export async function GET(request: Request) {
  return financeRead(request, async owner => ({ rules: await categoryRules(db, owner), assistant: assistConfig() ? { model: assistConfig()!.model } : null }));
}
export async function POST(request: Request) { return financeWrite(request, (owner, key, input) => saveUserRule(db, owner, key, input), 201); }
