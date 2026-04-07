/**
 * Makouez IT – Widget Chat IA
 * Bouton en bas à GAUCHE (loin du WhatsApp qui est à droite)
 * z-index 9999 — rien ne peut le recouvrir
 */
(function() {
  const PROXY_URL = "https://claudeproxy-ha46eidtha-ew.a.run.app";

  const style = document.createElement('style');
  style.textContent = `
    #mkit-fab {
      position: fixed !important;
      bottom: 1.5rem !important;
      left: 1.5rem !important;
      right: auto !important;
      z-index: 9999 !important;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      pointer-events: auto !important;
    }
    #mkit-btn {
      width: 54px;
      height: 54px;
      border-radius: 50%;
      background: #1b1b40;
      border: 2.5px solid #3b82f6;
      color: #60a5fa;
      font-size: 1.4rem;
      cursor: pointer !important;
      box-shadow: 0 4px 20px rgba(59,130,246,0.5);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.2s, box-shadow 0.2s;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
      pointer-events: auto !important;
      position: relative;
      z-index: 10000 !important;
      outline: none;
    }
    #mkit-btn:hover {
      transform: scale(1.1);
      box-shadow: 0 6px 28px rgba(59,130,246,0.7);
    }
    #mkit-btn:active { transform: scale(0.93); }
    #mkit-label {
      font-size: 0.65rem;
      color: #60a5fa;
      font-family: 'DM Sans', sans-serif;
      white-space: nowrap;
      pointer-events: none;
      background: rgba(9,9,15,0.85);
      padding: 2px 7px;
      border-radius: 99px;
      border: 1px solid #3b82f640;
    }
    #mkit-notif {
      position: absolute;
      top: -2px; right: -2px;
      width: 14px; height: 14px;
      border-radius: 50%;
      background: #ef4444;
      border: 2px solid #09090f;
      pointer-events: none;
      display: none;
      z-index: 10001;
      animation: mkitPulse 2s infinite;
    }
    @keyframes mkitPulse {
      0%,100%{transform:scale(1)}50%{transform:scale(1.3)}
    }
    #mkit-window {
      position: fixed !important;
      bottom: 7rem !important;
      left: 1.5rem !important;
      right: auto !important;
      width: 320px;
      max-height: 460px;
      background: #111120;
      border: 1px solid #3b82f650;
      border-radius: 16px;
      box-shadow: 0 16px 48px rgba(0,0,0,0.7);
      z-index: 9998 !important;
      display: none;
      flex-direction: column;
      overflow: hidden;
      font-family: 'DM Sans', sans-serif;
    }
    #mkit-window.open { display: flex; }
    #mkit-header {
      background: #16162a;
      padding: 0.85rem 1rem;
      border-bottom: 1px solid #ffffff12;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }
    .mkit-hinfo{display:flex;align-items:center;gap:0.6rem}
    .mkit-avatar{width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#3b82f6,#60a5fa);display:flex;align-items:center;justify-content:center;font-size:0.8rem;font-weight:700;color:#fff;font-family:'Syne',sans-serif}
    .mkit-name{font-size:0.85rem;font-weight:600;color:#f0f0ff}
    .mkit-status{font-size:0.7rem;color:#22c55e;display:flex;align-items:center;gap:3px}
    .mkit-sdot{width:5px;height:5px;border-radius:50%;background:#22c55e;animation:mkitPulse 2s infinite}
    #mkit-close{background:transparent;border:1px solid #ffffff18;color:#8888aa;width:26px;height:26px;border-radius:6px;cursor:pointer;font-size:0.85rem;display:flex;align-items:center;justify-content:center;transition:all 0.2s;flex-shrink:0}
    #mkit-close:hover{color:#f0f0ff}
    #mkit-msgs{flex:1;overflow-y:auto;padding:0.85rem;display:flex;flex-direction:column;gap:0.65rem;scroll-behavior:smooth}
    #mkit-msgs::-webkit-scrollbar{width:3px}
    #mkit-msgs::-webkit-scrollbar-thumb{background:#3b82f640;border-radius:99px}
    .mkit-msg{max-width:88%;padding:0.6rem 0.85rem;border-radius:12px;font-size:0.83rem;line-height:1.55;word-break:break-word}
    .mkit-msg.bot{background:#1a1a35;border:1px solid #3b82f628;color:#f0f0ff;align-self:flex-start;border-bottom-left-radius:3px}
    .mkit-msg.user{background:#3b82f6;color:#fff;align-self:flex-end;border-bottom-right-radius:3px}
    .mkit-msg.typing{background:#1a1a35;border:1px solid #3b82f628;align-self:flex-start;display:flex;align-items:center;gap:4px;padding:0.7rem 0.85rem}
    .mkit-tdot{width:6px;height:6px;border-radius:50%;background:#60a5fa;animation:mkitBounce 1.2s infinite}
    .mkit-tdot:nth-child(2){animation-delay:0.2s}
    .mkit-tdot:nth-child(3){animation-delay:0.4s}
    @keyframes mkitBounce{0%,60%,100%{transform:translateY(0);opacity:0.5}30%{transform:translateY(-5px);opacity:1}}
    #mkit-suggs{display:flex;flex-wrap:wrap;gap:0.35rem;padding:0 0.85rem 0.5rem;flex-shrink:0}
    .mkit-sugg{background:#1a1a35;border:1px solid #3b82f640;color:#60a5fa;font-family:'DM Sans',sans-serif;font-size:0.73rem;padding:0.28rem 0.65rem;border-radius:99px;cursor:pointer;transition:all 0.2s;white-space:nowrap}
    .mkit-sugg:hover{background:#3b82f620;border-color:#3b82f680}
    #mkit-row{padding:0.65rem 0.85rem;border-top:1px solid #ffffff10;display:flex;gap:0.45rem;align-items:flex-end;flex-shrink:0}
    #mkit-input{flex:1;background:#1a1a35;border:1px solid #3b82f640;border-radius:10px;padding:0.55rem 0.8rem;color:#f0f0ff;font-family:'DM Sans',sans-serif;font-size:0.83rem;outline:none;transition:border-color 0.2s;resize:none;height:36px;max-height:90px;line-height:1.4}
    #mkit-input:focus{border-color:#3b82f6}
    #mkit-input::placeholder{color:#8888aa}
    #mkit-send{width:36px;height:36px;border-radius:9px;background:#3b82f6;border:none;color:#fff;font-size:0.95rem;cursor:pointer;transition:opacity 0.2s,transform 0.1s;flex-shrink:0;display:flex;align-items:center;justify-content:center}
    #mkit-send:hover{opacity:0.85}
    #mkit-send:active{transform:scale(0.9)}
    #mkit-send:disabled{opacity:0.35;cursor:not-allowed}
    @media(max-width:480px){
      #mkit-window{width:calc(100vw - 2rem);left:1rem}
      #mkit-fab{left:1rem;bottom:1.25rem}
    }
  `;
  document.head.appendChild(style);

  // HTML
  const fab = document.createElement('div');
  fab.id = 'mkit-fab';
  fab.innerHTML = `
    <button id="mkit-btn" aria-label="Chat Makouez IT">
      💬<span id="mkit-notif"></span>
    </button>
    <span id="mkit-label">Assistant IA</span>
  `;
  const win = document.createElement('div');
  win.id = 'mkit-window';
  win.innerHTML = `
    <div id="mkit-header">
      <div class="mkit-hinfo">
        <div class="mkit-avatar">M</div>
        <div>
          <div class="mkit-name">Assistant Makouez IT</div>
          <div class="mkit-status"><span class="mkit-sdot"></span> En ligne</div>
        </div>
      </div>
      <button id="mkit-close">✕</button>
    </div>
    <div id="mkit-msgs"></div>
    <div id="mkit-suggs"></div>
    <div id="mkit-row">
      <textarea id="mkit-input" placeholder="Votre question…" rows="1"></textarea>
      <button id="mkit-send">➤</button>
    </div>
  `;
  document.body.appendChild(win);
  document.body.appendChild(fab);

  // State
  let isOpen=false, isLoading=false, history=[], hasOpened=false;
  const SUGGS=['Quels sont vos tarifs ?','Zone d\'intervention ?','Comment prendre RDV ?','Contrat Sérénité ?'];

  // Events
  document.getElementById('mkit-btn').onclick   = toggle;
  document.getElementById('mkit-close').onclick = toggle;
  document.getElementById('mkit-send').onclick  = send;
  document.getElementById('mkit-input').addEventListener('keydown',e=>{
    if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();send();}
  });
  document.getElementById('mkit-input').addEventListener('input',function(){
    this.style.height='36px';
    this.style.height=Math.min(this.scrollHeight,90)+'px';
  });

  function toggle(){
    isOpen=!isOpen;
    document.getElementById('mkit-window').classList.toggle('open',isOpen);
    const btn=document.getElementById('mkit-btn');
    // Garder le span notif
    btn.innerHTML=isOpen?'✕<span id="mkit-notif" style="display:none"></span>':'💬<span id="mkit-notif" style="display:none"></span>';
    if(isOpen&&!hasOpened){
      hasOpened=true;
      setTimeout(()=>{
        addMsg('Bonjour ! 👋 Je suis l\'assistant Makouez IT. Posez vos questions sur nos tarifs, services ou pour prendre RDV !','bot');
        showSuggs();
      },200);
    }
    if(isOpen) setTimeout(()=>{const i=document.getElementById('mkit-input');if(i)i.focus();},300);
  }

  function showSuggs(){
    const el=document.getElementById('mkit-suggs');
    if(!el||history.length>0){if(el)el.innerHTML='';return;}
    el.innerHTML=SUGGS.map(s=>`<button class="mkit-sugg">${s}</button>`).join('');
    el.querySelectorAll('.mkit-sugg').forEach(b=>{
      b.onclick=()=>{
        const i=document.getElementById('mkit-input');
        if(i)i.value=b.textContent;
        send();
      };
    });
  }

  function addMsg(text,role){
    const c=document.getElementById('mkit-msgs');
    if(!c)return;
    const d=document.createElement('div');
    d.className='mkit-msg '+role;
    d.textContent=text;
    c.appendChild(d);
    c.scrollTop=c.scrollHeight;
  }

  function showTyping(){
    const c=document.getElementById('mkit-msgs');
    if(!c)return;
    const d=document.createElement('div');
    d.className='mkit-msg typing';d.id='mkit-typing';
    d.innerHTML='<div class="mkit-tdot"></div><div class="mkit-tdot"></div><div class="mkit-tdot"></div>';
    c.appendChild(d);c.scrollTop=c.scrollHeight;
  }

  function removeTyping(){const t=document.getElementById('mkit-typing');if(t)t.remove();}

  async function send(){
    const input=document.getElementById('mkit-input');
    const text=input?input.value.trim():'';
    if(!text||isLoading)return;
    input.value='';input.style.height='36px';
    isLoading=true;
    document.getElementById('mkit-send').disabled=true;
    document.getElementById('mkit-suggs').innerHTML='';
    addMsg(text,'user');
    history.push({role:'user',content:text});
    showTyping();
    try{
      const res=await fetch(PROXY_URL,{
        method:'POST',
        headers:{'Content-Type':'application/json'},
        body:JSON.stringify({messages:history})
      });
      removeTyping();
      if(!res.ok)throw new Error('HTTP '+res.status);
      const data=await res.json();
      if(data.reply){
        addMsg(data.reply,'bot');
        history.push({role:'assistant',content:data.reply});
      }else throw new Error('no reply');
    }catch(e){
      removeTyping();
      console.error('Chat:',e);
      addMsg('Désolé, erreur. Contactez Stevy au 06 19 51 57 56.','bot');
    }
    isLoading=false;
    document.getElementById('mkit-send').disabled=false;
    const i=document.getElementById('mkit-input');if(i)i.focus();
  }

  // Notification après 8s
  setTimeout(()=>{
    if(!isOpen){const n=document.getElementById('mkit-notif');if(n)n.style.display='block';}
  },8000);
})();
