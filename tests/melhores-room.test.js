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
    this.records.set(key,{data:structuredClone(data),etag:String(++this.version)});return {modified:true,etag:String(this.version)};
  }
  async set(key, value, options={}) { return this.setJSON(key,JSON.parse(value),options); }
  async delete(key) {this.records.delete(key);}
}
const configs=['alexandre-neto','ana','bruno'].map(id=>({id,name:id,username:id,salt:'salt-for-test-'+id,hash:scryptSync('test-password', 'salt-for-test-'+id,64).toString('hex'),role:'admin'}));
process.env.MELHORES_PASSWORD_VAULT_KEY='ab'.repeat(32);
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
 assert.equal((await call(admin,{action:'next',roomId})).status,409);
 await call(admin,{action:'show-worst',roomId});await call(admin,{action:'next',roomId});
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
 assert.equal((await invoke(new Request('https://example.com/api',{method:'POST',body:'x'.repeat(600001)}))).status,413);
 assert.equal((await invoke(new Request('https://example.com/api',{method:'DELETE'}))).status,405);
 const state=await import('../netlify/functions/melhores-state.js');assert.equal((await state.default(new Request('https://example.com/api/melhores/state'))).status,401);
 const reset=await import('../netlify/functions/melhores-reset.js');assert.equal((await reset.default(new Request('https://example.com/api/melhores/reset'))).status,405);
});

test('actual installed Netlify SDK sends conditional headers and retries concurrent updates without lost members', async()=>{
 const {getStore}=await import('@netlify/blobs');const {update}=await import('../server/melhores-auth.js');
 let data=null,version=0;const seen=[];
 const store=getStore({name:'transport-test',siteID:'test-site',token:'test-token',edgeURL:'https://blobs.example.test',uncachedEdgeURL:'https://blobs.example.test',consistency:'strong',fetch:async(url,options)=>{
  if(options.method==='get')return new Response(data===null?null:JSON.stringify(data),{status:data===null?404:200,headers:data===null?{}:{etag:'"'+version+'"'}});
  if(options.method==='put'){
   const h=new Headers(options.headers);seen.push({match:h.get('if-match'),fresh:h.get('if-none-match')});
   if((h.get('if-none-match')==='*'&&data!==null)||(h.get('if-match')&&h.get('if-match')!=='"'+version+'"'))return new Response(null,{status:412});
   data=JSON.parse(options.body);version++;return new Response(null,{status:200,headers:{etag:'"'+version+'"'}});
  }
  throw new Error('Unexpected method');
 }});
 await update(store,'room',()=>({members:[]}));
 const ids=Array.from({length:22},(_,i)=>'person-'+i);
 await Promise.all(ids.map(id=>update(store,'room',old=>({members:[...old.members,id]}))));
 assert.deepEqual(data.members.slice().sort(),ids.slice().sort());assert.equal(seen[0].fresh,'*');assert.ok(seen.slice(1).every(h=>h.match));
});

