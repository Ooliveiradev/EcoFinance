import { readFile } from 'node:fs/promises';
import { e2eDatabase } from './database';
import { migrateToFirebase } from '../../packages/db/src/firebase-migration';
import { clearTestCollections } from '../../packages/db/tests/firestore-fixture';
import { provisionUser } from '../../apps/next/src/lib/provision-user';
import { TEST_PASSWORD,OWNER_A,OWNER_B } from './credentials';
export default async function setup() {
 const db=e2eDatabase();
 await clearTestCollections(db);
 await migrateToFirebase(db,JSON.parse(await readFile('packages/db/tests/fixtures/portable-synthetic.json','utf8')));
 for(const [email,ownerId] of [['a@example.test',OWNER_A],['b@example.test',OWNER_B]] as const) await provisionUser(db,{email,password:TEST_PASSWORD,ownerId});
 // Dedicated owner for backup/restore/deletion journeys, which replace all of its data.
 await provisionUser(db,{email:'c@example.test',password:TEST_PASSWORD,name:'Backup E2E'});
 // Dedicated owner for the import → metrics journey: other specs leave batches in review.
 await provisionUser(db,{email:'d@example.test',password:TEST_PASSWORD,name:'Relatórios E2E'});
 await db.firestore.terminate();
}
