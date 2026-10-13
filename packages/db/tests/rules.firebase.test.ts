import { afterAll, it, expect } from 'vitest';
import { testStore } from './firestore-fixture';
const store=testStore('ecofinance');
const id='rules-probe';
const root=`http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/demo-ecofinance/databases/ecofinance/documents`;
const paths=['users','accounts','transactions','authSessions','_unique','_migration'];
afterAll(async()=> {for(const collection of paths)for(const suffix of ['','-new'])await store.firestore.collection(collection).doc(id+suffix).delete();await store.firestore.terminate();});
it('denies direct reads and writes for anonymous and authenticated client identities',async()=> {
  for(const collection of paths)await store.firestore.collection(collection).doc(id).set({id,displayName:'Synthetic private user'});
  const token=(sub:string)=>Buffer.from(JSON.stringify({alg:'none',typ:'JWT'})).toString('base64url')+'.'+Buffer.from(JSON.stringify({sub,role:'admin',isAdmin:true,ownerId:sub,aud:'demo-ecofinance',iss:'https://securetoken.google.com/demo-ecofinance',iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+3600,firebase:{sign_in_provider:'custom'}})).toString('base64url')+'.';
  for(const identity of [null,'owner-a','owner-b'])for(const collection of paths) {
    const url=root+'/'+collection+'/'+id;
    const headers:Record<string,string>={'content-type':'application/json'};
    if(identity)headers.authorization='Bearer '+token(identity);
    const read=await fetch(url,{headers});expect(read.status).toBe(403);
    const write=await fetch(url,{method:'PATCH',headers,body:JSON.stringify({fields:{displayName:{stringValue:'changed'}}})});expect(write.status).toBe(403);
    const create=await fetch(root+'/'+collection+'/'+id+'-new',{method:'PATCH',headers,body:JSON.stringify({fields:{role:{stringValue:'admin'}}})});expect(create.status).toBe(403);
    expect((await fetch(url,{method:'DELETE',headers})).status).toBe(403);
    expect((await fetch(root+'/'+collection,{headers})).status).toBe(403);
  }
  for(const collection of paths) {
    expect((await store.firestore.collection(collection).doc(id).get()).get('displayName')).toBe('Synthetic private user');
    expect((await store.firestore.collection(collection).doc(id+'-new').get()).exists).toBe(false);
  }
},60000);
