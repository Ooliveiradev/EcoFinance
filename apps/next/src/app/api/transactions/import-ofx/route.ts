import { db } from '@ecofinance/db';
import { uploadImports } from '@/lib/import-upload';
export const dynamic = 'force-dynamic';
export async function POST(request: Request) { return uploadImports(db, request); }
