import { db } from '@ecofinance/db';
import { financeRead, financeWrite } from '@/lib/finance-http';
import { categoryRules, externalAssistConsent, saveUserRule } from '@/lib/category-rules';
import { assistConfig, isExternal, providerLabel } from '@/lib/assist-ollama';
export const dynamic = 'force-dynamic';
/**
 * Rules plus the configured assistant: its name, model and whether it is external
 * (then `consent` is this user's opt-in). The address and key are never exposed.
 */
export async function GET(request: Request) {
  return financeRead(request, async owner => {
    const config = assistConfig();
    const assistant = config ? { model: config.model, provider: config.provider, label: providerLabel(config), external: isExternal(config), consent: isExternal(config) ? await externalAssistConsent(db, owner) : null } : null;
    return { rules: await categoryRules(db, owner), assistant };
  });
}
export async function POST(request: Request) { return financeWrite(request, (owner, key, input) => saveUserRule(db, owner, key, input), 201); }
