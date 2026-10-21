import test from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { authRequest, requireAdmin } from '../server/melhores-auth.js';
import { roomRequest } from '../server/melhores-room.js';
import { handleMelhoresStateRequest, handleMelhoresApplyRequest, handleMelhoresResetRequest, handleMelhoresSavesRequest } from '../server/melhores-api.js';

class Store {
  records = new Map(); version = 0;
  async get(key) { return structuredClone(this.records.get(key)?.data ?? null); }
  async getWithMetadata(key) { return structuredClone(this.records.get(key) ?? null); }
  async setJSON(key, data, options={}) {
    const old=this.records.get(key);
    if ((options.onlyIfNew && old) || (options.onlyIfMatch && options.onlyIfMatch!==old?.etag)) return {modified:false};
    this.records.set(key,{data:structuredClone(data),etag:String(++this.version)});return {modified:true};
  }
  async delete(key) {this.records.delete(key);}
}
const configs=['alexandre-neto','ana','bruno'].map(id=>({id,name:id,username:id,salt:'salt-for-test-'+id,hash:scryptSync('test-password', 'salt-for-test-'+id,64).toString('hex'),role:'admin'}));
process.env.MELHORES_USERS_JSON=JSON.stringify(configs);
const headers={host:'localhost:3000',origin:'http://localhost:3000'};
const request=(cookie,body,method='POST')=>({method,headers:{...headers,cookie},body});
async function login(store,id){const r=await authRequest(request('',{username:id,password:'test-password'}),store);assert.equal(r.status,200);return r.headers['Set-Cookie'].split(';')[0];}
const game={participants:configs.map(c=>({id:c.id,name:c.name,objectives:{familia:'private-'+c.id}}))};

test('old data/state/saves/reset endpoints reject unauthenticated access',async()=>{
  for(const call of [()=>handleMelhoresStateRequest(),()=>handleMelhoresApplyRequest({participants:[]}),()=>handleMelhoresResetRequest(),()=>handleMelhoresSavesRequest()]) assert.equal((await call()).status,401);
});

test('only Alexandre Neto is admin; session logout and password rotation revoke access',async()=>{
 const store=new Store();const admin=await login(store,'alexandre-neto'),ana=await login(store,'ana');
 assert.equal(await requireAdmin(request(admin),store),null);
 assert.equal((await requireAdmin(request(ana),store)).status,403);
 assert.equal((await authRequest(request(ana,null,'GET'),store)).body.user.role,'participant');
 await authRequest(request(admin,{action:'logout'}),store);
 assert.equal((await requireAdmin(request(admin),store)).status,401);
 const changed=await login(store,'ana');process.env.MELHORES_USERS_JSON=JSON.stringify(configs.map(u=>u.id==='ana'?{...u,hash:'00'.repeat(64)}:u));
 assert.equal((await authRequest(request(changed,null,'GET'),store)).body.user,null);
 process.env.MELHORES_USERS_JSON=JSON.stringify(configs);
});

test('full multiplayer flow: concurrent joins and saves, privacy, deadline zero, extension, manual reveal and score preservation',async()=>{
 const store=new Store();const snapshot=JSON.stringify(game);
 const admin=await login(store,'alexandre-neto'),ana=await login(store,'ana'),bruno=await login(store,'bruno');
 const call=(cookie,body)=>roomRequest(request(cookie,body,body?'POST':'GET'),{store,game});
 assert.equal((await call(ana,{action:'create'})).status,403);
 let r=await call(admin,{action:'create'});assert.equal(r.status,200);const roomId=r.body.room.id;
 const joined=await Promise.all([call(ana,{action:'join',roomId}),call(bruno,{action:'join',roomId})]);
 assert.ok(joined.every(r=>r.status===200));assert.equal((await store.get('active-room')).members.length,2);
 assert.equal((await call(ana,{action:'start',roomId})).status,403);
 await call(admin,{action:'start',roomId});
 const saves=await Promise.all([call(ana,{action:'save',roomId,best:'ana best',worst:'ana worst',done:true,revision:1}),call(bruno,{action:'save',roomId,best:'bruno best',worst:'bruno worst',done:true,revision:1})]);
 assert.ok(saves.every(r=>r.status===200));
 const view=await call(ana,null);assert.equal(view.body.profile.objectives.familia,'private-ana');
 assert.equal(view.body.room.members.find(m=>m.id==='bruno').draft,undefined);
 assert.equal(view.body.room.members.find(m=>m.id==='ana').draft.best,'ana best');
 for(const action of ['extend','present','next','close']) assert.equal((await call(ana,{action,roomId,seconds:60})).status,403);
 let room=await store.get('active-room');room.deadline=Date.now()-1000;await store.setJSON('active-room',room);
 assert.equal((await call(ana,{action:'save',roomId,best:'still editing',worst:'ana worst',revision:2})).status,200);
 const extended=await call(admin,{action:'extend',roomId,seconds:60});assert.equal(extended.body.room.phase,'writing');assert.ok(extended.body.room.deadline>Date.now());
 await call(admin,{action:'present',roomId});
 const presentation=await call(bruno,null);assert.equal(presentation.body.room.members[0].draft.best,'still editing');
 assert.equal((await call(ana,{action:'save',roomId,best:'too late',worst:'x',revision:3})).status,409);
 await call(admin,{action:'next',roomId});
 assert.equal((await call(ana,null)).body.room.members.find(m=>m.id==='bruno').draft.best,'bruno best');
 await call(admin,{action:'close',roomId});
 assert.equal((await store.get('room-history/'+roomId)).phase,'closed');
 assert.equal((await store.get('rooms/'+roomId+'/ana')).best,'still editing');
 const next=await call(admin,{action:'create'});assert.notEqual(next.body.room.id,roomId);
 assert.equal((await call(ana,{action:'join',roomId})).status,409);
 assert.equal(JSON.stringify(game),snapshot);
});

