import { DocumentStore, collections } from '../src/firestore';
import { Firestore } from 'firebase-admin/firestore';
export function assertTestStore(store: DocumentStore) {
  if ((store.firestore as unknown as {projectId:string}).projectId!=='demo-ecofinance' || !/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST??'')) throw new Error('Refusing to modify a non-emulator database.');
}
export function testStore(databaseId: string) {
  if (!/^[a-z][a-z0-9-]+$/.test(databaseId) || !process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Firestore emulator is required.');
  return new DocumentStore(new Firestore({projectId:'demo-ecofinance',databaseId}));
}
export async function clearTestCollections(store: DocumentStore, names: string[] = [...collections,'_unique','_migration']) {
  assertTestStore(store);
  for(const name of names) {
    const rows=await store.firestore.collection(name).get();
    for(const row of rows.docs) await store.firestore.doc(row.ref.path).delete();
  }
}
