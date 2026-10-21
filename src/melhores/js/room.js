import '../css/room.css';
const root = document.getElementById('weekly-room');
const photo = url => { try { return new URL(url).protocol === 'https:' ? `<img class="room-avatar" src="${esc(url)}" alt="" referrerpolicy="no-referrer">` : ''; } catch { return ''; } };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let user, state, layout, roomId, offset = 0, dirty = false, timer, polling = false, saving = Promise.resolve(), adminLoaded = false;
let draftRevision = 0;
let currentView='profile',profileLayout='';
function changeView(view){
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
 const live=room&&room.phase!=='closed';
 document.getElementById('room-profile').innerHTML=`<section class="profile-hero room-card"><div class="profile-cover"><span aria-hidden="true">✦</span><span>UMA SEMANA DE CADA VEZ</span><span aria-hidden="true">✧</span></div><div class="profile-identity"><div class="profile-portrait">${photo(profile.photoUrl)||`<span aria-label="Iniciais de ${esc(profile.name||user.name)}">${esc(initials)}</span>`}</div><div><p class="room-eyebrow">MEU CANTINHO NA AMPLIFY</p><h1>${esc(profile.name||user.name)}</h1><p>Minhas metas, minhas histórias e os momentos que fizeram a semana. ✨</p></div></div><div class="profile-stats"><div><strong>🏆 ${Number(profile.bestWins)||0}</strong><span>melhor da semana</span></div><div><strong>🎯 ${goals.filter(([k])=>String(profile.objectives?.[k]||'').trim()).length}/5</strong><span>metas definidas</span></div><div><strong>🌱 Toda semana</strong><span>uma nova chance</span></div></div></section><section class="profile-room-invite room-card"><div><p class="room-eyebrow">${live?'🟢 ENCONTRO ABERTO':'💬 NOSSO ENCONTRO'}</p><h2>${live?'A sala da semana está aberta!':'Sextou? Bora compartilhar.'}</h2><p>${live?'Veja em que etapa estamos e participe com o seu perfil.':'Quando a sala abrir, você entra por aqui. Suas metas já vão com você.'}</p></div><button data-profile-view="room">${live?'Ir para a sala →':'Ver sala da semana →'}</button></section><section class="profile-goals"><div class="profile-section-title"><h2>🎯 Minhas metas</h2><p>Pequenos passos. Uma semana com mais intenção.</p></div><div class="profile-goal-grid">${goals.map(([k,emoji,label])=>`<article class="profile-goal profile-goal-${k}"><span class="profile-goal-emoji" aria-hidden="true">${emoji}</span><h3>${label}</h3><p>${esc(profile.objectives?.[k]||'Sua meta ainda não foi definida. Combine com o administrador. 🌱')}</p></article>`).join('')}</div></section><section class="room-card profile-achievements"><p class="room-eyebrow">MEUS MOMENTOS DE DESTAQUE</p><h2>🏆 Meu mural de conquistas</h2><p>Cada vitória tem uma história. Essas são as minhas.</p>${best.length?stories(best):'<div class="profile-empty"><span aria-hidden="true">✨</span><h3>Seu próximo grande momento vem aí</h3><p>Quando você ganhar o melhor da semana, a data e o relato vão aparecer aqui.</p></div>'}${Number(profile.bestWins)>best.length?'<p>Você também tem conquistas anteriores sem relato disponível no histórico.</p>':''}${worst.length?`<details class="profile-challenges"><summary>🌧️ Histórias que a gente também compartilhou · ${worst.length}</summary><p>Os desafios fazem parte da caminhada.</p>${stories(worst)}</details>`:''}</section>`;
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
      await save(false);
      state=await api('room',{action:b.dataset.roomAction, roomId:state?.room?.id, ...(b.dataset.seconds?{seconds:Number(b.dataset.seconds)}:{}),target:b.dataset.target,category:b.dataset.category,result:b.dataset.result});
      render();
      if(b.dataset.roomAction==='close' && adminLoaded) location.reload();
    }catch(e){error(e.message);}finally{b.disabled=false;}
  });
  await poll();setInterval(poll,2500);setInterval(tick,250);
}
function choice(action,label,attrs={}) { return `<button data-room-action="${action}" ${Object.entries(attrs).map(([k,v])=>`data-${k}="${esc(v)}"`).join(' ')}>${esc(label)}</button>`; }
function button(action,label,seconds='') { return `<button data-room-action="${action}" ${seconds?`data-seconds="${seconds}"`:''}>${label}</button>`; }
async function poll(){
  if(polling)return;polling=true;
  try{state=await api('room'); offset=state.serverTime-Date.now();render();}catch(e){error(e.message);}finally{polling=false;}
}
function render(){
  const room=state.room,admin=user.role==='admin',content=document.getElementById('room-content');
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
  document.getElementById('room-status').innerHTML = !room?'<h2>A próxima história começa aqui</h2><p>Aguarde o administrador abrir a sala da semana.</p>':room.phase==='waiting'?'<p class="room-eyebrow">SALA DE ESPERA</p><h2>Chegou a hora de compartilhar</h2><p>Entre e aguarde o administrador iniciar os 5 minutos.</p>':room.phase==='writing'?'<p class="room-eyebrow">HORA DE ESCREVER</p><div id="room-clock" class="room-clock" role="timer"></div><p id="room-clock-hint"></p>':room.phase==='presenting'?'<p class="room-eyebrow">VAMOS OUVIR</p><h2>Uma história de cada vez</h2><p>Sem pressa: a apresentação não tem cronômetro.</p>':'<h2>Encontro encerrado</h2><p>Os relatos foram preservados. Até a próxima semana!</p>';
  document.getElementById('room-controls').innerHTML=(!room||room.phase==='closed')?(admin?button('create','Criar sala da semana'):''): (room.phase==='waiting'?(!joined?button('join','Entrar na sala'):'<span>Você está na sala ✓</span>')+(admin?button('start','Iniciar os 5 minutos'):''):'')+(admin?(room.phase==='writing'?button('extend','+1 minuto',60)+button('extend','+5 minutos',300)+button('present','Iniciar apresentação'):'')+(room.phase==='presenting'?(room.current<room.members.length-1?button('next','Próxima pessoa'):button('vote-best','Abrir votação do melhor')):'')+(room.phase==='result-best'?button('vote-worst','Abrir votação do pior'):'')+(room.phase==='result-worst'?button('goals','Iniciar metas pessoais'):'')+button('close','Encerrar sala'):'');
  document.getElementById('room-members').innerHTML=(room?.members||[]).map(m=>`<li>${photo(m.photoUrl)}<span>${esc(m.name)}</span><small>${!m.online?'Desconectado':m.done?'Na sala · ✓ Terminou':room.phase==='writing'?'Na sala · Escrevendo…':'Na sala'}</small></li>`).join('')||'<li>Ninguém entrou ainda.</li>';
  const stage=document.getElementById('room-stage');
  const labels={exercicio:'Exercício',familia:'Família',alimentacao:'Alimentação',hobbies:'Hobbies',conhecimentos:'Conhecimentos'};
  if(room && /^(voting|tie|result)-/.test(room.phase)) {
    const kind=room.phase.endsWith('-best')?'best':'worst',field=kind==='best'?'best':'worst',title=kind==='best'?'melhor':'pior';
    document.getElementById('room-status').innerHTML=`<h2>Votação do ${title} da semana</h2><p>Ninguém pode votar em si mesmo.</p>`;
    const result=room.results?.[kind];
    stage.innerHTML=room.phase.startsWith('voting-')?`<p>${room.voteCount} de ${room.electorate.length} votos recebidos. ${room.voted?'Seu voto foi registrado.':''}</p>`:'';
    stage.innerHTML+=room.members.map(m=>`<section><h3>${esc(m.name)}</h3><p class="room-story">${esc(m.draft?.[field]||'Não preenchido.')}</p>${room.phase.startsWith('voting-')&&!room.voted&&room.electorate.includes(user.id)&&m.id!==user.id?choice('vote','Votar em '+m.name,{target:m.id}):''}${result?`<p>${result.counts[m.id]} voto(s)</p>`:''}</section>`).join('');
    if(room.phase.startsWith('tie-')) stage.innerHTML+='<h3>Empate: aguardando decisão do administrador</h3>'+(admin?result.tied.map(id=>choice('resolve','Escolher '+room.members.find(m=>m.id===id).name,{target:id})).join(''):'');
    if(room.phase.startsWith('result-')) stage.innerHTML+=`<h3>Vencedor: ${esc(room.members.find(m=>m.id===result.winner)?.name)} · +1 ponto</h3>`;
  }else if(room?.phase==='goals'){
    const person=room.members[room.current],marked=room.goalResults?.[person.id]||{};
    document.getElementById('room-status').innerHTML=`<h2>É a vez de ${esc(person.name)}</h2><p>Somente o administrador marca os resultados.</p>`;
    stage.innerHTML=`<h2>${esc(person.name)}</h2>${!person.online?'<p>Desconectado — pode retornar com o mesmo login.</p>':''}`+Object.entries(labels).map(([key,label])=>`<section><h3>${label}</h3><p>${esc(person.objectives?.[key]||'Meta não preenchida.')}</p><p>${({done:'⭐ Cumpriu · +1',missed:'💩 Não cumpriu · 0',absent:'Ausente · −1'})[marked[key]]||'Aguardando avaliação'}</p>${admin?[['done','⭐ Cumpriu'],['missed','💩 Não cumpriu'],...(!person.online?[['absent','Ausente · −1']]:[])].map(([result,label])=>choice('mark',label,{target:person.id,category:key,result})).join(''):''}</section>`).join('')+(admin?button('next-goal',room.current===room.members.length-1?'Concluir metas':'Próxima pessoa'):'');
  }else if(room?.phase==='completed'){
    document.getElementById('room-status').innerHTML='<h2>Metas concluídas</h2><p>O administrador pode encerrar a sala para registrar a pontuação.</p>';
    stage.innerHTML='<p>Obrigado por participar!</p>';
  }else if(room?.phase==='presenting'){
    const person=room.members[room.current];
    stage.innerHTML=person?`<p class="room-eyebrow">${room.current+1} DE ${room.members.length}</p><h2>${esc(person.name)}</h2><h3>O melhor da semana</h3><p class="room-story">${esc(person.draft?.best||'Não preenchido.')}</p><h3>O pior da semana</h3><p class="room-story">${esc(person.draft?.worst||'Não preenchido.')}</p>`:'<p>Nenhum participante.</p>';
  }else if(room?.phase!=='writing'||!joined){
    stage.innerHTML=`<h2>Suas metas</h2>${state.profile?.objectives?'<ul>'+Object.entries(state.profile.objectives).map(([k,v])=>`<li><strong>${esc(({exercicio:'Exercício',familia:'Família',alimentacao:'Alimentação',hobbies:'Hobbies',conhecimentos:'Conhecimentos'})[k]||k)}:</strong> ${esc(v)}</li>`).join('')+'</ul>':'<p>O administrador conduz a rodada. Participe da sala para registrar seus relatos.</p>'}`;
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
  const clock=document.getElementById('room-clock');if(!clock||!state?.room?.deadline)return;
  const seconds=Math.max(0,Math.ceil((state.room.deadline-Date.now()-offset)/1000));
  clock.textContent=`${Math.floor(seconds/60).toString().padStart(2,'0')}:${(seconds%60).toString().padStart(2,'0')}`;
  clock.classList.toggle('urgent',seconds<=60);clock.classList.toggle('expired',seconds===0);
  document.getElementById('room-clock-hint').textContent=seconds===0?'Tempo esgotado! Continue escrevendo; o administrador pode prolongar.':seconds<=60?'Reta final! Organize seu melhor e seu pior momento.':'Você tem 5 minutos para contar o melhor e o pior da semana.';
}
window.addEventListener('beforeunload',e=>{if(dirty){e.preventDefault();e.returnValue='';}});
async function initialize(){try{const auth=await api('auth');user=auth.user;if(user)await shell();else login();}catch(e){login();error(e.message);}}
initialize();
