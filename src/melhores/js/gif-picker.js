const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const directGif = value => {
  try { const u=new URL(value);return u.protocol==='https:'&&['media.giphy.com','i.giphy.com','media.tenor.com'].includes(u.hostname)&&u.pathname.endsWith('.gif')&&!u.username&&!u.password&&!u.port; } catch {return false;}
};
const favorites=[['Comemorar','g9582DNuQppxC'],['Aplausos','l3q2XhfQ8oCkm1Ts4'],['Risada','10JhviFuU2gWD6'],['Surpresa','5VKbvrjxpVJCM']].map(([title,id])=>({title,url:`https://media.giphy.com/media/${id}/giphy.gif`}));

// GIPHY browser integration key: public by design, not an authentication secret.
const browserKey='YT4dg2lWd5htFlHfH2kXNtitIvHOQvxU';
export function setupGifPicker(chat,{apiKey=import.meta.env.VITE_GIPHY_API_KEY||browserKey}={}) {
  apiKey=apiKey||browserKey;
  const picker=chat.querySelector('#gif-picker'),toggle=chat.querySelector('#gif-toggle'),selection=chat.querySelector('#gif-selection'),field=chat.querySelector('[name=gif]');
  picker.innerHTML='<label for="gif-query">Buscar GIFs</label><div class="gif-search-row"><input id="gif-query" type="search" maxlength="80" placeholder="Ex.: aplausos, risada, futebol" autocomplete="off"><button type="button" id="gif-search">Buscar</button></div><p class="gif-status" role="status" aria-live="polite"></p><div class="gif-results"></div><a class="gif-attribution" href="https://giphy.com/" target="_blank" rel="noopener noreferrer">Powered by GIPHY</a>';
  const query=picker.querySelector('input'),status=picker.querySelector('.gif-status'),results=picker.querySelector('.gif-results');
  let controller,revision=0;
  function render(items){results.innerHTML=items.filter(item=>directGif(item.url)).map(item=>`<button type="button" data-gif="${escape(item.url)}" aria-label="Selecionar GIF: ${escape(item.title)}"><img src="${escape(item.url)}" alt="${escape(item.title)}" loading="lazy" referrerpolicy="no-referrer"></button>`).join('');}
  render(favorites);
  async function search(){
    controller?.abort();const current=++revision;const term=query.value.trim();
    if(!term){render(favorites);status.textContent='';return;}
    if(!apiKey){status.textContent='A busca de GIFs ainda não está disponível. Você pode escolher uma sugestão abaixo.';return;}
    controller=new AbortController();status.textContent='Buscando GIFs…';results.innerHTML='';
    try{
      const params=new URLSearchParams({api_key:apiKey,q:term,limit:'20',rating:'pg',lang:'pt'});
      const response=await fetch('https://api.giphy.com/v1/gifs/search?'+params,{signal:controller.signal,referrerPolicy:'no-referrer'});
      if(!response.ok)throw new Error('provider');
      const data=await response.json();if(current!==revision)return;
      const items=(data.data||[]).map(item=>({title:item.title||term,url:item.images?.fixed_height?.url||item.images?.original?.url})).filter(item=>directGif(item.url));
      render(items);status.textContent=items.length?'Escolha um GIF para anexar.':'Nenhum GIF encontrado. Tente outra palavra.';
    }catch(error){if(error.name!=='AbortError'&&current===revision)status.textContent='Não foi possível buscar GIFs agora. Tente novamente.';}
  }
  toggle.onclick=()=>{picker.hidden=!picker.hidden;toggle.setAttribute('aria-expanded',String(!picker.hidden));if(!picker.hidden)query.focus();};
  picker.querySelector('#gif-search').onclick=search;
  query.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();search();}});
  query.addEventListener('input',()=>{controller?.abort();revision++;});
  picker.addEventListener('click',event=>{
    const button=event.target.closest('[data-gif]');if(!button)return;
    field.value=button.dataset.gif;selection.hidden=false;
    selection.innerHTML=`<img src="${escape(field.value)}" alt="GIF selecionado"><button type="button">Remover GIF</button>`;
    selection.querySelector('button').onclick=clear;
    picker.hidden=true;toggle.setAttribute('aria-expanded','false');chat.querySelector('[name=text]').focus();
  });
  function clear(){field.value='';selection.innerHTML='';selection.hidden=true;}
  return {clear};
}
