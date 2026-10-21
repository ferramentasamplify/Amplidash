import {meetingNotice} from './meeting-schedule.js';
import {createMeetingSound} from './sound.js';
import '../css/room.css';
import '../css/brand.css';
const root = document.getElementById('weekly-room');
import {createAppearance} from './palettes.js';
const themeControl=document.createElement('div');
themeControl.className='theme-control';root.before(themeControl);
const appearance=createAppearance(themeControl, async value=>api('auth',{action:'appearance',appearance:value}));
const meetingSound=createMeetingSound(themeControl);
document.addEventListener('click',event=>{const b=event.target.closest('button');if(!b||b.disabled||!b.closest('#weekly-room'))return;b.classList.remove('button-feedback');void b.offsetWidth;b.classList.add('button-feedback');});

const photo = url => { try { return (new URL(url).protocol === 'https:' || /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(url)) ? `<img class="room-avatar" src="${esc(url)}" alt="" referrerpolicy="no-referrer">` : ''; } catch { return ''; } };
const initials=name=>{const parts=String(name||'').trim().split(/\s+/);return (parts.length>1?parts.slice(0,2).map(n=>n[0]).join(''):parts[0].slice(0,2)).toUpperCase();};
const avatar=(url,name)=>`<span class="member-portrait">${photo(url)||`<span>${esc(initials(name))}</span>`}</span>`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let user, state, layout, roomId, offset = 0, dirty = false, timer, polling = false, saving = Promise.resolve(), adminLoaded = false;
let draftRevision = 0;
let currentView='profile',profileLayout='',lastVotePhase='',lastEnding='',endingRoom=null;
let previousRoom=null;
function changeView(view){
 if(view!=='room')meetingSound.stop();
 if(view==='admin'&&user.role!=='admin')return;
 currentView=view;document.getElementById('admin-panel')?.toggleAttribute('hidden',view!=='admin');
 if(view!=='admin')document.getElementById('legacy-panel').hidden=true;
 document.getElementById('room-profile').hidden=view!=='profile';document.getElementById('room-content').hidden=view!=='room';
 document.querySelectorAll('[data-profile-view]').forEach(b=>{b.classList.toggle('active',b.dataset.profileView===view);b.setAttribute('aria-pressed',String(b.dataset.profileView===view));});
}
function renderProfile(){
 const profile=state.profile||{},room=state.room;
 const key=JSON.stringify([profile,room?.id,room?.phase]);if(key===profileLayout)return;profileLayout=key;
 const initials=(profile.name||user.name).split(/\s+/).slice(0,2).map(n=>n[0]).join('');
 const goals=[['exercicio','💪','Exercício físico'],['familia','👨‍👩‍👧‍👦','Família'],['alimentacao','🥗','Alimentação'],['hobbies','🎨','Hobbies'],['conhecimentos','📚','Conhecimentos']];
 const achievements=profile.achievements||[],best=achievements.filter(a=>a.kind==='best'),worst=achievements.filter(a=>a.kind==='worst');
 const date=value=>{if(!value)return 'Data não registrada';const d=new Date(value.slice(0,10)+'T12:00:00Z');return Number.isNaN(d.valueOf())?'Data não registrada':d.toLocaleDateString('pt-BR',{timeZone:'UTC'});};
 const stories=entries=>entries.map(a=>`<article class="profile-win"><span class="profile-win-icon" aria-hidden="true">${a.kind==='best'?'🏆':'🌧️'}</span><div><p class="profile-win-date">${esc(date(a.date))}</p><h3>${a.kind==='best'?'Meu melhor da semana':'Meu pior da semana'}</h3><p class="profile-win-story">${esc(a.description||'O relato desta conquista não foi registrado no histórico.')}</p></div></article>`).join('');
 const live=room&&!['closed','completed'].includes(room.phase);
 document.getElementById('room-profile').innerHTML=`<section class="profile-hero room-card"><div class="profile-cover"><span aria-hidden="true">✦</span><span>UMA SEMANA DE CADA VEZ</span><span aria-hidden="true">✧</span></div><div class="profile-identity"><div class="profile-portrait">${photo(profile.photoUrl)||`<span aria-label="Iniciais de ${esc(profile.name||user.name)}">${esc(initials)}</span>`}</div><div><p class="room-eyebrow">MEU CANTINHO NA AMPLIFY</p><h1>${esc(profile.name||user.name)}</h1><p>Minhas metas, minhas histórias e os momentos que fizeram a semana. ✨</p></div></div><div class="profile-stats"><div><strong>🏆 ${Number(profile.bestWins)||0}</strong><span>melhor da semana</span></div><div><strong>🌱 Toda semana</strong><span>uma nova chance</span></div></div></section><section class="profile-room-invite room-card"><div><p class="room-eyebrow">${live?'🟢 ENCONTRO ABERTO':'💬 NOSSO ENCONTRO'}</p><h2>${live?'A sala da semana está aberta!':'Ainda não iniciamos'}</h2><p>${live?'Veja em que etapa estamos e participe com o seu perfil.':'A sala ainda não foi aberta pelo administrador.'}</p></div>${!live?`<div class="meeting-notice" data-meeting-notice>${meetingNotice(Date.now()+offset)}</div>`:''}${live?`<button data-profile-view="room">${live?'Ir para a sala →':'Ver sala da semana →'}</button>`:''}</section><section class="profile-goals"><div class="profile-section-title"><h2>🎯 Minhas metas</h2><p class="profile-membership">${profile.goalsActive?'🟢 Metas ativas · formulário preenchido':'🟠 Metas não ativas · preencha o formulário para ativar'}</p>${!profile.goalsActive&&profile.goalsFormUrl?`<a class="profile-form-link" href="${esc(profile.goalsFormUrl)}" target="_blank" rel="noopener noreferrer">📝 Preencher minhas metas →</a>`:''}<p>Pequenos passos. Uma semana com mais intenção.</p></div><div class="profile-goal-grid">${goals.map(([k,emoji,label])=>`<article class="profile-goal profile-goal-${k}"><span class="profile-goal-emoji" aria-hidden="true">${emoji}</span><h3>${label}</h3><p>${esc(profile.objectives?.[k]||'Sua meta ainda não foi definida. Combine com o administrador. 🌱')}</p></article>`).join('')}</div></section><section class="room-card"><h2>🔐 Meu login e senha</h2><p>Você só altera seu próprio acesso. O administrador acompanha seu login e a data da alteração.</p><form id="self-access"><label>Meu login<input name="username" value="${esc(user.username||'')}" required maxlength="80" autocomplete="username"></label><label>Senha atual<input name="currentPassword" type="password" required maxlength="200" autocomplete="current-password"></label><label>Nova senha<input name="password" type="password" minlength="8" maxlength="200" autocomplete="new-password" placeholder="Deixe vazio para manter a atual"></label><button>💾 Salvar meu acesso</button><p role="status" id="self-access-feedback"></p></form></section><section class="room-card profile-achievements"><p class="room-eyebrow">MEUS MOMENTOS DE DESTAQUE</p><h2>🏆 Meu mural de conquistas</h2><p>Cada vitória tem uma história. Essas são as minhas.</p>${best.length?stories(best):'<div class="profile-empty"><span aria-hidden="true">✨</span><h3>Seu próximo grande momento vem aí</h3><p>Quando você ganhar o melhor da semana, a data e o relato vão aparecer aqui.</p></div>'}${Number(profile.bestWins)>best.length?'<p>Você também tem conquistas anteriores sem relato disponível no histórico.</p>':''}${worst.length?`<details class="profile-challenges"><summary>🌧️ Histórias que a gente também compartilhou · ${worst.length}</summary><p>Os desafios fazem parte da caminhada.</p>${stories(worst)}</details>`:''}</section>`;
 const access=document.getElementById('self-access');
 access.onsubmit=async e=>{e.preventDefault();const b=access.querySelector('button');b.disabled=true;const feedback=document.getElementById('self-access-feedback');feedback.textContent='Salvando…';try{const f=new FormData(access);await api('auth',{action:'self-access',username:f.get('username'),currentPassword:f.get('currentPassword'),password:f.get('password')});feedback.textContent='Acesso atualizado. Entre novamente com seus dados.';access.reset();setTimeout(()=>location.reload(),1500);}catch(e){feedback.textContent=e.message;b.disabled=false;}};
}