test('live votes reject self-votes, hide ballots, require admin tie-break; goals and scores are idempotent',async()=>{
 const store=new Store(),gameStore=new Store();await gameStore.setJSON('game-state',structuredClone(game));
 const admin=await login(store,'alexandre-neto'),ana=await login(store,'ana'),bruno=await login(store,'bruno');
 const call=(cookie,body)=>roomRequest(request(cookie,body,body?'POST':'GET'),{store,game,gameStore});
 const created=await call(admin,{action:'create'}),roomId=created.body.room.id;
 const act=(cookie,action,extra={})=>call(cookie,{action,roomId,...extra});
 await act(admin,'join');await act(ana,'join');await act(bruno,'join');
 assert.equal((await call(ana)).body.profile.categories,undefined);
 assert.ok((await call(admin)).body.room.members.every(m=>m.online));
 await act(admin,'start');
 for(const [cookie,name] of [[admin,'Alexandre'],[ana,'Ana'],[bruno,'Bruno']])await act(cookie,'save',{best:name+' best',worst:name+' worst',revision:1,done:true});
 await act(admin,'present');assert.equal((await act(admin,'vote-best')).status,409);
 await act(admin,'show-worst');await act(admin,'next');await act(admin,'show-worst');await act(admin,'next');await act(admin,'show-worst');await act(admin,'vote-best');
 assert.equal((await act(ana,'vote',{target:'ana'})).status,400);
 assert.equal((await act(admin,'vote',{target:'alexandre-neto'})).status,400);
 await act(admin,'vote',{target:'ana'});await act(ana,'vote',{target:'bruno'});
 const pending=await call(bruno);assert.equal(pending.body.room.votes,undefined);assert.equal(pending.body.room.results.best,undefined);
 await act(bruno,'vote',{target:'alexandre-neto'});
 assert.equal((await call(ana)).body.room.phase,'tie-best');
 assert.equal((await act(ana,'resolve',{target:'ana'})).status,403);
 await act(admin,'resolve',{target:'ana'});await act(admin,'vote-worst');
 await act(admin,'vote',{target:'bruno'});await act(ana,'vote',{target:'bruno'});await act(bruno,'vote',{target:'ana'});
 assert.equal((await call(admin)).body.room.phase,'result-worst');
 await act(admin,'goals');
 assert.equal((await act(ana,'mark',{target:'alexandre-neto',category:'familia',result:'done'})).status,403);
 assert.equal((await act(admin,'mark',{target:'alexandre-neto',category:'familia',result:'absent'})).status,400);
 for(const id of ['alexandre-neto','ana','bruno']){
   assert.equal((await act(admin,'next-goal')).status,409);
   if(id==='bruno')await store.setJSON(`presence/${roomId}/${id}`,{seen:Date.now()-60000});
   for(const category of ['exercicio','familia','alimentacao','hobbies','conhecimentos'])assert.equal((await act(admin,'mark',{target:id,category,gymrats:true,result:id==='bruno'?'absent':id==='ana'?'missed':'done'})).status,200);
   await act(admin,'next-goal');
 }
 assert.equal((await call(admin)).body.room.phase,'completed');
 const beforeClose=await gameStore.get('game-state');assert.ok(beforeClose.appliedRooms.includes(roomId));
 await act(admin,'close');assert.deepEqual(await gameStore.get('game-state'),beforeClose);const scored=await gameStore.get('game-state');
 assert.equal(scored.participants.find(p=>p.id==='alexandre-neto').categories.familia,1);
 assert.equal(scored.participants.find(p=>p.id==='ana').categories.bestWeek,1);
 assert.equal(scored.participants.find(p=>p.id==='bruno').categories.familia,-1);
 assert.equal(scored.participants.find(p=>p.id==='bruno').categories.bestWeek,1);
 assert.equal(scored.weeklyFactHistory.length,1);assert.equal(scored.weeklyFactHistory[0].best.participantId,'ana');assert.equal(scored.weeklyFactHistory[0].best.description,'Ana best');
 assert.equal((await call(ana)).body.profile.achievements[0].description,'Ana best');
 await call(admin);assert.deepEqual(await gameStore.get('game-state'),scored);
});

test('presence expires independently from completion; same login reconnects to current stage',async()=>{
 const store=new Store(),admin=await login(store,'alexandre-neto'),ana=await login(store,'ana');
 const call=(cookie,body)=>roomRequest(request(cookie,body,body?'POST':'GET'),{store,game});
 const roomId=(await call(admin,{action:'create'})).body.room.id;
 await call(ana,{action:'join',roomId});await call(admin,{action:'start',roomId});
 await call(ana,{action:'save',roomId,best:'best',worst:'worst',done:true,revision:1});
 await store.setJSON(`presence/${roomId}/ana`,{seen:Date.now()-60000});
 let member=(await call(admin)).body.room.members[0];assert.equal(member.online,false);assert.equal(member.done,true);
 const rejoined=await login(store,'ana');member=(await call(rejoined)).body.room.members[0];assert.equal(member.online,true);assert.equal(member.draft.best,'best');
});

