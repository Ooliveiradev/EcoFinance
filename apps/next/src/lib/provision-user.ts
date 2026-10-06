import { randomUUID } from 'node:crypto';
import { hashPassword } from './password';
import { type Database } from '@ecofinance/db';

export function validateIdentity(email: string, password: string) {
  const normalized = email.trim().toLowerCase();
  if (normalized.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) throw new Error('Email inválido.');
  if (password.length < 12 || password.length > 128) throw new Error('Senha deve ter de 12 a 128 caracteres.');
  return normalized;
}
// Operator-only: never expose this function as an HTTP handler.
export async function provisionUser(database: Database, input: { email: string; password: string; name?: string; ownerId?: string; reset?: boolean }) {
  const email = validateIdentity(input.email, input.password);
  const password = await hashPassword(input.password);
  return database.transaction(async tx => {
    if (input.reset) {
      const [user] = await tx.query('users', {where:[{field:'email',value:email}],limit:1});
      if (!user) throw new Error('Usuário não encontrado.');
      const accounts = await tx.query('authAccounts',{where:[{field:'userId',value:user.id},{field:'providerId',value:'credential'}]});
      const sessions = await tx.query('authSessions',{where:[{field:'userId',value:user.id}]});
      if (accounts.length !== 1) throw new Error('Conta de senha não encontrada.');
      await tx.put('authAccounts',{...accounts[0]!,password,updatedAt:new Date()});
      await tx.removeMany('authSessions',sessions.map(session => session.id));
      return user.id;
    }
    let id = input.ownerId;
    if (id) {
      const owner = await tx.get('users', id);
      if (!owner || owner.email !== null) throw new Error('Proprietário inexistente ou já associado.');
      await tx.put('users',{...owner,email,emailVerified:true,updatedAt:new Date()});
    } else {
      const name = input.name?.trim();
      if (!name || name.length > 120) throw new Error('Nome deve ter de 1 a 120 caracteres.');
      id = randomUUID();
      await tx.put('users',{id,displayName:name,email,emailVerified:true,image:null,createdAt:new Date(),updatedAt:new Date()},true);
    }
    await tx.put('authAccounts',{id:randomUUID(),userId:id,accountId:id,providerId:'credential',password,accessToken:null,refreshToken:null,idToken:null,scope:null,accessTokenExpiresAt:null,refreshTokenExpiresAt:null,createdAt:new Date(),updatedAt:new Date()},true);
    return id;
  });
}
