import './env';
import { DocumentStore } from './firestore';
export const db = new DocumentStore();
export type Database = DocumentStore;
export async function closeDatabase() { await db.firestore.terminate(); }
export * from './firestore';
export * from './retention';
export type * from './models';
