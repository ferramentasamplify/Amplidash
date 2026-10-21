import { randomBytes } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { authenticate, sameOrigin, users, json, update } from './melhores-auth.js';
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
export async function roomRequest(request, deps = {}) {
  try {
    const store = deps.store || getStore({ name: 'melhores-private', consistency: 'strong' });
    const user = await authenticate(request, store);
    if (!user) return json({ ok: false, error: 'Entre com seu login.' }, 401);
    if (!sameOrigin(request)) return json({ ok: false, error: 'Origem não permitida.' }, 403);
    const accounts = await users(store);
    const body = request.body || {};
    if (request.method === 'POST') {
      const { action } = body;
      if (['create','start','extend','present','next','close'].includes(action) && user.role !== 'admin') fail('Acesso exclusivo do administrador.', 403);
      if (action === 'create') {
        await update(store, 'active-room', old => {
          if (old && old.phase !== 'closed') fail('Encerre a sala atual antes de criar outra.', 409);
          return { id: randomBytes(8).toString('hex'), phase: 'waiting', createdAt: new Date().toISOString(), members: [], deadline: null, current: 0 };
        });
      } else if (action === 'save') {
        const room = await store.get('active-room', { type: 'json' });
        if (!room || room.id !== body.roomId || room.phase !== 'writing' || !room.members.includes(user.id)) fail('A escrita não está aberta para você nesta sala.', 409);
        if (typeof body.best !== 'string' || typeof body.worst !== 'string' || body.best.length > 4000 || body.worst.length > 4000) fail('Cada relato deve ter até 4.000 caracteres.');
        if (body.done && (!body.best.trim() || !body.worst.trim())) fail('Preencha o melhor e o pior antes de marcar como concluído.');
        // Each participant writes a different key: simultaneous drafts cannot overwrite one another.
        await update(store, `rooms/${room.id}/${user.id}`, old => {
          if (old?.revision && Number(body.revision) < old.revision) fail('Este rascunho foi atualizado em outra janela. Recarregue antes de editar.', 409);
          return { best: body.best, worst: body.worst, done: body.done === true, revision: Number(body.revision) || Date.now(), savedAt: new Date().toISOString() };
        });
      } else {
        await update(store, 'active-room', room => {
          if (!room || room.id !== body.roomId) fail('A sala mudou. Atualize a página.', 409);
          if (action === 'join') {
            if (room.phase !== 'waiting' && !room.members.includes(user.id)) fail('A rodada já começou. Aguarde a próxima sala.', 409);
            if (!room.members.includes(user.id)) room.members.push(user.id);
          } else if (action === 'start') {
            if (room.phase !== 'waiting' || !room.members.length) fail('A sala precisa de participantes e deve estar aguardando.', 409);
            room.phase = 'writing'; room.deadline = Date.now() + 300e3;
          } else if (action === 'extend') {
            if (room.phase !== 'writing') fail('O cronômetro só vale durante a escrita.', 409);
            if (![60,300].includes(body.seconds)) fail('Escolha +1 ou +5 minutos.');
            room.deadline = Math.max(Date.now(), room.deadline) + body.seconds * 1000;
          } else if (action === 'present') {
            if (room.phase !== 'writing') fail('A escrita ainda não começou.', 409);
            room.phase = 'presenting'; room.current = 0;
          } else if (action === 'next') {
            if (room.phase !== 'presenting') fail('A apresentação não começou.', 409);
            room.current = Math.min(room.current + 1, room.members.length - 1);
          } else if (action === 'close') {
            if (room.phase === 'closed') fail('A sala já foi encerrada.', 409);
            room.phase = 'closed'; room.closedAt = new Date().toISOString();
          } else fail('Ação inválida.');
          return room;
        });
      }
    } else if (request.method !== 'GET') return json({ ok: false }, 405);
    const room = await store.get('active-room', { type: 'json' });
    const game = deps.game || await getStore({ name: 'melhores-game', consistency: 'strong' }).get('game-state', { type: 'json' }) || {};
    const profile = (game.participants || []).find(p => p.id === user.id);
    if (!room) return json({ ok: true, user, profile: profile || { name: user.name }, room: null, serverTime: Date.now() });
    // Preserve the room separately; closing never resets scores or overwrites game-state.
    if (room.phase === 'closed') await store.setJSON('room-history/' + room.id, room);
    const rows = await Promise.all(room.members.map(async id => {
      const account = accounts.find(u => u.id === id);
      const participant = (game.participants || []).find(p => p.id === id);
      const draft = await store.get(`rooms/${room.id}/${id}`, { type: 'json' });
      const revealed = room.phase === 'presenting' && room.members[room.current] === id;
      return { id, name: participant?.name || account?.name || 'Participante', photoUrl: participant?.photoUrl || '', done: !!draft?.done,
        ...(user.role === 'admin' || id === user.id || revealed ? { draft: draft || { best: '', worst: '', done: false, revision: 0 } } : {}) };
    }));
    return json({ ok: true, user, profile: profile || { name: user.name }, room: { ...room, members: rows }, serverTime: Date.now() });
  } catch (e) { console.error('[room]', e.message); return json({ ok: false, error: e.status ? e.message : 'Não foi possível acessar a sala. Tente novamente.' }, e.status || 503); }
}