test('cross-origin actions, oversize drafts, stale revisions and brute force are rejected',async()=>{
 const store=new Store(),admin=await login(store,'alexandre-neto'),ana=await login(store,'ana');
 const call=(cookie,body)=>roomRequest(request(cookie,body,body?'POST':'GET'),{store,game});
 assert.equal((await authRequest({method:'POST',headers:{...headers,origin:'https://another.example'},body:{}},store)).status,403);
 let r=await call(admin,{action:'create'}),roomId=r.body.room.id;await call(ana,{action:'join',roomId});await call(admin,{action:'start',roomId});
 assert.equal((await call(ana,{action:'save',roomId,best:'x'.repeat(4001),worst:'x',revision:1})).status,400);
 await call(ana,{action:'save',roomId,best:'latest',worst:'x',revision:9});
 assert.equal((await call(ana,{action:'save',roomId,best:'stale',worst:'x',revision:1})).status,409);
 assert.equal((await call(ana,{action:'save',roomId,best:'',worst:'',done:true,revision:10})).status,400);
 for(let n=0;n<12;n++)await authRequest(request('',{username:'unknown',password:'wrong'}),store);
 assert.equal((await authRequest(request('',{username:'unknown',password:'wrong'}),store)).status,429);
});

test('account import is admin-only, stores hashes and never replaces existing passwords',async()=>{
 const store=new Store(),admin=await login(store,'alexandre-neto'),ana=await login(store,'ana');
 const salt='ab'.repeat(16),hash=scryptSync('new-test-password',salt,64).toString('hex');
 const incoming={id:'new-person',username:'new-person',name:'New Person',salt,hash};
 assert.equal((await authRequest(request(ana,{action:'import-accounts',accounts:[incoming]}),store)).status,403);
 const imported=await authRequest(request(admin,{action:'import-accounts',accounts:[incoming]}),store);assert.equal(imported.status,200);assert.equal(imported.body.count,4);
 await authRequest(request(admin,{action:'import-accounts',accounts:[{...incoming,hash:'00'.repeat(64)}]}),store);
 assert.equal((await store.get('accounts')).find(u=>u.id==='new-person').hash,hash);
 assert.equal((await authRequest(request('',{username:'new-person',password:'new-test-password'}),store)).status,200);
 assert.equal(await requireAdmin(request(admin),store),null);
});

test('native Netlify adapter forwards cookies and rejects bad JSON, huge payloads and wrong methods', async()=>{
 const { serve }=await import('../server/melhores-netlify.js');
 const invoke=async request=>serve(request, r=>({status:200,headers:{'Content-Type':'application/json'},body:{method:r.method,host:r.headers.host,cookie:r.headers.cookie}}));
 const response=await invoke(new Request('https://example.com/api',{headers:{cookie:'test=1'}}));assert.deepEqual(await response.json(),{method:'GET',host:'example.com',cookie:'test=1'});
 assert.equal((await invoke(new Request('https://example.com/api',{method:'POST',body:'{broken'}))).status,400);
 assert.equal((await invoke(new Request('https://example.com/api',{method:'POST',body:'x'.repeat(100001)}))).status,413);
 assert.equal((await invoke(new Request('https://example.com/api',{method:'DELETE'}))).status,405);
 const state=await import('../netlify/functions/melhores-state.js');assert.equal((await state.default(new Request('https://example.com/api/melhores/state'))).status,401);
 const reset=await import('../netlify/functions/melhores-reset.js');assert.equal((await reset.default(new Request('https://example.com/api/melhores/reset'))).status,405);
});
