import { db } from '@ecofinance/db';
import { financeRead, financeWrite } from '@/lib/finance-http';
import { captureSources, saveCaptureSources } from '@/lib/capture-store';
export const dynamic = 'force-dynamic';
/** Apps whose notifications this user chose to turn into suggestions (#19), each with its account or card. */
export async function GET(request: Request) { return financeRead(request, async owner => ({ sources: await captureSources(db, owner) })); }
export async function PUT(request: Request) { return financeWrite(request, (owner, key, input) => saveCaptureSources(db, owner, key, input)); }
