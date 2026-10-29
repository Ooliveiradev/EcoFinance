import { db } from '@ecofinance/db';
import { financeWrite } from '@/lib/finance-http';
import { receiveCaptures } from '@/lib/capture-store';
export const dynamic = 'force-dynamic';
/** Notices from one device (#19): staged for review, never recorded directly. Idempotent per request and per notice. */
export async function POST(request: Request) { return financeWrite(request, (owner, key, input) => receiveCaptures(db, owner, key, input), 201, 64 * 1024); }
