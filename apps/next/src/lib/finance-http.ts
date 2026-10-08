import { ZodError } from '@ecofinance/shared';
import { authorize } from './session';
import { PRIVATE_CACHE } from './access-policy';
import { readJson } from './request-body';
import { FinanceError } from './manual-finance-service';

export async function financeRead(request:Request,callback:(ownerId:string)=>Promise<unknown>) {
  try {
    const access=await authorize(request);if(access.response)return access.response;
    return Response.json(await callback(access.userId),{headers:{'Cache-Control':PRIVATE_CACHE}});
  } catch(error) {return financeError(error);}
}
export async function financeWrite(request:Request,callback:(ownerId:string,requestId:string,input:unknown,expected:string)=>Promise<unknown>,status=200,limit=16384) {
  try {
    const access=await authorize(request);if(access.response)return access.response;
    const input=await readJson(request,limit);if(input instanceof Response)return input;
    const requestId=request.headers.get('idempotency-key')??'';
    const expected=(request.headers.get('if-match')??'').replace(/^"|"$/g,'');
    return Response.json(await callback(access.userId,requestId,input,expected),{status,headers:{'Cache-Control':PRIVATE_CACHE}});
  } catch(error) {return financeError(error);}
}
export function financeError(error:unknown) {
  const data=error instanceof FinanceError?{status:error.status,code:error.code,message:error.message}:error instanceof ZodError?{status:400,code:'INVALID_INPUT',message:'Confira os campos informados.'}:{status:503,code:'UNAVAILABLE',message:'Não foi possível acessar seus dados. Tente novamente.'};
  return Response.json({error:data.code,message:data.message},{status:data.status,headers:{'Cache-Control':PRIVATE_CACHE}});
}
export function archiveAction(input:unknown):boolean {
  if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).length!==1 || !['archive','restore'].includes(String((input as {action?:unknown}).action)))throw new FinanceError('INVALID_INPUT',400,'Ação inválida.');
  return (input as {action:string}).action==='archive';
}
