import { db } from '@ecofinance/db';
import { financeRead } from '@/lib/finance-http';
import { copyPreview } from '@/lib/planning-budget';
export const dynamic='force-dynamic';
export async function GET(request:Request) {return financeRead(request,owner=>copyPreview(db,owner,new URL(request.url).searchParams.get('from')??''));}
