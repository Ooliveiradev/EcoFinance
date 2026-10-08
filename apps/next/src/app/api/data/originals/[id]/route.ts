import { db } from '@ecofinance/db';
import { importIdSchema } from '@ecofinance/shared';
import { financeWrite } from '@/lib/finance-http';
import { discardOriginal } from '@/lib/data-control';
import { fail } from '@/lib/finance-operation';
export const dynamic='force-dynamic';
/** Deletes only the uploaded file of an import batch. */
export async function DELETE(request:Request,{params}:{params:Promise<{id:string}>}) {
  const {id}=await params;
  return financeWrite(request,(owner,key,input,expected)=> {
    importIdSchema.parse(id);
    if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).length)fail('INVALID_INPUT',400,'Esta ação não aceita campos.');
    return discardOriginal(db,owner,key,id,expected);
  });
}