test('admin directory protects credentials, edits goals with conflicts and revokes disabled sessions',async()=>{
 const {adminRequest}=await import('../server/melhores-admin.js');
 const store=new Store(),gameStore=new Store();await gameStore.setJSON('game-state',structuredClone(game));
 const admin=await login(store,'alexandre-neto'),ana=await login(store,'ana');
 const call=(cookie,body)=>adminRequest(request(cookie,body,body?'POST':'GET'),{store,gameStore});
 assert.equal((await call(ana)).status,403);
 let list=await call(admin);assert.equal(list.status,200);assert.equal(list.body.accounts[0].hash,undefined);assert.equal(list.body.accounts[0].salt,undefined);
 const objectives=Object.fromEntries(['exercicio','familia','alimentacao','hobbies','conhecimentos'].map(k=>[k,'Nova meta '+k]));
 let body={action:'save-profile',id:'ana',name:'Ana',objectives,expectedObjectives:JSON.stringify(game.participants[1].objectives)};
 assert.equal((await call(admin,body)).status,200);
 assert.equal((await call(admin,body)).status,409);
 const saved=await gameStore.get('game-state');assert.deepEqual(saved.participants[1].objectives,objectives);assert.deepEqual(saved.participants[0],game.participants[0]);
 assert.equal((await call(admin,{action:'account-status',id:'alexandre-neto',disabled:true})).status,400);
 assert.equal((await call(admin,{action:'account-status',id:'ana',disabled:true})).status,200);
 assert.equal((await authRequest(request(ana,null,'GET'),store)).body.user,null);
 assert.equal((await authRequest(request('',{username:'ana',password:'test-password'}),store)).status,401);
 await call(admin,{action:'account-status',id:'ana',disabled:false});
 assert.equal((await authRequest(request(ana,null,'GET'),store)).body.user,null);
 assert.equal((await authRequest(request('',{username:'ana',password:'test-password'}),store)).status,200);
});

test('personal profile exposes own goals and winning stories only, with no ranking or other users facts',async()=>{
 const {personalProfile}=await import('../server/melhores-profile.js');
 const g={participants:[{id:'ana',name:'Ana',photoUrl:'https://example.test/photo.jpg',objectives:{exercicio:'Caminhar'},categories:{exercicio:99},totalPoints:99,scoreBreakdown:{melhorFato:4,piorFato:1}},{id:'bruno',name:'Bruno'}],weeklyFactHistory:[{id:'old',date:'2026-10-09',best:{participantId:'bruno',description:'PRIVATE BRUNO'},worst:{participantId:'bruno',description:'PRIVATE WORST'}},{id:'own',date:'2026-10-16',best:{participantId:'ana',description:'Concluí meu curso'},worst:{participantId:'bruno',description:'PRIVATE AGAIN'}},{id:'own-worst',date:'2026-10-02',best:{participantId:'bruno',description:'PRIVATE'},worst:{participantId:'ana',description:'Perdi o ônibus'}}]};
 const p=personalProfile(g,{id:'login-ana',participantId:'ana',name:'Alias'});
 assert.equal(p.name,'Ana');assert.equal(p.bestWins,4);assert.equal(p.worstWins,1);assert.equal(p.achievements.length,2);assert.equal(p.achievements[0].description,'Concluí meu curso');assert.equal(p.categories,undefined);assert.equal(p.totalPoints,undefined);assert.ok(!JSON.stringify(p).includes('PRIVATE'));
 const empty=personalProfile({}, {id:'new',name:'Novo'});assert.deepEqual(empty.achievements,[]);assert.equal(empty.bestWins,0);assert.equal(empty.name,'Novo');
});

test('delete permanently revokes login, hides directory profile and prevents old imports restoring it',async()=>{
 const {adminRequest}=await import('../server/melhores-admin.js');const store=new Store(),gameStore=new Store();await gameStore.setJSON('game-state',structuredClone(game));const admin=await login(store,'alexandre-neto'),ana=await login(store,'ana');
 const call=(cookie,body)=>adminRequest(request(cookie,body,body?'POST':'GET'),{store,gameStore});
 assert.equal((await call(ana,{action:'delete-account',id:'bruno'})).status,403);
 assert.equal((await call(admin,{action:'delete-account',id:'alexandre-neto'})).status,400);
 const r=await call(admin,{action:'delete-account',id:'ana'});assert.equal(r.status,200);assert.ok(!r.body.accounts.some(a=>a.id==='ana'));assert.ok(!r.body.participants.some(p=>p.id==='ana'));
 assert.equal((await authRequest(request(ana,null,'GET'),store)).body.user,null);
 assert.ok((await gameStore.get('game-state')).participants.some(p=>p.id==='ana'));
 assert.ok((await store.get('deleted-accounts')).includes('ana'));
 const incoming={id:'ana',username:'ana',name:'Ana',salt:'aa'.repeat(16),hash:'bb'.repeat(64)};
 await authRequest(request(admin,{action:'import-accounts',accounts:[incoming]}),store);
 assert.ok(!(await store.get('accounts')).some(a=>a.id==='ana'));
});

