import { getStore } from '@netlify/blobs';
import { randomBytes, createHash, scryptSync, timingSafeEqual } from 'node:crypto';
const COOKIE = 'melhores_session';
const digest = s => createHash('sha256').update(s).digest('hex');
export const json = (body, status = 200, extra = {}) => ({ status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra }, body });
export async function users(store) {
  const saved = store ? await store.get('accounts', { type: 'json' }) : null;
  const list = saved || JSON.parse(process.env.MELHORES_USERS_JSON || '[]');
  if (!Array.isArray(list) || !list.length) throw new Error('Contas não configuradas no servidor.');
  const deleted=store?await store.get('deleted-accounts',{type:'json'}):[];
  return list.filter(u=>!(deleted||[]).includes(u.id)).map(u => ({ ...u, role: u.id === 'alexandre-neto' ? 'admin' : 'participant' }));
}
export function publicUser(u) { return { id: u.id, name: u.name, username: u.username, role: u.role, participantId:u.participantId||u.id, appearance:u.appearance||null }; }
export function sameOrigin(request) {
  const h = request.headers || {};
  const origin = h.origin || h.Origin;
  const host = h['x-forwarded-host'] || h.host || h.Host;
  if (!origin) return true; // Non-browser clients still require a session.
  try { return new URL(origin).host === host; } catch { return false; }
}
export function sessionKey(request) {
  const cookie = request.headers?.cookie || request.headers?.Cookie || '';
  const token = cookie.split(';').map(s => s.trim()).find(s => s.startsWith(COOKIE + '='))?.slice(COOKIE.length + 1);
  return /^[a-f0-9]{64}$/.test(token || '') ? 'sessions/' + digest(token) : null;
}
export async function authenticate(request, store) {
  const key = sessionKey(request);
  if (!key) return null;
  store ||= getStore({ name: 'melhores-private', consistency: 'strong' });
  const session = await store.get(key, { type: 'json' });
  if (!session || session.expires < Date.now()) return null;
  const user = (await users(store)).find(u => u.id === session.userId);
  return user && !user.disabled && session.version === digest(user.hash + (user.sessionVersion||'')) ? publicUser(user) : null;
}
export async function requireAdmin(request, store) {
  if (!sameOrigin(request)) return json({ ok: false, error: 'Origem não permitida.' }, 403);
  const user = await authenticate(request, store);
  return user?.role === 'admin' ? null : json({ ok: false, error: 'Acesso exclusivo do administrador.' }, user ? 403 : 401);
}
// Compare-and-set protects login counters and the room against overlapping requests.
export async function update(store, key, transform) {
  for (let n = 0; n < 32; n++) {
    const old = await store.getWithMetadata(key, { type: 'json' });
    const value = transform(old?.data ?? null);
    const result = await store.set(key, JSON.stringify(value), old?.etag ? { onlyIfMatch: old.etag } : { onlyIfNew: true });
    if (result.modified && !result.etag) throw new Error('O armazenamento não confirmou a atualização.');
    if (result.modified) return value;
  }
  throw Object.assign(new Error('Há outra atualização em andamento. Tente novamente.'), { status: 409 });
}
export async function authRequest(request, store = getStore({ name: 'melhores-private', consistency: 'strong' })) {
  try {
    if (request.method === 'GET') return json({ ok: true, user: await authenticate(request, store) });
    if (request.method !== 'POST') return json({ ok: false }, 405);
    if (!sameOrigin(request)) return json({ ok: false, error: 'Origem não permitida.' }, 403);
    const body = request.body || {};
    const secure = process.env.NODE_ENV === 'test' || request.headers?.host?.startsWith('localhost:') ? '' : '; Secure';
    const cookie = value => `${COOKIE}=${value}; HttpOnly; SameSite=Strict; Path=/${secure}`;
    if (body.action === 'logout') {
      const key = sessionKey(request);
      if (key) await store.delete(key);
      return json({ ok: true }, 200, { 'Set-Cookie': cookie('') + '; Max-Age=0' });
    }
    if (body.action === 'appearance') {
      const signed=await authenticate(request,store);
      if(!signed)return json({ok:false,error:'Entre na sua conta.'},401);
      const a=body.appearance;
      if(!a||!['light','dark'].includes(a.mode)||!['amplify','ocean','forest','violet','sunset','rose','custom'].includes(a.palette)||!/^#[0-9a-f]{6}$/i.test(a.primary)||!/^#[0-9a-f]{6}$/i.test(a.accent))return json({ok:false,error:'Cores inválidas.'},400);
      const appearance={mode:a.mode,palette:a.palette,primary:a.primary,accent:a.accent};
      await update(store,'accounts',current=>{const list=current||JSON.parse(process.env.MELHORES_USERS_JSON||'[]');const account=list.find(u=>u.id===signed.id);if(!account)throw new Error('Conta não encontrada');account.appearance=appearance;return list;});
      return json({ok:true,appearance});
    }
    if (body.action === 'self-access') {
      const signed=await authenticate(request,store);
      if(!signed)return json({ok:false,error:'Entre na sua conta.'},401);
      const username=String(body.username||'').trim().toLowerCase(),password=String(body.password||''),currentPassword=String(body.currentPassword||'');
      if(!/^[a-z0-9][a-z0-9._-]{0,79}$/.test(username)||password&&(password.length<8||password.length>200)||currentPassword.length>200)return json({ok:false,error:'Use um login válido e senha nova com 8 a 200 caracteres.'},400);
      const attemptKey='self-attempts/'+signed.id;
      const attempt=await update(store,attemptKey,old=>{const a=old&&old.until>Date.now()?old:{count:0,until:Date.now()+15*60e3};return {...a,count:a.count+1};});
      if(attempt.count>12)return json({ok:false,error:'Muitas tentativas. Aguarde 15 minutos.'},429);
      const prior=(await users(store)).find(a=>a.id===signed.id);
      const actual=scryptSync(currentPassword,prior.salt,64),expected=Buffer.from(prior.hash,'hex');
      if(actual.length!==expected.length||!timingSafeEqual(actual,expected))return json({ok:false,error:'Senha atual incorreta.'},403);
      await update(store,'accounts',current=>{
        const list=current||JSON.parse(process.env.MELHORES_USERS_JSON||'[]'),a=list.find(a=>a.id===signed.id);
        if(!a||a.hash!==prior.hash||a.sessionVersion!==prior.sessionVersion)throw Object.assign(new Error('A conta mudou. Entre novamente.'),{status:409});
        if(list.some(other=>other.id!==a.id&&other.username===username))throw Object.assign(new Error('Este login já está em uso.'),{status:409});
        a.username=username;
        if(password){a.salt=randomBytes(16).toString('hex');a.hash=scryptSync(password,a.salt,64).toString('hex');}
        a.sessionVersion=randomBytes(16).toString('hex');
        a.accessUpdatedAt=new Date().toISOString();a.accessUpdatedBy=signed.id;a.passwordUpdatedAt=password?a.accessUpdatedAt:a.passwordUpdatedAt;
        return list;
      });
      await store.delete(attemptKey);
      return json({ok:true,relogin:true},200,{'Set-Cookie':cookie('')+'; Max-Age=0'});
    }
    if (body.action === 'import-accounts') {
      const admin = await authenticate(request, store);
      if (admin?.role !== 'admin') return json({ ok: false, error: 'Acesso exclusivo do administrador.' }, 403);
      const incoming = body.accounts;
      if (!Array.isArray(incoming) || incoming.length > 150 || incoming.some(u => !/^[a-z0-9-]{1,80}$/.test(u.id) || u.username !== u.id || typeof u.name !== 'string' || u.name.length > 100 || !/^[a-f0-9]{32}$/.test(u.salt) || !/^[a-f0-9]{128}$/.test(u.hash))) return json({ ok: false, error: 'Formato de contas inválido.' }, 400);
      if (new Set(incoming.map(u=>u.id)).size !== incoming.length) return json({ ok: false, error: 'Contas duplicadas.' }, 400);
      const deleted=await store.get('deleted-accounts',{type:'json'})||[];
      await update(store, 'accounts', current => {
        const prior = current || JSON.parse(process.env.MELHORES_USERS_JSON || '[]');
        const ids = new Set(prior.map(u=>u.id));
        // Never replace an existing account/password. The bootstrap admin must remain unchanged.
        return [...prior, ...incoming.filter(u=>!ids.has(u.id)&&!deleted.includes(u.id))];
      });
      return json({ ok: true, count: (await users(store)).length });
    }
    const username = String(body.username || '').trim().toLowerCase().slice(0,100);
    const password = String(body.password || '');
    if (!username || password.length > 200) return json({ ok: false, error: 'Login ou senha inválidos.' }, 401);
    const key = 'attempts/' + digest(username);
    const attempt = await update(store, key, old => {
      const a = old && old.until > Date.now() ? old : { count: 0, until: Date.now() + 15 * 60e3 };
      return { ...a, count: a.count + 1 };
    });
    if (attempt.count > 12) return json({ ok: false, error: 'Muitas tentativas. Aguarde 15 minutos.' }, 429);
    const user = (await users(store)).find(u => u.username === username);
    const salt = user?.salt || '00000000000000000000000000000000';
    const actual = scryptSync(password, salt, 64);
    const expected = Buffer.from(user?.hash || '00'.repeat(64), 'hex');
    if (!user || user.disabled || expected.length !== actual.length || !timingSafeEqual(expected, actual)) return json({ ok: false, error: 'Login ou senha inválidos.' }, 401);
    await store.delete(key); // Successful logins must not accumulate toward the failure limit.
    const token = randomBytes(32).toString('hex');
    await store.setJSON('sessions/' + digest(token), { userId: user.id, expires: Date.now() + 12 * 3600e3, version: digest(user.hash + (user.sessionVersion||'')) });
    return json({ ok: true, user: publicUser(user) }, 200, { 'Set-Cookie': cookie(token) + '; Max-Age=43200' });
  } catch (e) { console.error('[auth] ' + e.name + ': ' + e.message); return json({ ok: false, code: e.message.includes('uncachedEdgeURL') ? 'BLOBS_STRONG_CONTEXT' : e.message.includes('Contas não configuradas') ? 'AUTH_CONFIG' : e.name, error: e.status===409?e.message:'Não foi possível autenticar. Confira a configuração do servidor.' }, e.status || 503); }
}
