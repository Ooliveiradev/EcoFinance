import { db } from '../../packages/db/src';
import { assertTestStore } from '../../packages/db/tests/firestore-fixture';
export function e2eDatabase() { assertTestStore(db); return db; }