test('sheet sync maps full names safely, activates only complete forms and preserves scores without restoring deleted users',async()=>{
 const {applySheetRows,sheetRows}=await import('../server/melhores-sheet.js');
 const g={participants:[{id:'camila',name:'Camila',categories:{familia:9}},{id:'bruno',name:'Bruno'},{id:'ana-raphaela',name:'Ana Raphaela'}]};
 const rows=[['Data','Nome','Exercício','Família','Alimentação','Hobbies','Conhecimentos'],['1','Camila Andrade','a','b','c','d','e'],['2','Bruno','1','2','3','4','5'],['3','Ana Raphaela','x','x','x','x','x'],['4','Pessoa Desconhecida','x','x','x','x','x']];
 applySheetRows(g,rows,[{id:'camila'},{id:'bruno'}],'now');assert.equal(g.participants[0].sheetEnrollment.active,true);assert.equal(g.participants[1].sheetEnrollment.active,true);assert.equal(g.participants[0].categories.familia,9);assert.equal(g.participants[2].objectives,undefined);assert.deepEqual(g.sheetSync.unmatched,['Ana Raphaela','Pessoa Desconhecida']);
 assert.deepEqual(sheetRows('Data,Nome,Meta\r\n1,Bruno,"Ler, aprender\npraticar"'),[['Data','Nome','Meta'],['1','Bruno','Ler, aprender\npraticar']]);
 assert.throws(()=>applySheetRows(g,[['HTML']],[]));
});


test('admin can replace portrait and credentials; old sessions revoked and duplicates rejected',async()=>{
 const {adminRequest}=await import('../server/melhores-admin.js');
 const store=new Store(),gameStore=new Store();await gameStore.setJSON('game-state',structuredClone(game));
 const admin=await login(store,'alexandre-neto'),ana=await login(store,'ana');
 const call=(cookie,body)=>adminRequest(request(cookie,body),{store,gameStore});
 const objectives=Object.fromEntries(['exercicio','familia','alimentacao','hobbies','conhecimentos'].map(k=>[k,'meta']));
 const photoUrl='data:image/jpeg;base64,/9j/';
 assert.equal((await call(ana,{action:'save-access',id:'ana',name:'Ana',username:'changed'})).status,403);
 assert.equal((await call(admin,{action:'save-profile',id:'ana',name:'Ana',objectives,photoUrl,expectedObjectives:JSON.stringify(game.participants[1].objectives)})).status,200);
 assert.equal((await gameStore.get('game-state')).participants[1].photoUrl,photoUrl);
 assert.equal((await call(admin,{action:'save-access',id:'ana',name:'Ana',username:'bruno'})).status,409);
 assert.equal((await call(admin,{action:'save-access',id:'ana',name:'Ana',username:'ana.nova',password:'new-password-123'})).status,200);
 assert.equal((await authRequest(request(ana,null,'GET'),store)).body.user,null);
 assert.equal((await authRequest(request('',{username:'ana.nova',password:'new-password-123'}),store)).status,200);
 const response=await adminRequest(request(admin,null,'GET'),{store,gameStore});
 assert.ok(response.body.accounts.every(a=>!('hash' in a)&&!('salt' in a)&&!('password' in a)));
});

test('automatic absence tolerates short reconnects, fills only unevaluated goals, and GymRats validates exercise',async()=>{
 const store=new Store(),gameStore=new Store();await gameStore.setJSON('game-state',structuredClone(game));
 const admin=await login(store,'alexandre-neto'),ana=await login(store,'ana');
 const keys=['exercicio','familia','alimentacao','hobbies','conhecimentos'];
 await store.setJSON('active-room',{id:'absence-test',phase:'goals',administratorId:'alexandre-neto',members:['ana','bruno'],current:0,votes:{best:{},worst:{}},results:{},goalResults:{ana:{familia:'done'}}});
 await store.setJSON('presence/absence-test/ana',{seen:Date.now()-30000});
 const call=(body)=>roomRequest(request(admin,body,body?'POST':'GET'),{store,gameStore});
 assert.equal((await call()).body.room.goalResults.ana.exercicio,undefined);
 await store.setJSON('presence/absence-test/ana',{seen:Date.now()-61000});
 let room=(await call()).body.room;assert.equal(room.goalResults.ana.familia,'done');assert.equal(room.goalResults.ana.exercicio,'absent');assert.equal(Object.keys(room.goalResults.ana).length,5);
 await roomRequest(request(ana,null,'GET'),{store,gameStore});
 await call({action:'mark',roomId:'absence-test',target:'ana',category:'exercicio',result:'done',gymrats:false});assert.equal((await call()).body.room.goalResults.ana.exercicio,'missed');
 await call({action:'mark',roomId:'absence-test',target:'ana',category:'exercicio',result:'done',gymrats:true});assert.equal((await call()).body.room.goalResults.ana.exercicio,'done');
 const bad=await call({action:'next-goal',roomId:'absence-test',target:'bruno'});assert.equal(bad.status,409);
});

