// Run only after explicit authorization and after deploying the bootstrap configuration.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const [site, directory] = process.argv.slice(2);
if(!site||!directory||new URL(site).protocol!=='https:') throw new Error('Uso: node scripts/import-room-accounts.mjs https://site pasta-privada');
const credentials=JSON.parse(await readFile(resolve(directory,'credentials.json'),'utf8'));
const admin=credentials.find(c=>c.id==='alexandre-neto');
const login=await fetch(new URL('/api/melhores/auth',site),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:admin.username,password:admin.password})});
if(!login.ok)throw new Error('Falha no login administrador. Nenhuma conta importada.');
const cookie=login.headers.get('set-cookie')?.split(';')[0];if(!cookie)throw new Error('Sessão não recebida.');
try{
 const body=await readFile(resolve(directory,'accounts-import.json'),'utf8');
 const result=await fetch(new URL('/api/melhores/auth',site),{method:'POST',headers:{'Content-Type':'application/json',cookie},body});
 const data=await result.json();if(!result.ok)throw new Error(data.error||'Falha na importação.');
 console.log(`Contas ativas no servidor: ${data.count}. Contas preexistentes não foram sobrescritas.`);
}finally{await fetch(new URL('/api/melhores/auth',site),{method:'POST',headers:{'Content-Type':'application/json',cookie},body:JSON.stringify({action:'logout'})});}
