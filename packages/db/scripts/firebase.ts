import '../src/env';
import { readFile, writeFile } from 'node:fs/promises';
import { DocumentStore } from '../src/firestore';
import { backupFirebase, restoreFirebase, migrateToFirebase, emptySourceSnapshot, exportPortableFirebase } from '../src/firebase-migration';
const [command,path]=process.argv.slice(2);
const store=new DocumentStore();
try {
  if(command==='init-empty')await migrateToFirebase(store,emptySourceSnapshot());
  else if(command==='import' && path)await migrateToFirebase(store,JSON.parse(await readFile(path,'utf8')));
  else if(command==='backup' && path)await writeFile(path,JSON.stringify(await backupFirebase(store))+'\n',{flag:'wx',mode:0o600});
  else if(command==='export-portable' && path)await writeFile(path,JSON.stringify(await exportPortableFirebase(store))+'\n',{flag:'wx',mode:0o600});
  else if(command==='restore' && path)await restoreFirebase(store,JSON.parse(await readFile(path,'utf8')));
  else throw new Error('Usage: db:firebase init-empty | import <portable.json> | backup/export-portable <new-file.json> | restore <backup.json>');
  console.log('Firebase operation verified.');
} catch { console.error('Firebase operation failed; no cutover confirmed. Check credentials, target and snapshot.');process.exitCode=1; }
finally {await store.firestore.terminate();}