test('sheet creates missing active profiles, maps Bruno and admin, refreshes changed responses without resetting scores',async()=>{
 const {applySheetRows,syncSheetGoals}=await import('../server/melhores-sheet.js');
 const accounts=[{id:'alexandre-neto',name:'Alexandre Neto'},{id:'bruno',name:'Bruno'}];
 const rows=[['Data','Nome','Exercício','Família','Alimentação','Hobbies','Conhecimentos'],['today','Alexandre Neto','a','b','c','d','e'],['today','Bruno Melim Zardo','f','g','h','i','j']];
 const state={participants:[{id:'bruno',name:'Bruno',categories:{familia:7},totalPoints:7}],removedParticipantIds:['alexandre-neto']};
 applySheetRows(state,rows,accounts);assert.equal(state.sheetSync.matched,2);assert.equal(state.participants.find(p=>p.id==='alexandre-neto').objectives.exercicio,'a');assert.equal(state.participants[0].totalPoints,7);
 state.participants[0].objectives.exercicio='manual';applySheetRows(state,rows,accounts);assert.equal(state.participants[0].objectives.exercicio,'manual');rows[2][2]='new response';applySheetRows(state,rows,accounts);assert.equal(state.participants[0].objectives.exercicio,'new response');
 const store=new Store(),gameStore=new Store();let fetches=0;
 const options={url:'https://docs.google.com/test.csv',fetcher:async()=>{fetches++;return {ok:true,text:async()=>JSON.stringify({values:rows})};}};
 await syncSheetGoals(gameStore,store,accounts,options);await syncSheetGoals(gameStore,store,accounts,options);assert.equal(fetches,1);assert.equal((await store.get('sheet-sync-status')).ok,true);
});

test('finished room can be replaced without losing its archive; active room still blocks replacement',async()=>{
 const store=new Store(),gameStore=new Store();await gameStore.setJSON('game-state',structuredClone(game));const admin=await login(store,'alexandre-neto');
 const call=body=>roomRequest(request(admin,body),{store,gameStore});
 const old={id:'finished-session',phase:'completed',administratorId:'alexandre-neto',members:[],results:{},votes:{best:{},worst:{}},goalResults:{},completedAt:new Date().toISOString()};await store.setJSON('active-room',old);
 const created=await call({action:'create'});assert.equal(created.status,200);assert.equal(created.body.room.phase,'waiting');assert.notEqual(created.body.room.id,old.id);assert.deepEqual(await store.get('room-history/'+old.id),old);
 assert.equal((await call({action:'create'})).status,409);
});

test('self access requires current password, changes only signed-in account and revokes sessions',async()=>{
 const store=new Store(),cookie=await login(store,'ana');
 assert.equal((await authRequest(request('',{action:'self-access',username:'new'}),store)).status,401);
 assert.equal((await authRequest(request(cookie,{action:'self-access',username:'ana-new',currentPassword:'wrong'}),store)).status,403);
 assert.equal((await authRequest(request(cookie,{action:'self-access',username:'bruno',currentPassword:'test-password'}),store)).status,409);
 const result=await authRequest(request(cookie,{action:'self-access',id:'bruno',username:'ana-new',currentPassword:'test-password',password:'new-password-123'}),store);
 assert.equal(result.status,200);
 const accounts=await store.get('accounts'),ana=accounts.find(a=>a.id==='ana'),bruno=accounts.find(a=>a.id==='bruno');
 assert.equal(ana.username,'ana-new');assert.equal(bruno.username,'bruno');assert.equal(bruno.hash,configs.find(a=>a.id==='bruno').hash);assert.ok(ana.accessUpdatedAt);assert.ok(ana.passwordUpdatedAt);assert.equal(ana.accessUpdatedBy,'ana');
 assert.equal((await authRequest(request(cookie,null,'GET'),store)).body.user,null);
 const next=await authRequest(request('',{username:'ana-new',password:'new-password-123'}),store);assert.equal(next.status,200);assert.equal(next.body.user.role,'participant');
 assert.equal(JSON.stringify(next.body).includes(ana.hash),false);
});

