import { randomBytes } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { authenticate, sameOrigin, users, json, update } from './melhores-auth.js';
const categories = ['exercicio','familia','alimentacao','hobbies','conhecimentos'];
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
      if (['create','start','extend','present','next','close','vote-best','vote-worst','resolve','goals','mark','next-goal'].includes(action) && user.role !== 'admin') fail('Acesso exclusivo do administrador.', 403);
      if (action === 'create') {
        await update(store, 'active-room', old => {
          if (old && old.phase !== 'closed') fail('Encerre a sala atual antes de criar outra.', 409);
          return { id: randomBytes(8).toString('hex'), phase: 'waiting', createdAt: new Date().toISOString(), members: [], deadline: null, current: 0, votes: { best: {}, worst: {} }, results: {}, goalResults: {} };
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
        const presenceRoom = await store.get('active-room', { type: 'json' });
        const presence = {};
        if (presenceRoom) await Promise.all(presenceRoom.members.map(async id => { presence[id] = await store.get(`presence/${presenceRoom.id}/${id}`, {type:'json'}); }));
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
          } else if (action === 'vote-best' || action === 'vote-worst') {
            const kind = action === 'vote-best' ? 'best' : 'worst';
            if (kind === 'best' ? room.phase !== 'presenting' || room.current !== room.members.length-1 : room.phase !== 'result-best') fail('Conclua a etapa anterior.',409);
            const eligible = room.members.filter(id => presence[id]?.seen > Date.now()-20000);
            if (eligible.length < 2) fail('São necessárias pelo menos duas pessoas conectadas para votar.',409);
            room.votes ||= {best:{},worst:{}}; room.results ||= {};
            room.electorate = eligible; room.phase = 'voting-'+kind;
          } else if (action === 'vote') {
            const kind = room.phase === 'voting-best' ? 'best' : room.phase === 'voting-worst' ? 'worst' : null;
            if (!kind || !room.electorate.includes(user.id)) fail('Você não participa desta votação.',403);
            if (body.target === user.id) fail('Ninguém pode votar em si mesmo.',400);
            if (!room.members.includes(body.target)) fail('Participante inválido.');
            if (room.votes[kind][user.id]) fail('Seu voto já foi registrado.',409);
            room.votes[kind][user.id] = body.target;
            if (room.electorate.every(id => room.votes[kind][id])) {
              const counts = Object.fromEntries(room.members.map(id=>[id,0]));
              Object.values(room.votes[kind]).forEach(id => counts[id]++);
              const max = Math.max(...Object.values(counts));
              const tied = room.members.filter(id => counts[id] === max);
              room.results[kind] = {counts,tied,winner:tied.length===1?tied[0]:null};
              room.phase = tied.length===1 ? 'result-'+kind : 'tie-'+kind;
            }
          } else if (action === 'resolve') {
            const kind = room.phase === 'tie-best' ? 'best' : room.phase === 'tie-worst' ? 'worst' : null;
            if (!kind || !room.results[kind].tied.includes(body.target)) fail('Escolha uma das pessoas empatadas.');
            room.results[kind].winner = body.target; room.phase = 'result-'+kind;
          } else if (action === 'goals') {
            if (room.phase !== 'result-worst') fail('Conclua as duas votações.',409);
            room.phase = 'goals'; room.current = 0; room.goalResults = {};
          } else if (action === 'mark') {
            if (room.phase !== 'goals' || !categories.includes(body.category) || !['done','missed','absent'].includes(body.result)) fail('Resultado de meta inválido.');
            const id = room.members[room.current];
            if (body.target !== id) fail('A pessoa da vez mudou. Atualize a tela.',409);
            if (body.result === 'absent' && presence[id]?.seen > Date.now()-20000) fail('Esta pessoa está conectada.');
            room.goalResults[id] ||= {}; room.goalResults[id][body.category] = body.result;
          } else if (action === 'next-goal') {
            if (room.phase !== 'goals' || !categories.every(k => room.goalResults[room.members[room.current]]?.[k])) fail('Marque as cinco metas antes de avançar.',409);
            if (room.current === room.members.length-1) room.phase = 'completed'; else room.current++;
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
    if (!room) return json({ ok: true, user, profile: profile ? {name:profile.name,photoUrl:profile.photoUrl,objectives:profile.objectives} : { name: user.name }, room: null, serverTime: Date.now() });
    if (room.phase === 'closed' && room.results?.best?.winner && room.results?.worst?.winner && room.goalResults && room.members.every(id => categories.every(k=>room.goalResults[id]?.[k]))) {
      const gameStore = deps.gameStore || getStore({name:'melhores-game',consistency:'strong'});
      await update(gameStore,'game-state', gameState => {
        gameState ||= {participants:[]};
        gameState.appliedRooms ||= [];
        if (gameState.appliedRooms.includes(room.id)) return gameState;
        for (const p of gameState.participants) {
          if (!room.members.includes(p.id)) continue;
          p.categories ||= {}; p.scoreBreakdown ||= {};
          for (const key of categories) p.categories[key] = Number(p.categories[key]||0) + ({done:1,missed:0,absent:-1}[room.goalResults[p.id][key]]);
          if (p.id === room.results.best.winner) p.scoreBreakdown.melhorFato = Number(p.scoreBreakdown.melhorFato||0)+1;
          if (p.id === room.results.worst.winner) p.scoreBreakdown.piorFato = Number(p.scoreBreakdown.piorFato||0)+1;
          p.categories.bestWeek = Number(p.categories.bestWeek||0) + Number(p.id===room.results.best.winner) + Number(p.id===room.results.worst.winner);
          p.totalPoints = Object.values(p.categories).reduce((sum,n)=>sum+Number(n||0),0);
        }
        gameState.appliedRooms.push(room.id); return gameState;
      });
    }
    // Heartbeats are room-scoped, never inferred from saved drafts or historical members.
    if (room.members.includes(user.id) && room.phase !== 'closed') await store.setJSON(`presence/${room.id}/${user.id}`, {seen:Date.now()});
    // Preserve the room separately; closing never resets scores or overwrites game-state.
    if (room.phase === 'closed') await store.setJSON('room-history/' + room.id, room);
    const rows = await Promise.all(room.members.map(async id => {
      const account = accounts.find(u => u.id === id);
      const participant = (game.participants || []).find(p => p.id === id);
      const draft = await store.get(`rooms/${room.id}/${id}`, { type: 'json' });
      const seen = await store.get(`presence/${room.id}/${id}`, {type:'json'});
      const revealed = (room.phase === 'presenting' && room.members[room.current] === id) || /^(voting|tie|result)-/.test(room.phase);
      const goalsVisible = room.phase === 'goals' && room.members[room.current] === id;
      return { id, name: participant?.name || account?.name || 'Participante', photoUrl: participant?.photoUrl || '', online: !!seen && seen.seen > Date.now()-20000, done: !!draft?.done, ...(goalsVisible ? {objectives:participant?.objectives || {}} : {}),
        ...(user.role === 'admin' || id === user.id || revealed ? { draft: draft || { best: '', worst: '', done: false, revision: 0 } } : {}) };
    }));
    // Raw ballots are never returned, even to the administrator. Results appear only after all votes.
    const {votes, ...publicRoom} = room;
    const kind = room.phase.endsWith('-best') ? 'best' : 'worst';
    const voting = room.phase.startsWith('voting-');
    const safeProfile = profile ? {name:profile.name, photoUrl:profile.photoUrl, objectives:profile.objectives} : {name:user.name};
    return json({ ok: true, user, profile:safeProfile, room: { ...publicRoom, members: rows,
      ...(voting ? {voted:!!votes?.[kind]?.[user.id], voteCount:Object.keys(votes?.[kind]||{}).length} : {}) }, serverTime: Date.now() });
  } catch (e) { console.error('[room]', e.message); return json({ ok: false, error: e.status ? e.message : 'Não foi possível acessar a sala. Tente novamente.' }, e.status || 503); }
}
