import { DocumentStore } from '../../packages/db/src';
import { Firestore } from 'firebase-admin/firestore';
import { assertTestStore } from '../../packages/db/tests/firestore-fixture';
export function e2eDatabase() {
  const db=new DocumentStore(new Firestore({projectId:process.env.FIREBASE_PROJECT_ID,databaseId:process.env.FIRESTORE_DATABASE_ID}));
  assertTestStore(db);return db;
}