test('appearance is validated and stored only for the authenticated account',async()=>{
 const store=new Store(),ana=await login(store,'ana'),bruno=await login(store,'bruno');
 const appearance={mode:'dark',palette:'custom',primary:'#123abc',accent:'#ff9977'};
 assert.equal((await authRequest(request('',{action:'appearance',appearance}),store)).status,401);
 assert.equal((await authRequest(request(ana,{action:'appearance',appearance:{...appearance,primary:'url(evil)'}}),store)).status,400);
 assert.equal((await authRequest(request(ana,{action:'appearance',appearance,userId:'bruno'}),store)).status,200);
 assert.deepEqual((await authRequest(request(ana,null,'GET'),store)).body.user.appearance,appearance);
 assert.equal((await authRequest(request(bruno,null,'GET'),store)).body.user.appearance,null);
 const again=await login(store,'ana');
 assert.deepEqual((await authRequest(request(again,null,'GET'),store)).body.user.appearance,appearance);
});

test('password vault follows self-service changes, rejects participants and incorrect admin password, and binds ciphertext to account/hash',async()=>{
 const {adminRequest}=await import('../server/melhores-admin.js');
 const {openPassword}=await import('../server/melhores-password-vault.js');
 const store=new Store(),gameStore=new Store();
 const admin=await login(store,'alexandre-neto'),ana=await login(store,'ana');
 const result=await authRequest(request(ana,{action:'self-access',username:'ana',currentPassword:'test-password',password:'new-vault-password'}),store);
 assert.equal(result.status,200);
 const account=(await store.get('accounts')).find(a=>a.id==='ana');
 assert.equal(openPassword(account),'new-vault-password');
 assert.ok(!JSON.stringify(account.passwordVault).includes('new-vault-password'));
 assert.throws(()=>openPassword({...account,id:'bruno'}));
 assert.throws(()=>openPassword({...account,hash:'00'.repeat(64)}));
 const newLogin=await authRequest(request('',{username:'ana',password:'new-vault-password'}),store);
 const participant=newLogin.headers['Set-Cookie'].split(';')[0];
 const call=(cookie,body)=>adminRequest(request(cookie,body),{store,gameStore});
 assert.equal((await call(participant,{action:'reveal-password',id:'ana',adminPassword:'test-password'})).status,403);
 assert.equal((await call(admin,{action:'reveal-password',id:'ana',adminPassword:'incorrect'})).status,403);
 const revealed=await call(admin,{action:'reveal-password',id:'ana',adminPassword:'test-password'});
 assert.equal(revealed.status,200);assert.equal(revealed.body.password,'new-vault-password');
 const audit=await store.get('password-vault-audit');assert.equal(audit.length,1);assert.equal(audit[0].targetId,'ana');assert.ok(!JSON.stringify(audit).includes('new-vault-password'));
 const pub=(await authRequest(request(participant,null,'GET'),store)).body.user;
 assert.equal(pub.passwordVault,undefined);assert.equal(pub.hash,undefined);
 const saved=await call(admin,{action:'save-access',id:'ana',name:'Ana',username:'ana',password:'admin-reset-password'});
 assert.equal(saved.status,200);
 assert.equal(openPassword((await store.get('accounts')).find(a=>a.id==='ana')),'admin-reset-password');
});

test('session host can join during writing without resetting timer; late participants remain blocked',async()=>{
 const store=new Store(),gameStore=new Store();
 await store.setJSON('accounts',configs);await gameStore.setJSON('game-state',game);
 const admin=await login(store,'alexandre-neto'),ana=await login(store,'ana'),bruno=await login(store,'bruno');
 const call=(cookie,body)=>roomRequest(request(cookie,body),{store,gameStore});
 await call(admin,{action:'create'});const room=await store.get('active-room');
 await call(ana,{action:'join',roomId:room.id});await call(admin,{action:'start',roomId:room.id});
 const deadline=(await store.get('active-room')).deadline;
 assert.equal((await call(bruno,{action:'join',roomId:room.id})).status,409);
 assert.equal((await call(admin,{action:'join',roomId:room.id})).status,200);
 assert.equal((await store.get('active-room')).deadline,deadline);
 assert.equal((await call(admin,{action:'save',roomId:room.id,best:'Meu melhor',worst:'Meu pior',done:true,revision:Date.now()})).status,200);
 assert.equal((await store.get('active-room')).members.filter(id=>id==='alexandre-neto').length,1);
});
