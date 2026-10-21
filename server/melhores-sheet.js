import { update } from './melhores-auth.js';
const keys=['exercicio','familia','alimentacao','hobbies','conhecimentos'];
const norm=s=>String(s||'').normalize('NFD').replace(/\p{Diacritic}/gu,'').toLowerCase().replace(/[^a-z0-9]/g,'');
const aliases={camilaandrade:'camila',rhuandavyd:'rhuan',vitorhugobotelhoferreira:'vitor'};
export function sheetRows(text){
 if(text.trim().startsWith('{')){const d=JSON.parse(text);if(!Array.isArray(d.values))throw Error('Planilha sem linhas válidas.');return d.values;}
 const rows=[];let row=[],field='',quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){if(quoted&&text[i+1]==='"'){field+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){row.push(field);field='';}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(field);if(row.some(Boolean))rows.push(row);row=[];field='';}else field+=c;}
 if(quoted)throw Error('CSV incompleto.');if(field||row.length){row.push(field);rows.push(row);}return rows;
}
export function applySheetRows(state,rows,accounts,now=new Date().toISOString()){
 if(!Array.isArray(rows)||rows.length<2||!norm(rows[0]?.[1]).includes('nome'))throw Error('Confira a aba de respostas e a coluna Nome.');
 const activeIds=new Set(accounts.map(a=>a.participantId||a.id)),report={matched:[],unmatched:[]};
 for(const p of state.participants||[])if(activeIds.has(p.id))p.sheetEnrollment={active:false,checkedAt:now};
 // Google Forms appends responses; the latest complete response wins for each person.
 for(const row of rows.slice(1)){
  if(!row[1]?.trim())continue;const name=norm(row[1]);
  const matched=(state.participants||[]).filter(p=>activeIds.has(p.id)&&(norm(p.name)===name||norm(p.id)===name||p.id===aliases[name]));
  if(matched.length!==1){report.unmatched.push(String(row[1]).trim());continue;}
  const p=matched[0],objectives=Object.fromEntries(keys.map((key,i)=>[key,String(row[i+2]||'').trim()]));
  if(Object.values(objectives).some(v=>!v||v.length>4000))continue;
  p.objectives=objectives;p.sheetEnrollment={active:true,checkedAt:now,responseAt:String(row[0]||'')};report.matched.push(p.id);
 }
 state.sheetSync={lastSuccess:now,matched:[...new Set(report.matched)].length,unmatched:report.unmatched};return state;
}
export async function syncSheetGoals(gameStore,accountsStore,accounts,options={}){
 const url=options.url||process.env.MELHORES_SHEET_DATA_URL;if(!url)return;
 const parsed=new URL(url);if(parsed.protocol!=='https:'||!['docs.google.com','sheets.googleapis.com'].includes(parsed.hostname))throw Error('Fonte da planilha não permitida.');
 const now=Date.now();let acquired=false;
 const lock=await update(accountsStore,'sheet-sync-lock',old=>{acquired=false;if(old?.until>now)return old;acquired=true;return {until:now+60000};});
 if(!acquired)return;
 try{
  const response=await (options.fetcher||fetch)(url,{signal:AbortSignal.timeout(10000)});if(!response.ok)throw Error('Planilha sem acesso de leitura.');
  const text=await response.text();if(text.length>2000000)throw Error('Planilha acima do limite.');const rows=sheetRows(text);
  await update(gameStore,'game-state',state=>applySheetRows(state||{participants:[]},rows,accounts));
  await accountsStore.setJSON('sheet-sync-status',{ok:true,checkedAt:new Date().toISOString()});
 }catch(error){await accountsStore.setJSON('sheet-sync-status',{ok:false,checkedAt:new Date().toISOString(),error:'A fonte da planilha está indisponível.'});}
}
