import { update } from './melhores-auth.js';
export const SHEET_DATA_URL='https://docs.google.com/spreadsheets/d/1NScAndOyqQkw5CUKqQp9jOEWlj-B1YwgzyvDY-0NYxc/export?format=csv&gid=417247986';
export const sheetSource=()=>process.env.MELHORES_SHEET_DATA_URL||SHEET_DATA_URL;
const keys=['exercicio','familia','alimentacao','hobbies','conhecimentos'];
const norm=s=>String(s||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const aliases={camilaandrade:'camila',rhuandavyd:'rhuan',vitorhugobotelhoferreira:'vitor',brunomelimzardo:'bruno',alexandre:'alexandre-neto'};
export function sheetRows(text){
 if(text.trim().startsWith('{')){const d=JSON.parse(text);if(!Array.isArray(d.values))throw Error('Planilha sem linhas válidas.');return d.values;}
 const rows=[];let row=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(field);field='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(Boolean))rows.push(row);row=[];field='';}else field+=c;}
 if(quoted)throw Error('CSV incompleto.');if(field||row.length){row.push(field);rows.push(row);}return rows;
}
export function applySheetRows(state,rows,accounts,now=new Date().toISOString()){
 if(!Array.isArray(rows)||rows.length<2||!norm(rows[0]?.[1]).includes('nome'))throw Error('Confira a aba de respostas e a coluna Nome.');
 const activeIds=new Set(accounts.map(a=>a.participantId||a.id)),report={matched:[],unmatched:[]};
 state.participants||=[];state.removedParticipantIds=(state.removedParticipantIds||[]).filter(id=>!activeIds.has(id));
 for(const a of accounts){const id=a.participantId||a.id;if(!state.participants.some(p=>p.id===id)&&!state.removedParticipantIds?.includes(id))state.participants.push({id,name:a.name,objectives:{},categories:Object.fromEntries([...keys,'bestWeek'].map(k=>[k,0])),scoreBreakdown:{melhorFato:0,piorFato:0},totalPoints:0});}
 for(const p of state.participants)if(activeIds.has(p.id))p.sheetEnrollment={...p.sheetEnrollment,active:false,checkedAt:now};
 // Google Forms appends responses; the latest complete response wins for each person.
 for(const row of rows.slice(1)){
  if(!row[1]?.trim())continue;const name=norm(row[1]);
  const matched=(state.participants||[]).filter(p=>activeIds.has(p.id)&&(norm(p.name)===name||norm(p.id)===name||accounts.some(a=>(a.participantId||a.id)===p.id&&norm(a.name)===name)||p.id===aliases[name]));
  if(matched.length!==1){report.unmatched.push(String(row[1]).trim());continue;}
  const p=matched[0],objectives=Object.fromEntries(keys.map((key,i)=>[key,String(row[i+2]||'').trim()]));
  if(Object.values(objectives).some(v=>!v||v.length>4000))continue;
  const responseSignature=JSON.stringify(row.slice(0,7));
  if(p.sheetEnrollment?.responseSignature!==responseSignature)p.objectives=objectives;
  p.sheetEnrollment={active:true,checkedAt:now,responseAt:String(row[0]||''),responseSignature};report.matched.push(p.id);
 }
 state.sheetSync={lastSuccess:now,matched:[...new Set(report.matched)].length,unmatched:report.unmatched};return state;
}
export async function syncSheetGoals(gameStore,accountsStore,accounts,options={}){
 const url=options.url??sheetSource();if(!url)return;
 const parsed=new URL(url);if(parsed.protocol!=='https:'||!['docs.google.com','sheets.googleapis.com'].includes(parsed.hostname))throw Error('Fonte da planilha não permitida.');
 const now=Date.now();let acquired=false;
 try{
  // A held lease is read-only: every participant poll must not rewrite one hot key.
  if((await accountsStore.get('sheet-sync-lock',{type:'json'}))?.until>now)return;
  await update(accountsStore,'sheet-sync-lock',old=>{acquired=false;if(old?.until>now)return old;acquired=true;return {until:now+60000};});
  if(!acquired)return;
  const response=await (options.fetcher||fetch)(url,{signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('Planilha sem acesso de leitura.');
  const text=await response.text();if(text.length>2000000)throw Error('Planilha acima do limite.');const rows=sheetRows(text);
  await update(gameStore,'game-state',state=>applySheetRows(state||{participants:[]},rows,accounts));
  await accountsStore.setJSON('sheet-sync-status',{ok:true,checkedAt:new Date().toISOString()});
 }catch(error){
  // Optional refresh failures must not make the room or cached goals unavailable.
  try{await accountsStore.setJSON('sheet-sync-status',{ok:false,checkedAt:new Date().toISOString(),error:'A atualização da planilha está indisponível. As metas salvas foram preservadas.'});}catch{console.error('[sheet-sync] Não foi possível registrar o status da atualização.');}
 }
}
