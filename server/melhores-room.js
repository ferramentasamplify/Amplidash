import { syncSheetGoals } from './melhores-sheet.js';
import { personalProfile } from './melhores-profile.js';
import { randomBytes } from 'node:crypto';
import { getStore } from '@netlify/blobs';
import { authenticate, sameOrigin, users, json, update } from './melhores-auth.js';
const adminActions = ['start','extend','present','show-worst','next','close','vote-best','vote-worst','resolve','goals','mark','next-goal','resolve-var','test-mode'];
const categories = ['exercicio','familia','alimentacao','hobbies','conhecimentos'];
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
function finishBallot(room,kind){
  const counts=Object.fromEntries(room.members.map(id=>[id,0]));
  for(const target of Object.values(room.votes?.[kind]||{}))if(Object.hasOwn(counts,target))counts[target]++;
  const max=Math.max(...Object.values(counts));
  const tied=room.members.filter(id=>counts[id]===max);
  room.results||={};room.results[kind]={counts,tied,winner:tied.length===1?tied[0]:null};
  room.phase=tied.length===1?'result-'+kind:'tie-'+kind;
  room.votingClosedAt=Date.now();
}
async function refreshBallot(store){
  const snapshot=await store.get('active-room',{type:'json'});
  if(!snapshot?.phase?.startsWith('voting-'))return;
  if(snapshot.votingDeadline&&snapshot.votingDeadline>Date.now())return;
  await update(store,'active-room',room=>{
    if(room?.id!==snapshot.id||!room.phase.startsWith('voting-'))return room;
    // Open ballots created before this release receive their own full five minutes.
    if(!room.votingDeadline)room.votingDeadline=Date.now()+300000;
    else if(room.votingDeadline<=Date.now())finishBallot(room,room.phase.endsWith('-best')?'best':'worst');
    return room;
  });
}
export async function roomRequest(request, deps = {}) {
  try {
    const store = deps.store || getStore({ name: 'melhores-private', consistency: 'strong' });
    const user = await authenticate(request, store);
    if (!user) return json({ ok: false, error: 'Entre com seu login.' }, 401);
    if (!sameOrigin(request)) return json({ ok: false, error: 'Origem não permitida.' }, 403);
    const accounts = await users(store);
    await refreshBallot(store);
    const body = request.body || {};
    if (request.method === 'POST') {
      const { action } = body;
      if (['create','start','extend','present','show-worst','next','close','vote-best','vote-worst','resolve','goals','mark','next-goal','resolve-var','test-mode'].includes(action) && user.role !== 'admin') fail('Acesso exclusivo do administrador.', 403);
      if (action === 'create') {
        const prior=await store.get('active-room',{type:'json'});
        if(prior?.phase==='completed')await store.setJSON('room-history/'+prior.id,prior);
        await update(store, 'active-room', old => {
          if (old && !['closed','completed'].includes(old.phase)) fail('Encerre a sala atual antes de criar outra.', 409);
          return { id: randomBytes(8).toString('hex'), phase: 'waiting', createdAt: new Date().toISOString(), administratorId: user.id, members: [], deadline: null, current: 0, votes: { best: {}, worst: {} }, results: {}, goalResults: {} };
        });
      } else if (action === 'chat') {
        const room=await store.get('active-room',{type:'json'});
        if(!room||room.id!==body.roomId||['closed','completed'].includes(room.phase)||(!room.members.includes(user.id)&&user.id!==room.administratorId))fail('Entre na sala para conversar.',403);
        const text=typeof body.text==='string'?body.text.trim():'';
        const gif=typeof body.gif==='string'?body.gif.trim():'';
        if(text.length>1000||gif.length>2000||(!text&&!gif))fail('Envie texto de até 1.000 caracteres ou um GIF.');
        if(gif){let url;try{url=new URL(gif);}catch{fail('Link de GIF inválido.');}
          if(url.protocol!=='https:'||!['media.giphy.com','i.giphy.com','media.tenor.com'].includes(url.hostname)||!url.pathname.toLowerCase().endsWith('.gif')||url.username||url.password||url.port)fail('Use um link direto HTTPS de GIF do Giphy ou Tenor.');}
        await update(store,'room-chat/'+room.id,old=>{const messages=old||[];
          if(messages.some(m=>m.userId===user.id&&m.at>Date.now()-1500))fail('Aguarde um instante antes de enviar outra mensagem.',429);
          return [...messages,{id:randomBytes(12).toString('hex'),userId:user.id,name:user.name,text,gif,at:Date.now()}].slice(-150);
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
          if (adminActions.includes(action)) {
            room.administratorId ||= accounts.find(a => a.role === 'admin')?.id;
            if (room.administratorId !== user.id) fail('Somente o administrador desta sessão pode conduzir a reunião.', 403);
          }
          if(['show-worst','next','turn-next'].includes(action)&&body.target&&body.target!==room.members[room.current])fail('A pessoa da vez mudou. Atualize a tela.',409);
          if(['vote-worst','goals'].includes(action)){
            const kind=action==='vote-worst'?'best':'worst';
            if(room.var?.[kind]?.pending)fail('O ADM precisa concluir o VAR antes de continuar.',409);
          }
          if(action==='test-mode'){
            if(room.phase!=='waiting')fail('O modo teste só pode mudar antes de iniciar a rodada.',409);
            if(typeof body.enabled!=='boolean')fail('Informe se o modo teste deve ser habilitado.');
            room.testMode=body.enabled;
          }else if(action==='turn-next'){
            if(room.phase!=='presenting'||(!room.members.includes(user.id)&&user.role!=='admin')||(user.id!==room.members[room.current]&&user.id!==room.administratorId))fail('Somente a pessoa da vez ou o ADM pode avançar.',403);
            if(room.presentationFact!=='worst')room.presentationFact='worst';
            else if(room.current<room.members.length-1){room.current++;room.presentationFact='best';}
            else fail('Aguarde o ADM abrir a votação.',409);
          }else if(action==='var'){
            const kind=room.phase==='result-best'?'best':room.phase==='result-worst'?'worst':null;
            if(!kind||(!room.members.includes(user.id)&&user.id!==room.administratorId))fail('O VAR só pode ser solicitado no resultado da rodada.',403);
            const electorate=[...new Set([...room.members,room.administratorId])];
            room.var||={};const review=room.var[kind]||={requests:[],threshold:Math.floor(electorate.length/2)+1,pending:false,resolved:false};
            if(review.resolved)fail('O ADM já decidiu este VAR.',409);
            if(!review.requests.includes(user.id))review.requests.push(user.id);
            if(review.requests.length>=review.threshold)review.pending=true;
          }else if(action==='resolve-var'){
            const kind=room.phase==='result-best'?'best':room.phase==='result-worst'?'worst':null;
            if(!kind||!room.var?.[kind]?.pending||!room.members.includes(body.target))fail('VAR ou participante inválido.',409);
            room.var[kind].pending=false;room.var[kind].resolved=true;room.var[kind].decidedBy=user.id;
            room.results[kind].winner=body.target;
          }else if (action === 'join') {
            const hostJoiningWriting = room.phase === 'writing' && user.role === 'admin' && room.administratorId === user.id;
            if (room.phase !== 'waiting' && !hostJoiningWriting && !room.members.includes(user.id)) fail('A rodada já começou. Aguarde a próxima sala.', 409);
            if (!room.members.includes(user.id)) room.members.push(user.id);
          } else if (action === 'start') {
            if (room.phase !== 'waiting' || !room.members.length) fail('A sala precisa de participantes e deve estar aguardando.', 409);
            if (body.participate === true && !room.members.includes(user.id)) room.members.push(user.id);
            room.phase = 'writing'; room.deadline = Date.now() + 300e3;
          } else if (action === 'extend') {
            if (room.phase !== 'writing') fail('O cronômetro só vale durante a escrita.', 409);
            if (![60,300].includes(body.seconds)) fail('Escolha +1 ou +5 minutos.');
            room.deadline = Math.max(Date.now(), room.deadline) + body.seconds * 1000;
          } else if (action === 'present') {
            if (room.phase !== 'writing') fail('A escrita ainda não começou.', 409);
            room.phase = 'presenting'; room.current = 0; room.presentationFact='best';
          } else if (action === 'show-worst') {
            if(room.phase!=='presenting')fail('A apresentação não começou.',409);
            room.presentationFact='worst';
          } else if (action === 'next') {
            if (room.phase !== 'presenting') fail('A apresentação não começou.', 409);
            if(room.presentationFact!=='worst')fail('Apresente o pior fato antes de avançar.',409);
            room.current = Math.min(room.current + 1, room.members.length - 1);room.presentationFact='best';
          } else if (action === 'vote-best' || action === 'vote-worst') {
            const kind = action === 'vote-best' ? 'best' : 'worst';
            if (kind === 'best' ? room.phase !== 'presenting' || room.current !== room.members.length-1 || room.presentationFact!=='worst' : room.phase !== 'result-best') fail('Conclua a etapa anterior.',409);
            const eligible = [...room.members];
            if (room.members.filter(id=>presence[id]?.seen>Date.now()-60000).length < 2) fail('São necessárias pelo menos duas pessoas conectadas para votar.',409);
            room.votes ||= {best:{},worst:{}}; room.results ||= {};
            room.electorate = eligible; room.phase = 'voting-'+kind; room.votingDeadline=Date.now()+300000; room.votingClosedAt=null;
          } else if (action === 'vote') {
            const kind = room.phase === 'voting-best' ? 'best' : room.phase === 'voting-worst' ? 'worst' : null;
            const hostVoting = user.role === 'admin' && room.administratorId === user.id;
            if (!kind || (!room.members.includes(user.id) && !hostVoting)) fail('Você não participa desta votação.',403);
            if(room.votingDeadline&&Date.now()>=room.votingDeadline)fail('O prazo de votação terminou. Aguarde a atualização do resultado.',409);
            if (body.target === user.id) fail('Ninguém pode votar em si mesmo.',400);
            if (!room.members.includes(body.target)) fail('Participante inválido.');
            if (room.votes[kind][user.id]) fail('Seu voto já foi registrado.',409);
            if (!room.electorate.includes(user.id)) room.electorate.push(user.id);
            room.votes[kind][user.id] = body.target;
            if (room.electorate.every(id => room.votes[kind][id])) {
              finishBallot(room,kind);
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
            room.goalResults[id] ||= {}; room.goalResults[id][body.category] = body.category==='exercicio'&&body.result==='done'&&body.gymrats!==true?'missed':body.result;
          } else if (action === 'next-goal') {
            if (room.phase !== 'goals' || !categories.every(k => room.goalResults[room.members[room.current]]?.[k])) fail('Marque as cinco metas antes de avançar.',409);
            if (body.target && body.target !== room.members[room.current]) fail('A pessoa da vez mudou. Atualize a tela.',409);
            if (room.current === room.members.length-1) {room.phase = 'completed';room.completedAt=new Date().toISOString();} else room.current++;
          } else if (action === 'close') {
            if (room.phase === 'closed') fail('A sala já foi encerrada.', 409);
            room.phase = 'closed'; room.closedAt = new Date().toISOString();
          } else fail('Ação inválida.');
          return room;
        });
      }
    } else if (request.method !== 'GET') return json({ ok: false }, 405);
    let room = await store.get('active-room', { type: 'json' });
    if(room?.members.includes(user.id)&&room.phase!=='closed')await store.setJSON(`presence/${room.id}/${user.id}`,{seen:Date.now()});
    if(room?.phase==='goals'){
      const target=room.members[room.current],seen=await store.get(`presence/${room.id}/${target}`,{type:'json'});
      if(!seen||seen.seen<Date.now()-60000){
        room=await update(store,'active-room',current=>{
          if(current?.id===room.id&&current.phase==='goals'&&current.members[current.current]===target){
            current.goalResults||={};current.goalResults[target]||={};
            for(const key of categories)current.goalResults[target][key]||='absent';
          }return current;
        });
      }
    }
    const profileStore=deps.gameStore||(!deps.game?getStore({name:'melhores-game',consistency:'strong'}):null);
    if(profileStore)await syncSheetGoals(profileStore,store,accounts,deps.store?{url:deps.sheetUrl||''}:{});
    let game = deps.game || await profileStore.get('game-state',{type:'json'}) || {};
    const profile = (game.participants || []).find(p => p.id === user.participantId);
    if (!room) return json({ ok: true, user, profile:personalProfile(game,user), room: null, serverTime: Date.now() });
    if (room.testMode!==true && ['completed','closed'].includes(room.phase) && room.results?.best?.winner && room.results?.worst?.winner && room.goalResults && room.members.every(id => categories.every(k=>room.goalResults[id]?.[k]))) {
      const gameStore = deps.gameStore || getStore({name:'melhores-game',consistency:'strong'});
      const winnerFact=async(kind)=>{
        const accountId=room.results[kind].winner;
        const account=accounts.find(a=>a.id===accountId);
        const draft=await store.get(`rooms/${room.id}/${accountId}`,{type:'json'});
        return {participantId:account?.participantId||accountId,label:account?.name||'',description:draft?.[kind]||''};
      };
      const best=await winnerFact('best'),worst=await winnerFact('worst');
      const savedGame=await update(gameStore,'game-state', gameState => {
        gameState ||= {participants:[]};
        gameState.appliedRooms ||= [];
        gameState.weeklyFactHistory ||= [];
        if(!gameState.weeklyFactHistory.some(entry=>entry.id==='room-'+room.id))gameState.weeklyFactHistory.push({id:'room-'+room.id,date:(room.completedAt||room.closedAt||new Date().toISOString()).slice(0,10),best,worst});
        if (gameState.appliedRooms.includes(room.id)) return gameState;
        for (const p of gameState.participants) {
          const memberId = room.members.find(id => (accounts.find(a=>a.id===id)?.participantId||id)===p.id);
          if (!memberId) continue;
          p.categories ||= {}; p.scoreBreakdown ||= {};
          for (const key of categories) p.categories[key] = Number(p.categories[key]||0) + ({done:1,missed:0,absent:-1}[room.goalResults[memberId][key]]);
          if (memberId === room.results.best.winner) p.scoreBreakdown.melhorFato = Number(p.scoreBreakdown.melhorFato||0)+1;
          if (memberId === room.results.worst.winner) p.scoreBreakdown.piorFato = Number(p.scoreBreakdown.piorFato||0)+1;
          p.categories.bestWeek = Number(p.categories.bestWeek||0) + Number(memberId===room.results.best.winner) + Number(memberId===room.results.worst.winner);
          p.totalPoints = Object.values(p.categories).reduce((sum,n)=>sum+Number(n||0),0);
        }
        gameState.appliedRooms.push(room.id); return gameState;
      });
      game=savedGame;
    }
    // Heartbeats are room-scoped, never inferred from saved drafts or historical members.
    if (room.members.includes(user.id) && room.phase !== 'closed') await store.setJSON(`presence/${room.id}/${user.id}`, {seen:Date.now()});
    // Preserve the room separately; closing never resets scores or overwrites game-state.
    if (room.phase === 'closed') await store.setJSON('room-history/' + room.id, room);
    const rows = await Promise.all(room.members.map(async id => {
      const account = accounts.find(u => u.id === id);
      const participant = (game.participants || []).find(p => p.id === (account?.participantId||id));
      const draft = await store.get(`rooms/${room.id}/${id}`, { type: 'json' });
      const seen = await store.get(`presence/${room.id}/${id}`, {type:'json'});
      const revealed = (room.phase === 'presenting' && room.members[room.current] === id) || /^(voting|tie|result)-/.test(room.phase);
      const goalsVisible = room.phase === 'goals' && room.members[room.current] === id;
      return { id, name: participant?.name || account?.name || 'Participante', photoUrl: participant?.photoUrl || '', online: !!seen && seen.seen > Date.now()-20000, done: !!draft?.done, ...(goalsVisible ? {objectives:participant?.objectives || {}} : {}),
        ...(user.role === 'admin' || id === user.id || revealed ? { draft: draft || { best: '', worst: '', done: false, revision: 0 } } : {}) };
    }));
    // Raw ballots are never returned, even to the administrator. Results appear only after all votes.
    const {votes, ...publicRoom} = room;
    const chat=room.members.includes(user.id)||room.administratorId===user.id?await store.get('room-chat/'+room.id,{type:'json'})||[]:[];
    const kind = room.phase.endsWith('-best') ? 'best' : 'worst';
    const voting = room.phase.startsWith('voting-');
    const safeProfile = personalProfile(game,user);
    return json({ ok: true, user, profile:safeProfile, room: { ...publicRoom, chat, administrator: (() => { const a = accounts.find(a => a.id === (room.administratorId || accounts.find(a => a.role === 'admin')?.id)); return a ? {id:a.id, name:a.name, username:a.username} : null; })(), members: rows,
      ...(voting ? {voted:!!votes?.[kind]?.[user.id], voteCount:Object.keys(votes?.[kind]||{}).length} : {}) }, serverTime: Date.now() });
  } catch (e) { console.error('[room]', e.message); return json({ ok: false, error: e.status ? e.message : 'Não foi possível acessar a sala. Tente novamente.' }, e.status || 503); }
}
