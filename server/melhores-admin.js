import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { sealPassword, openPassword } from './melhores-password-vault.js';
import { applySheetRows, syncSheetGoals, sheetSource } from './melhores-sheet.js';
import { getStore } from '@netlify/blobs';
import { requireAdmin, authenticate, users, json, update } from './melhores-auth.js';
const keys=['exercicio','familia','alimentacao','hobbies','conhecimentos'];
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
export async function adminRequest(request,deps={}){
 try{
  const accountsStore=deps.store||getStore({name:'melhores-private',consistency:'strong'});
  const denied=await requireAdmin(request,accountsStore);if(denied)return denied;
  const gameStore=deps.gameStore||getStore({name:'melhores-game',consistency:'strong'});
  const body=request.body||{};
  if(request.method==='POST'&&body.action==='chat-reports'){
   const sessions=await accountsStore.get('chat-report-index',{type:'json'})||[];
   if(!body.roomId)return json({ok:true,sessions});
   if(!sessions.some(s=>s.id===body.roomId))return json({ok:false,error:'Relatório não encontrado.'},404);
   const report=await accountsStore.get('chat-reports/'+body.roomId,{type:'json'});
   return report?json({ok:true,report}):json({ok:false,error:'Relatório não encontrado.'},404);
  }
  if(request.method==='POST'){
   if(body.action==='reveal-password'){
    const signed=await authenticate(request,accountsStore);
    const list=await users(accountsStore),admin=list.find(a=>a.id===signed.id);
    const attemptKey='vault-attempts/'+signed.id;
    const attempt=await update(accountsStore,attemptKey,old=>{const a=old&&old.until>Date.now()?old:{count:0,until:Date.now()+15*60e3};return {...a,count:a.count+1};});
    if(attempt.count>12)fail('Muitas tentativas. Aguarde 15 minutos.',429);
    if(typeof body.adminPassword!=='string'||body.adminPassword.length>200)fail('Confirme sua senha de administrador.',403);
    const actual=scryptSync(body.adminPassword,admin.salt,64),expected=Buffer.from(admin.hash,'hex');
    if(actual.length!==expected.length||!timingSafeEqual(actual,expected))fail('Senha do administrador incorreta.',403);
    const target=list.find(a=>a.id===body.id);if(!target)fail('Conta não encontrada.',404);
    let password;try{password=openPassword(target);}catch{fail('A senha mudou fora do cofre ou o cofre está indisponível.',409);}
    if(password===null)fail('Senha ainda não registrada no cofre. Ela será registrada na próxima troca.',409);
    await update(accountsStore,'password-vault-audit',old=>[...(old||[]),{adminId:signed.id,targetId:target.id,at:new Date().toISOString()}].slice(-500));
    await accountsStore.delete(attemptKey);
    return json({ok:true,password});
   }
   if(body.action==='save-access'){
    if(typeof body.username!=='string'||!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(body.username))fail('Login inválido: use letras minúsculas, números, ponto, hífen ou sublinhado.');
    if(typeof body.name!=='string'||!body.name.trim()||body.name.length>100)fail('Nome inválido.');
    if(body.password!==undefined&&(typeof body.password!=='string'||body.password.length<8||body.password.length>200))fail('A nova senha deve ter de 8 a 200 caracteres.');
    const salt=body.password?randomBytes(16).toString('hex'):null;
    const hash=salt?scryptSync(body.password,salt,64).toString('hex'):null;
    await update(accountsStore,'accounts',existing=>{
     const list=existing||JSON.parse(process.env.MELHORES_USERS_JSON||'[]');
     const a=list.find(a=>a.id===body.id);if(!a)fail('Login não encontrado.',404);
     if(list.some(other=>other.id!==a.id&&other.username===body.username))fail('Este login já está em uso.',409);
     a.username=body.username;a.name=body.name.trim();
     if(hash){a.salt=salt;a.hash=hash;a.passwordVault=sealPassword(body.password,a);a.sessionVersion=randomBytes(16).toString('hex');a.passwordUpdatedAt=new Date().toISOString();}
     a.accessUpdatedAt=new Date().toISOString();a.accessUpdatedBy='alexandre-neto';
     return list;
    });
    await update(gameStore,'game-state',state=>{if(state){const p=state.participants?.find(p=>p.id===body.id);if(p)p.name=body.name.trim();}return state;});
   }else if(body.action==='delete-account'){
    if(body.id==='alexandre-neto')fail('O administrador não pode ser excluído.');
    const account=(await users(accountsStore)).find(a=>a.id===body.id);if(!account)fail('Login não encontrado.',404);
    await update(accountsStore,'deleted-accounts',old=>[...new Set([...(old||[]),body.id])]);
    await update(accountsStore,'accounts',list=>(list||JSON.parse(process.env.MELHORES_USERS_JSON||'[]')).filter(a=>a.id!==body.id));
   }else if(body.action==='account-status'){
    await update(accountsStore,'accounts',existing=>{
     const list=existing||JSON.parse(process.env.MELHORES_USERS_JSON||'[]');
     const account=list.find(a=>a.id===body.id);if(!account)fail('Login não encontrado.',404);
     if(body.action==='account-status'){
      if(typeof body.disabled!=='boolean')fail('Status inválido.');
      if(account.id==='alexandre-neto'&&body.disabled)fail('O acesso do administrador não pode ser desativado.');
      // Changing this version revokes existing sessions even after reactivation.
      account.disabled=body.disabled;account.sessionVersion=Date.now().toString();
     }
     return list;
    });
   }else if(body.action==='import-sheet'){
    if(!Array.isArray(body.rows)||body.rows.length>2000)fail('Linhas inválidas.');
    const accounts=await users(accountsStore);
    await update(gameStore,'game-state',state=>applySheetRows(state||{participants:[]},body.rows,accounts));
   }else if(body.action==='save-profile'){
    if(typeof body.name!=='string'||!body.name.trim()||body.name.length>100)fail('Informe um nome válido.');
    if(!body.objectives||keys.some(k=>typeof body.objectives[k]!=='string'||body.objectives[k].length>4000))fail('Informe as cinco metas (até 4.000 caracteres cada).');
    if(body.photoUrl!==undefined){
     if(typeof body.photoUrl!=='string'||body.photoUrl.length>500000)fail('Foto muito grande.');
     if(body.photoUrl&&!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(body.photoUrl)){
      try{if(new URL(body.photoUrl).protocol!=='https:')fail('Use uma foto ou endereço HTTPS.');}catch{fail('Use uma foto ou endereço HTTPS.');}
     }
    }
    const accountList=await users(accountsStore);
    await update(gameStore,'game-state',state=>{
     state||={participants:[],weeklyFactHistory:[],removedParticipantIds:[]};
     let p=state.participants.find(p=>p.id===body.id);
     if(!p){
      if(!accountList.some(a=>(a.participantId||a.id)===body.id))fail('Participante não encontrado.',404);
      if(state.removedParticipantIds?.includes(body.id))fail('Este perfil foi removido. Restaure-o antes de editar.',409);
      p={id:body.id,name:body.name,objectives:{},categories:Object.fromEntries([...keys,'bestWeek'].map(k=>[k,0])),scoreBreakdown:{melhorFato:0,piorFato:0},totalPoints:0};state.participants.push(p);
     }
     if(JSON.stringify(p.objectives||{})!==body.expectedObjectives)fail('As metas mudaram em outra janela. Atualize antes de salvar.',409);
     if(body.photoUrl!==undefined)p.photoUrl=body.photoUrl;
     p.name=body.name.trim();p.objectives=Object.fromEntries(keys.map(k=>[k,body.objectives[k].trim()]));
     p.objectiveModeration=Object.fromEntries(keys.map(k=>[k,{reporterIds:[],flagged:false}]));
     return state;
    });
   }else fail('Ação inválida.');
  }else if(request.method!=='GET')return json({ok:false},405);
  await syncSheetGoals(gameStore,accountsStore,await users(accountsStore),deps.store?{url:deps.sheetUrl||''}:{});
  const game=await gameStore.get('game-state',{type:'json'})||{participants:[]};
  const accounts=await users(accountsStore);
  return json({ok:true,sheetSync:{configured:!!sheetSource(),status:await accountsStore.get('sheet-sync-status',{type:'json'}),formUrl:process.env.MELHORES_GOALS_FORM_URL||null,lastSuccess:game.sheetSync?.lastSuccess||null},accounts:accounts.map(a=>({id:a.id,username:a.username,name:a.name,role:a.role,disabled:a.disabled===true,accessUpdatedAt:a.accessUpdatedAt||null,passwordUpdatedAt:a.passwordUpdatedAt||null,accessUpdatedBy:a.accessUpdatedBy||null,participantId:a.participantId||a.id})),participants:(game.participants||[]).filter(p=>accounts.some(a=>(a.participantId||a.id)===p.id)),history:game.weeklyFactHistory||[]});
 }catch(e){return json({ok:false,error:e.status?e.message:'Não foi possível gerenciar os usuários.'},e.status||503);}
}
