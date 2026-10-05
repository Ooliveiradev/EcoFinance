import { randomUUID } from 'node:crypto';
import { hashPassword } from './password';
import { users, authAccounts, authSessions, eq, and, type Database } from '@ecofinance/db';

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
      const [user] = await tx.select().from(users).where(eq(users.email, email)).for('update');
      if (!user) throw new Error('Usuário não encontrado.');
      const updated = await tx.update(authAccounts).set({ password, updatedAt: new Date() })
        .where(and(eq(authAccounts.userId, user.id), eq(authAccounts.providerId, 'credential'))).returning();
      if (updated.length !== 1) throw new Error('Conta de senha não encontrada.');
      await tx.delete(authSessions).where(eq(authSessions.userId, user.id));
      return user.id;
    }
    let id = input.ownerId;
    if (id) {
      const [owner] = await tx.select().from(users).where(eq(users.id, id)).for('update');
      if (!owner || owner.email !== null) throw new Error('Proprietário inexistente ou já associado.');
      await tx.update(users).set({ email, emailVerified: true, updatedAt: new Date() }).where(eq(users.id, id));
    } else {
      const name = input.name?.trim();
      if (!name || name.length > 120) throw new Error('Nome deve ter de 1 a 120 caracteres.');
      id = randomUUID();
      await tx.insert(users).values({ id, displayName: name, email, emailVerified: true });
    }
    await tx.insert(authAccounts).values({ userId: id, accountId: id, providerId: 'credential', password });
    return id;
  });
}
