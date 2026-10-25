export function setupChatResize(chat,userId){
 const panel=chat.querySelector('#chat-panel');
 const handle=document.createElement('button');handle.type='button';handle.className='chat-resize-handle';handle.textContent='⤡';handle.setAttribute('aria-label','Redimensionar chat');handle.title='Arraste para ajustar. Setas ajustam pelo teclado; Home restaura.';panel.prepend(handle);
 const key='melhores_chat_size_'+userId;
 let preferred={width:360,height:560},drag;
 try{const saved=JSON.parse(localStorage.getItem(key));if(Number.isFinite(saved?.width)&&Number.isFinite(saved?.height))preferred=saved;}catch{}
 function apply(){
  const bottom=parseFloat(getComputedStyle(chat).bottom)||16;
  const maxWidth=Math.max(180,innerWidth-32),maxHeight=Math.max(180,innerHeight-bottom-24);
  const width=Math.min(maxWidth,Math.max(Math.min(280,maxWidth),preferred.width));
  const height=Math.min(maxHeight,Math.max(Math.min(340,maxHeight),preferred.height));
  chat.style.width=width+'px';panel.style.height=height+'px';
 }
 function save(){try{localStorage.setItem(key,JSON.stringify(preferred));}catch{}}
 handle.onpointerdown=event=>{if(event.button!==0)return;event.preventDefault();drag={x:event.clientX,y:event.clientY,width:chat.getBoundingClientRect().width,height:panel.getBoundingClientRect().height};handle.setPointerCapture(event.pointerId);};
 handle.onpointermove=event=>{if(!drag)return;preferred={width:Math.max(280,Math.min(innerWidth-32,drag.width+drag.x-event.clientX)),height:Math.max(340,Math.min(innerHeight-96,drag.height+drag.y-event.clientY))};apply();};
 const end=()=>{if(drag){drag=null;save();}};
 handle.onpointerup=end;handle.onpointercancel=end;handle.onlostpointercapture=end;
 handle.onkeydown=event=>{
  const step=event.shiftKey?40:16;
  if(event.key==='Home')preferred={width:360,height:560};
  else if(event.key==='ArrowLeft')preferred.width+=step;
  else if(event.key==='ArrowRight')preferred.width-=step;
  else if(event.key==='ArrowUp')preferred.height+=step;
  else if(event.key==='ArrowDown')preferred.height-=step;
  else return;
  event.preventDefault();apply();save();
 };
 window.addEventListener('resize',apply);apply();
}
