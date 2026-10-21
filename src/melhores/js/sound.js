// Original synthesized cues: no external audio files or tracking.
export function createMeetingSound(container) {
  let context,enabled=true,lastEvent='',active=[];
  try { enabled=localStorage.getItem('melhores_sound')!=='off'; } catch {}
  const toggle=document.createElement('button');
  toggle.type='button';toggle.className='sound-toggle';container.append(toggle);
  function label(){toggle.textContent=enabled?'🔊 Som ligado':'🔇 Som desligado';toggle.setAttribute('aria-pressed',String(enabled));toggle.title='Ligar ou silenciar efeitos e música';}
  function stop(){for(const node of active){try{node.stop();}catch{}}active=[];}
  function unlock(){if(!enabled)return;try{context ||= new (window.AudioContext||window.webkitAudioContext)();if(context.state==='suspended')context.resume().catch(()=>{});}catch{}}
  function notes(sequence,type='sine',volume=.055){
    if(!enabled||document.hidden||!context||context.state!=='running')return;
    const start=context.currentTime+.015;
    active=active.filter(node=>!node.finished);
    for(const [hz,offset,duration] of sequence){
      const oscillator=context.createOscillator(),gain=context.createGain();
      oscillator.type=type;oscillator.frequency.value=hz;
      gain.gain.setValueAtTime(0,start+offset);gain.gain.linearRampToValueAtTime(volume,start+offset+.012);gain.gain.exponentialRampToValueAtTime(.0001,start+offset+duration);
      oscillator.connect(gain);gain.connect(context.destination);oscillator.start(start+offset);oscillator.stop(start+offset+duration+.02);
      oscillator.onended=()=>{oscillator.finished=true;oscillator.disconnect();gain.disconnect();};active.push(oscillator);
    }
  }
  const best=[[523,0,.16],[659,.13,.16],[784,.26,.2],[1047,.45,.55]];
  const worst=[[392,0,.2],[330,.18,.2],[262,.36,.2],[392,.58,.42]];
  const melody=[523,659,784,659,587,698,880,698,659,784,1047,988,880,784,659,523];
  const ending=melody.map((hz,i)=>[hz,i*.3,.38]);
  for(let i=0;i<4;i++)for(const hz of [131,165,196])ending.push([hz,i*1.2,1.15]);
  function celebrate(kind){stop();notes(kind==='best'?best:kind==='worst'?worst:ending,'sine',kind==='ending'?.035:.06);}
  toggle.onclick=()=>{enabled=!enabled;try{localStorage.setItem('melhores_sound',enabled?'on':'off');}catch{}label();if(enabled){unlock();notes([[659,0,.12],[880,.1,.18]]);}else stop();};
  document.addEventListener('pointerdown',unlock,{capture:true});
  document.addEventListener('keydown',unlock,{capture:true});
  document.addEventListener('click',e=>{const button=e.target.closest('button');if(!button||button===toggle||button.disabled||!button.closest('#weekly-room'))return;unlock();notes([[660,0,.055],[880,.04,.075]],'sine',.025);});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
  label();
  return {update(room,joined){const phase=room?.phase||'',event=phase==='result-best'?'best':phase==='result-worst'?'worst':phase==='completed'||phase==='closed'?'ending':'';const key=event?`${room.id}:${event}`:'';if(key===lastEvent)return;stop();lastEvent=key;if(event&&joined)celebrate(event);},stop};
}