async function api(endpoint, body) {
  const res = await fetch('/api/melhores/' + endpoint, { method: body ? 'POST' : 'GET', credentials: 'same-origin', headers: body ? {'Content-Type':'application/json'} : {}, ...(body ? {body: JSON.stringify(body)} : {}) });
  const data = await res.json();
  if (res.status === 401 && endpoint !== 'auth') { location.reload(); throw new Error('Sua sessão expirou.'); }
  if (!res.ok || !data.ok) throw new Error(data.error || 'Não foi possível concluir.');
  return data;
}
function error(message) { const e = document.getElementById('room-error'); if(e) e.textContent = message; }
function login() {
  root.innerHTML = `<main class="room-page"><section class="room-card room-login"><p class="room-eyebrow">AMPLIFY · SEXTA-FEIRA</p><h1>Best of the week</h1><p>Uma semana. Suas histórias. Nosso encontro.</p><form id="room-login"><label>Login<input name="username" autocomplete="username" required maxlength="100"></label><label>Senha<input name="password" type="password" autocomplete="current-password" required maxlength="200"></label><button>Entrar</button></form><p id="room-error" role="alert"></p></section></main>`;
  document.getElementById('room-login').onsubmit = async e => {
    e.preventDefault(); const button = e.target.querySelector('button'); button.disabled = true; error('');
    try { const f = new FormData(e.target); const result = await api('auth',{username:f.get('username'),password:f.get('password')}); user=result.user; await shell(); }
    catch(e) { error(e.message); button.disabled=false; }
  };
}
async function shell() {
  window.melhoresUser = user;
  appearance.load(user);
  currentView=user.role==='admin'?'room':'profile';
  root.innerHTML = `<main class="room-page"><header class="room-header"><div><p class="room-eyebrow">AMPLIFY · BEST OF THE WEEK</p><p class="profile-brand">Best of the week ✨</p></div><nav><button id="room-logout" class="secondary">Sair</button></nav></header><p id="room-error" role="alert"></p><nav class="profile-tabs" aria-label="Minha área"><button data-profile-view="profile">👤 Meu perfil</button><button data-profile-view="room">💬 Sala da semana</button>${user.role==='admin'?'<button id="room-admin" data-profile-view="admin">⚙️ Administrador</button>':''}</nav><section id="room-profile"></section><section id="room-content"></section>${user.role==='admin'?'<section id="admin-panel" hidden></section>':''}</main>`;
  document.getElementById('room-logout').onclick = async () => {
    try { await save(false); await api('auth',{action:'logout'}); for(const k of Object.keys(localStorage)) if(k.startsWith('amplify_melhores')) localStorage.removeItem(k); location.reload(); } catch(e) {error(e.message);}
  };
  root.addEventListener('click', async e => {
    const viewButton=e.target.closest('[data-profile-view]');if(viewButton){
      const view=viewButton.dataset.profileView;changeView(view);
      if(view==='admin'&&user.role==='admin'&&!adminLoaded){
        viewButton.disabled=true;
        try{const {openAdminPanel}=await import('./admin.js');await openAdminPanel(document.getElementById('admin-panel'),api);adminLoaded=true;}
        catch(e){error(e.message);}finally{viewButton.disabled=false;changeView(currentView);}
      }
      return;
    }
    const b=e.target.closest('[data-room-action]');if(!b)return;
    b.disabled=true;error('');
    try {
      if(b.dataset.roomAction==='present' && !confirm('Encerrar a escrita e começar a apresentação? Os participantes não poderão mais editar.'))return;
      if(b.dataset.roomAction==='close' && !confirm('Encerrar esta sala? Os relatos serão preservados.'))return;
      let gymrats;
      if(b.dataset.roomAction==='mark'&&b.dataset.category==='exercicio'&&b.dataset.result==='done')gymrats=await confirmGymrats();
      await save(false);
      state=await api('room',{action:b.dataset.roomAction, roomId:state?.room?.id, ...(b.dataset.seconds?{seconds:Number(b.dataset.seconds)}:{}),target:b.dataset.target,category:b.dataset.category,result:b.dataset.result,...(gymrats!==undefined?{gymrats}:{})});
      render();
      if(b.dataset.roomAction==='close' && adminLoaded) location.reload();
    }catch(e){error(e.message);}finally{b.disabled=false;}
  });
  await poll();setInterval(poll,2500);setInterval(tick,250);
}
function choice(action,label,attrs={}) { return `<button data-room-action="${action}" ${Object.entries(attrs).map(([k,v])=>`data-${k}="${esc(v)}"`).join(' ')}>${esc(label)}</button>`; }
function button(action,label,seconds='') { return `<button data-room-action="${action}" ${seconds?`data-seconds="${seconds}"`:''}>${label}</button>`; }
function confirmGymrats(){
 return new Promise(resolve=>{const overlay=document.createElement('div');overlay.className='gymrats-overlay';overlay.innerHTML='<section role="dialog" aria-modal="true" aria-labelledby="gymrats-title"><span class="gymrats-mouse">🐭</span><h2 id="gymrats-title">Está no GymRats?</h2><p>O exercício só vale ponto com registro no GymRats.</p><div><button data-gymrats="yes">⭐ Sim, está registrado</button><button data-gymrats="no">💩 Não está registrado</button></div></section>';document.body.append(overlay);overlay.querySelectorAll('button').forEach(b=>b.onclick=()=>{overlay.remove();resolve(b.dataset.gymrats==='yes');});overlay.querySelector('button').focus();});
}
async function poll(){
  if(polling)return;polling=true;
  try{state=await api('room');
    const next=state.room,finished=r=>r&&['completed','closed'].includes(r.phase);
    if(next?.id===previousRoom?.id&&!finished(previousRoom)&&finished(next)&&currentView==='room'&&previousRoom.members?.some(m=>m.id===user.id&&m.online)&&next.members?.some(m=>m.id===user.id))endingRoom=next.id;
    previousRoom=next;
    offset=state.serverTime-Date.now();render();}catch(e){error(e.message);}finally{polling=false;}
}
function render(){
  meetingSound.update(state.room,!!state.room?.members.some(m=>m.id===user.id)&&(!['completed','closed'].includes(state.room.phase)||endingRoom===state.room.id));
  const room=state.room,admin=user.role==='admin'&&(!room?.administrator||room.administrator.id===user.id),host=esc(room?.administrator?.name||'Administrador'),content=document.getElementById('room-content');
  const key=(room?.id||'none')+':'+(room?.phase||'none')+':'+!!room?.members.some(m=>m.id===user.id);
  if(layout!==key){
    // Keep an unsent local copy if the host changes phases while someone is typing.
    if(dirty && roomId) sessionStorage.setItem('melhores-unsent-'+roomId,JSON.stringify({best:document.getElementById('room-best')?.value||'',worst:document.getElementById('room-worst')?.value||''}));
    layout=key; roomId=room?.id;dirty=false;clearTimeout(timer);
    content.innerHTML=`<section class="room-card"><div id="room-status"></div><div id="room-controls" class="room-controls"></div></section><div class="room-columns"><section class="room-card"><h2>Na sala</h2><ul id="room-members"></ul></section><section class="room-card" id="room-stage"></section></div>`;
    const stage=document.getElementById('room-stage');
    const joined=room?.members.some(m=>m.id===user.id);
    if(room?.phase==='writing'&&joined){
      const mine=room.members.find(m=>m.id===user.id).draft||{};draftRevision=mine.revision||0;
      stage.innerHTML=`${photo(state.profile?.photoUrl)}<h2>Como foi sua semana?</h2><p>Seus relatos só serão revelados na apresentação.</p><form id="room-draft"><label>O melhor da minha semana<textarea id="room-best" maxlength="4000" rows="5" placeholder="Conte seu melhor momento…"></textarea></label><label>O pior da minha semana<textarea id="room-worst" maxlength="4000" rows="5" placeholder="Conte seu maior desafio…"></textarea></label><button id="room-done">Terminei</button><p id="room-save" role="status"></p></form>`;
      document.getElementById('room-best').value=mine.best||'';document.getElementById('room-worst').value=mine.worst||'';
      document.getElementById('room-save').textContent=mine.done?'Concluído. Você ainda pode editar.':'Rascunhos são salvos automaticamente.';
      stage.querySelector('form').oninput=()=>{dirty=true;document.getElementById('room-save').textContent='Salvando…';clearTimeout(timer);timer=setTimeout(()=>save(false).catch(e=>error(e.message)),650);};
      stage.querySelector('form').onsubmit=async e=>{e.preventDefault();const b=document.getElementById('room-done');b.disabled=true;try{await save(true);await poll();}catch(e){error(e.message);}finally{b.disabled=false;}};
    }
  }
  const joined=room?.members.some(m=>m.id===user.id);
  document.getElementById('room-status').innerHTML = !room?`<p class="room-eyebrow">📅 THE BEST · NOSSO ENCONTRO</p><h2>Ainda não iniciamos</h2><div class="meeting-notice" data-meeting-notice>${meetingNotice(Date.now()+offset)}</div><p>A sala ainda não foi criada. Aguarde o administrador abrir o encontro.</p>`:room.phase==='waiting'?`<p class="room-eyebrow">💬 NOSSO PONTO DE ENCONTRO</p><h2>Chegou a hora de compartilhar ✨</h2><p>Entre, se acomode e aguarde ${host} iniciar os 5 minutos. Cada história tem seu espaço por aqui. 🌱</p>`:room.phase==='writing'?'<p class="room-eyebrow">HORA DE ESCREVER</p><div id="room-clock" class="room-clock" role="timer"></div><p id="room-clock-hint"></p>':room.phase==='presenting'?'<p class="room-eyebrow">VAMOS OUVIR</p><h2>Uma história de cada vez</h2><p>Sem pressa: a apresentação não tem cronômetro.</p>':'<h2>Encontro encerrado</h2><p>Os relatos foram preservados. Até a próxima semana!</p>';
  document.getElementById('room-controls').innerHTML=(!room||room.phase==='closed')?(admin?button('create','Criar sala da semana'):''): (room.phase==='waiting'?(!joined?button('join','Entrar na sala'):'<span>Você está na sala ✓</span>')+(admin?button('start','Iniciar os 5 minutos'):''):'')+(admin?(room.phase==='writing'?button('extend','+1 minuto',60)+button('extend','+5 minutos',300)+button('present','Iniciar apresentação'):'')+(room.phase==='presenting'?(room.presentationFact!=='worst'?button('show-worst','🌧️ Mostrar o pior fato →'):room.current<room.members.length-1?button('next','Próxima pessoa →'):button('vote-best','🗳️ Abrir votação do melhor')):'')+button('close','Encerrar sala'):'');
  document.getElementById('room-members').innerHTML=(room?.members||[]).map(m=>`<li>${avatar(m.photoUrl,m.name)}<span>${esc(m.name)}</span><small>${!m.online?'Desconectado':m.done?'Na sala · ✓ Terminou':room.phase==='writing'?'Na sala · Escrevendo…':'Na sala'}</small></li>`).join('')||'<li>Ninguém entrou ainda.</li>';
  const stage=document.getElementById('room-stage');
  stage.closest('.room-columns').hidden=!room;
  stage.closest('.room-columns').classList.toggle('goals-layout',room?.phase==='goals');
  const labels={exercicio:'💪 Exercício físico',familia:'👨‍👩‍👧‍👦 Família',alimentacao:'🥗 Alimentação',hobbies:'🎨 Hobbies',conhecimentos:'📚 Conhecimentos'};
  if(room?.phase==='presenting' && room.members.filter(m=>m.online).length<2) document.getElementById('room-controls').insertAdjacentHTML('beforeend','<p class="vote-empty-note" role="status">👥 Para abrir a votação, pelo menos duas pessoas precisam estar conectadas. Ninguém pode votar em si mesmo.</p>');
  if(room && /^(voting|tie|result)-/.test(room.phase)) {
    const kind=room.phase.endsWith('-best')?'best':'worst',field=kind==='best'?'best':'worst',title=kind==='best'?'melhor':'pior';
    document.getElementById('room-status').innerHTML=`<h2>Votação do ${title} da semana</h2><p>Ninguém pode votar em si mesmo.</p>`;
    const result=room.results?.[kind];
    const isVoting=room.phase.startsWith('voting-');
    const portraits=m=>{const parts=m.name.trim().split(/\s+/);const initials=(parts.length>1?parts.slice(0,2).map(n=>n[0]).join(''):parts[0].slice(0,2)).toUpperCase();return `<div class="vote-avatar">${photo(m.photoUrl)||`<span>${esc(initials)}</span>`}</div>`;};
    const voteButton=m=>m.id===user.id?'<button disabled class="vote-self">Seu perfil · voto próprio bloqueado</button>':room.voted?'<button disabled>Voto já registrado ✓</button>':room.electorate.includes(user.id)?choice('vote','Votar em '+m.name,{target:m.id}):'';
    stage.innerHTML=`<section class="vote-overlay" role="dialog" aria-modal="true" aria-labelledby="vote-heading"><div class="vote-dialog"><header><p class="room-eyebrow">🗳️ HORA DE ESCOLHER</p><h1 id="vote-heading" tabindex="-1">Votação do ${title} fato da semana</h1><p>${isVoting?'Leia os relatos e escolha uma pessoa. Ninguém pode votar em si mesmo.':'Confira o resultado desta rodada.'}</p>${isVoting?`<p class="vote-progress">${room.voteCount} de ${room.electorate.length} votos recebidos ${room.voted?'· Seu voto foi registrado ✓':''}</p>`:''}</header>${isVoting&&room.members.length<2?'<p class="vote-empty-note" role="status">👥 Para votar, precisamos de pelo menos duas pessoas na sala. Ninguém pode votar em si mesmo. Este teste sozinho não permite registrar voto.</p>':''}<div class="vote-candidates">${room.members.map(m=>`<article class="vote-candidate ${m.id===user.id?'is-me':''}">${portraits(m)}<h2>${esc(m.name)}${m.id===user.id?' <small>(você)</small>':''}</h2><p class="vote-story">${esc(m.draft?.[field]||'Relato não preenchido.')}</p>${isVoting?voteButton(m):`<p>${result.counts[m.id]} voto(s)</p>`}${room.phase.startsWith('tie-')&&admin&&result.tied.includes(m.id)?choice('resolve','Escolher '+m.name,{target:m.id}):''}</article>`).join('')}</div>${room.phase.startsWith('tie-')?'<h2>Empate · aguardando decisão do administrador</h2>':''}${room.phase.startsWith('result-')?`<h2 class="vote-winner">🏆 ${esc(room.members.find(m=>m.id===result.winner)?.name)} · +1 ponto</h2>${admin?kind==='best'?button('vote-worst','Continuar: votação do pior fato →'):button('goals','Continuar: metas pessoais →'):'<p>Aguarde o administrador iniciar a próxima etapa.</p>'}`:''}</div></section>`;
    if(room.phase.startsWith('result-')){
      const winner=room.members.find(m=>m.id===result.winner);
      stage.innerHTML=`<section class="vote-overlay winner-overlay" role="dialog" aria-modal="true" aria-labelledby="vote-heading"><div class="winner-card"><span class="winner-confetti" aria-hidden="true">✨ 🎊 ✨</span><p class="room-eyebrow">${kind==='best'?'☀️ MELHOR':'🌧️ PIOR'} FATO DA SEMANA</p>${portraits(winner)}<h1 id="vote-heading" tabindex="-1">${esc(winner.name)}</h1><p class="winner-award">🏆 Ganhou o ${title} fato da semana!</p><p class="winner-point">⭐ +1 ponto</p><blockquote>${esc(winner.draft?.[field]||'Relato não registrado.')}</blockquote><p>Uma história que marcou nosso encontro. 💜</p>${admin?kind==='best'?button('vote-worst','Continuar: votação do pior fato →'):button('goals','Continuar: metas pessoais →'):`<p>Aguarde ${host} continuar.</p>`}</div></section>`;
    }
    const votePhase=room.id+':'+room.phase;
    if(lastVotePhase!==votePhase&&joined){currentView='room';lastVotePhase=votePhase;requestAnimationFrame(()=>document.getElementById('vote-heading')?.focus());}
  }else if(room?.phase==='goals'){
    const person=room.members[room.current],marked=room.goalResults?.[person.id]||{};
    const goalLabels={exercicio:['💪','Exercício físico'],familia:['👨‍👩‍👧‍👦','Família'],alimentacao:['🥗','Alimentação'],hobbies:['🎨','Hobbies'],conhecimentos:['📚','Conhecimentos']};
    const parts=person.name.trim().split(/\s+/),initials=(parts.length>1?parts.slice(0,2).map(n=>n[0]).join(''):parts[0].slice(0,2)).toUpperCase();
    const done=Object.keys(marked).length;
    document.getElementById('room-status').innerHTML=`<p class="room-eyebrow">🎯 METAS PESSOAIS · HORA DE CONVERSAR</p><h2>${host} conduz. Você conta. ✨</h2><p>${host} vai chamar cada pessoa, perguntar sobre as cinco metas e marcar os resultados. Há um único administrador por sessão. Quem estiver na vez responde <strong>“sim” ou “não”</strong>; o restante do time acompanha. 👂</p>`;
    stage.innerHTML=`<section class="goals-person"><div class="goals-person-avatar">${photo(person.photoUrl)||`<span>${esc(initials)}</span>`}</div><div><p class="room-eyebrow">🎤 É A VEZ DE · ${room.current+1} DE ${room.members.length}</p><h2>${esc(person.name)}</h2><p>${person.id===user.id?`Sua vez! Responda às perguntas de ${host}. 💬`:'Vamos ouvir '+esc(person.name)+'. Cada meta, uma resposta. 💬'}</p></div><span class="goals-count">${done}/5 avaliadas</span></section><div class="goals-how"><span>🎙️ <strong>${host} pergunta</strong></span><span>💬 <strong>A pessoa responde sim ou não</strong></span><span>✍️ <strong>Só ${host} marca</strong></span></div>${!person.online?'<p class="goals-offline">🌙 Sem sinal recente. Após 60 segundos sem conexão, metas ainda não avaliadas recebem ausência automaticamente: −1 por meta.</p>':''}<div class="live-goals-grid">${Object.entries(goalLabels).map(([key,[emoji,label]])=>`<article class="live-goal live-goal-${key} ${marked[key]?'has-result result-'+marked[key]:''}"><div class="live-goal-header"><span class="live-goal-emoji" aria-hidden="true">${emoji}</span><h3>${label}</h3></div><p class="live-goal-text">${esc(person.objectives?.[key]||'Meta ainda não preenchida. 🌱')}</p><p class="live-goal-result">${({done:'⭐ Cumpriu · +1 ponto',missed:'💩 Não cumpriu · 0 ponto',absent:'🌙 Ausente · −1 ponto'})[marked[key]]||`⏳ Aguardando a pergunta de ${host}`}</p>${admin&&person.online?`<div class="live-goal-actions">${[['done','⭐ Sim, cumpriu'],['missed','💩 Não cumpriu'],...[]].map(([result,text])=>`<button data-room-action="mark" data-target="${esc(person.id)}" data-category="${key}" data-result="${result}" class="goal-answer goal-answer-${result}" aria-pressed="${marked[key]===result}">${text}</button>`).join('')}</div>`:`<p class="live-goal-observer">👀 Acompanhe por aqui. Somente ${host}, administrador desta sessão, marca os resultados ao vivo.</p>`}</article>`).join('')}</div><footer class="goals-footer"><p>${admin?'📝 Marque as cinco metas para avançar.':`🙌 Você não precisa clicar em nada. Responda quando ${host} chamar.`}</p>${admin?choice('next-goal',room.current===room.members.length-1?'✨ Concluir metas':'Próxima pessoa →',{target:person.id}):''}</footer>`;
  }else if(room&&['completed','closed'].includes(room.phase)&&endingRoom===room.id){
    const complete=room.phase==='completed'||room.completedAt;
    document.getElementById('room-status').innerHTML='';document.getElementById('room-controls').innerHTML='';
    stage.innerHTML=`<section class="meeting-ending" role="dialog" aria-modal="true" aria-labelledby="ending-title"><div class="ending-card"><span class="ending-emoji">🌅 ✨</span><p class="room-eyebrow">NOSSO ENCONTRO CHEGOU AO FIM</p><h1 id="ending-title" tabindex="-1">É isso!<br>Tenha um bom final de semana!</h1><p>${complete?'Metas concluídas, histórias compartilhadas e pontos registrados.':'A sala foi encerrada. Seus relatos foram preservados.'}</p><p>Descanse, aproveite e até o próximo encontro. 💙</p><div class="ending-actions"><button data-profile-view="profile">👤 Ir para meu perfil</button>${admin?'<button data-profile-view="admin">🏆 Administrador e rankings</button>'+button('create','✨ Criar próxima sala'):''}</div></div></section>`;
    if(lastEnding!==room.id){lastEnding=room.id;if(joined)currentView='room';requestAnimationFrame(()=>document.getElementById('ending-title')?.focus());}
  }else if(room&&['completed','closed'].includes(room.phase)){
    stage.innerHTML='<p>O encontro já terminou. Até a próxima semana! 💙</p>';
    document.getElementById('room-controls').innerHTML=admin?button('create','✨ Criar próxima sala'):'';
  }else if(room?.phase==='presenting'){
    const person=room.members[room.current];
    const fact=room.presentationFact==='worst'?'worst':'best';
    stage.innerHTML=person?`<section class="story-presentation ${fact}"><p class="room-eyebrow">🎙️ ${room.current+1} DE ${room.members.length} · VAMOS OUVIR</p><div class="story-person">${avatar(person.photoUrl,person.name)}<h2>${esc(person.name)}</h2></div><span class="story-emoji">${fact==='best'?'☀️':'🌧️'}</span><h1>${fact==='best'?'O melhor':'O pior'} fato da semana</h1><p class="room-story">${esc(person.draft?.[fact]||'Não preenchido.')}</p><p>${host} conduz. ${esc(person.name)} conta sua história. 💬</p></section>`:'<p>Nenhum participante.</p>';
  }else if(room?.phase!=='writing'||!joined){
    stage.innerHTML=`<section class="waiting-goals"><p class="room-eyebrow">🌱 MINHA SEMANA COMEÇA AQUI</p><h2>Suas metas vão com você ✨</h2><p>${host} conduz o encontro. Enquanto isso, relembre seus pequenos grandes passos.</p><div class="live-goals-grid">${Object.entries(labels).map(([key,label])=>`<article class="live-goal live-goal-${key}"><h3 class="waiting-goal-title">${label}</h3><p class="live-goal-text">${esc(state.profile?.objectives?.[key]||'Meta aguardando preenchimento do formulário. 🌱')}</p></article>`).join('')}</div><p>🎙️ Escrita → 💬 Histórias → 🗳️ Votações → 🎯 Metas</p></section>`;
  }
  if(roomId&&sessionStorage.getItem('melhores-unsent-'+roomId)&&room?.phase!=='writing'&&!document.getElementById('room-recovery')){
    const box=document.createElement('section');box.id='room-recovery';box.className='room-card';const unsent=JSON.parse(sessionStorage.getItem('melhores-unsent-'+roomId));box.innerHTML='<h2>Texto local não confirmado</h2><p>A escrita foi encerrada antes da confirmação do salvamento. Copie seu relato e avise o administrador.</p><p class="room-story">'+esc(unsent.best)+'\n\n'+esc(unsent.worst)+'</p>';content.append(box);
  }
  renderProfile();changeView(currentView);
  tick();
}
async function save(done){
  const best=document.getElementById('room-best'),worst=document.getElementById('room-worst');
  if(!best||(!dirty&&!done))return saving;
  clearTimeout(timer);
  const payload={action:'save',roomId,best:best.value,worst:worst.value,done,revision:Math.max(Date.now(),draftRevision+1)};
  draftRevision=payload.revision;
  const task=saving.catch(()=>{}).then(()=>api('room',payload));saving=task;
  try{
    await task;
    if(best.value===payload.best&&worst.value===payload.worst){dirty=false;sessionStorage.removeItem('melhores-unsent-'+payload.roomId);const label=document.getElementById('room-save');if(label)label.textContent=done?'Concluído ✓ Você ainda pode editar.':'Rascunho salvo ✓';}
  }catch(e){sessionStorage.setItem('melhores-unsent-'+payload.roomId,JSON.stringify(payload));error('Texto ainda não salvo: '+e.message);throw e;}
}
function tick(){
  document.querySelectorAll('[data-meeting-notice]').forEach(el=>el.innerHTML=meetingNotice(Date.now()+offset));
  const clock=document.getElementById('room-clock');if(!clock||!state?.room?.deadline)return;
  const seconds=Math.max(0,Math.ceil((state.room.deadline-Date.now()-offset)/1000));
  clock.textContent=`${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`;
  clock.classList.toggle('urgent',seconds<=60);clock.classList.toggle('expired',seconds===0);
  document.getElementById('room-clock-hint').textContent=seconds===0?'Tempo esgotado! Continue escrevendo; o administrador pode prolongar.':seconds<=60?'Reta final! Organize seu melhor e seu pior momento.':'Você tem 5 minutos para contar o melhor e o pior da semana.';
}
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
async function initialize(){try{const auth=await api('auth');user=auth.user;if(user)await shell();else login();}catch(e){login();error(e.message);}}
initialize();
