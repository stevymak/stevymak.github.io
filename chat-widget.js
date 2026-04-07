/**
 * Makouez IT – Widget Chat IA
 * À inclure dans index.html avec : <script src="chat-widget.js"></script>
 * L'IA passe maintenant par une Firebase Function proxy (pas de CORS)
 */

(function() {
  // URL de ta Firebase Function proxy
  // Format : https://claudeproxy-XXXXXXXX-ew.a.run.app
  // Tu trouveras cette URL dans Firebase Console → Functions après le déploiement
  const PROXY_URL = "https://claudeproxy-558314427247-ew.a.run.app";

  // ─── STYLES ────────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    #makouez-chat-fab {
      position: fixed;
      bottom: 5.5rem;
      right: 1.75rem;
      z-index: 199;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 0.5rem;
    }
    #makouez-chat-tooltip {
      background: #111120;
      border: 1px solid #ffffff14;
      color: #f0f0ff;
      font-size: 0.78rem;
      font-family: 'DM Sans', sans-serif;
      padding: 0.4rem 0.85rem;
      border-radius: 8px;
      white-space: nowrap;
      opacity: 0;
      transform: translateX(8px);
      transition: opacity 0.2s, transform 0.2s;
      pointer-events: none;
      user-select: none;
    }
    #makouez-chat-fab:hover #makouez-chat-tooltip {
      opacity: 1;
      transform: translateX(0);
    }
    #makouez-chat-btn {
      position: relative;
      width: 52px;
      height: 52px;
      border-radius: 50%;
      background: #111120;
      border: 1.5px solid #3b82f660;
      color: #60a5fa;
      font-size: 1.25rem;
      cursor: pointer;
      box-shadow: 0 4px 20px rgba(59,130,246,0.35);
      transition: transform 0.2s, box-shadow 0.2s, background 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1;
      flex-shrink: 0;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
    }
    #makouez-chat-btn:hover {
      transform: scale(1.08);
      box-shadow: 0 6px 28px rgba(59,130,246,0.55);
      background: #16162a;
    }
    #makouez-chat-btn:active { transform: scale(0.96); }
    #makouez-chat-notif {
      position: absolute;
      top: -3px;
      right: -3px;
      width: 13px;
      height: 13px;
      border-radius: 50%;
      background: #ef4444;
      border: 2px solid #09090f;
      pointer-events: none;
      animation: chat-notif-pulse 2s infinite;
    }
    @keyframes chat-notif-pulse {
      0%,100% { transform: scale(1); }
      50%      { transform: scale(1.25); }
    }
    #makouez-chat-window {
      position: fixed;
      bottom: 9.5rem;
      right: 1.75rem;
      width: 340px;
      max-height: 480px;
      background: #111120;
      border: 1px solid #ffffff14;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.6);
      z-index: 198;
      display: none;
      flex-direction: column;
      overflow: hidden;
      font-family: 'DM Sans', sans-serif;
    }
    #makouez-chat-window.open { display: flex; }
    #makouez-chat-header {
      background: #16162a;
      padding: 0.9rem 1rem;
      border-bottom: 1px solid #ffffff14;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-shrink: 0;
    }
    .chat-header-info { display: flex; align-items: center; gap: 0.6rem; }
    .chat-avatar {
      width: 32px; height: 32px; border-radius: 50%;
      background: linear-gradient(135deg, #3b82f6, #60a5fa);
      display: flex; align-items: center; justify-content: center;
      font-size: 0.85rem; font-weight: 700; color: #fff;
      font-family: 'Syne', sans-serif; flex-shrink: 0;
    }
    .chat-header-name { font-size: 0.88rem; font-weight: 600; color: #f0f0ff; }
    .chat-header-status { font-size: 0.72rem; color: #22c55e; display: flex; align-items: center; gap: 4px; }
    .chat-status-dot { width: 6px; height: 6px; border-radius: 50%; background: #22c55e; animation: chat-notif-pulse 2s infinite; }
    .chat-close-btn {
      background: transparent; border: 1px solid #ffffff14; color: #8888aa;
      width: 28px; height: 28px; border-radius: 6px;
      cursor: pointer; font-size: 0.95rem;
      display: flex; align-items: center; justify-content: center;
      transition: color 0.2s; flex-shrink: 0;
    }
    .chat-close-btn:hover { color: #f0f0ff; }
    #makouez-chat-messages {
      flex: 1; overflow-y: auto; padding: 1rem;
      display: flex; flex-direction: column; gap: 0.75rem;
      scroll-behavior: smooth;
    }
    #makouez-chat-messages::-webkit-scrollbar { width: 3px; }
    #makouez-chat-messages::-webkit-scrollbar-thumb { background: #ffffff20; border-radius: 99px; }
    .chat-msg {
      max-width: 86%; padding: 0.6rem 0.85rem;
      border-radius: 12px; font-size: 0.85rem;
      line-height: 1.5; word-break: break-word;
    }
    .chat-msg.bot {
      background: #ffffff0a; border: 1px solid #ffffff14;
      color: #f0f0ff; align-self: flex-start; border-bottom-left-radius: 4px;
    }
    .chat-msg.user {
      background: #3b82f6; color: #fff;
      align-self: flex-end; border-bottom-right-radius: 4px;
    }
    .chat-msg.typing {
      background: #ffffff0a; border: 1px solid #ffffff14;
      align-self: flex-start; display: flex;
      align-items: center; gap: 5px; padding: 0.7rem 0.85rem;
    }
    .typing-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: #8888aa; animation: typing-bounce 1.2s infinite;
    }
    .typing-dot:nth-child(2) { animation-delay: 0.2s; }
    .typing-dot:nth-child(3) { animation-delay: 0.4s; }
    @keyframes typing-bounce {
      0%,60%,100% { transform: translateY(0); }
      30%          { transform: translateY(-6px); }
    }
    .chat-suggestions {
      display: flex; flex-wrap: wrap; gap: 0.4rem;
      padding: 0 1rem 0.5rem; flex-shrink: 0;
    }
    .chat-suggestion-btn {
      background: #3b82f618; border: 1px solid #3b82f640;
      color: #60a5fa; font-family: 'DM Sans', sans-serif;
      font-size: 0.75rem; padding: 0.3rem 0.7rem;
      border-radius: 99px; cursor: pointer;
      transition: background 0.2s; white-space: nowrap;
    }
    .chat-suggestion-btn:hover { background: #3b82f628; }
    #makouez-chat-input-row {
      padding: 0.75rem 1rem; border-top: 1px solid #ffffff14;
      display: flex; gap: 0.5rem; align-items: flex-end; flex-shrink: 0;
    }
    #makouez-chat-input {
      flex: 1; background: #ffffff08; border: 1px solid #ffffff14;
      border-radius: 8px; padding: 0.55rem 0.85rem;
      color: #f0f0ff; font-family: 'DM Sans', sans-serif;
      font-size: 0.85rem; outline: none;
      transition: border-color 0.2s; resize: none;
      height: 36px; max-height: 100px; line-height: 1.4;
    }
    #makouez-chat-input:focus { border-color: #3b82f660; }
    #makouez-chat-input::placeholder { color: #8888aa; }
    #makouez-chat-send {
      width: 34px; height: 34px; border-radius: 8px;
      background: #3b82f6; border: none; color: #fff;
      font-size: 0.9rem; cursor: pointer;
      transition: opacity 0.2s; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
    }
    #makouez-chat-send:hover { opacity: 0.85; }
    #makouez-chat-send:disabled { opacity: 0.4; cursor: not-allowed; }
    @media(max-width: 480px) {
      #makouez-chat-window { width: calc(100vw - 2rem); right: 1rem; bottom: 8.5rem; }
    }
  `;
  document.head.appendChild(style);

  // ─── HTML ──────────────────────────────────────────────────────────────────
  const fab = document.createElement('div');
  fab.id = 'makouez-chat-fab';
  fab.innerHTML = `
    <div id="makouez-chat-tooltip">Posez vos questions</div>
    <button id="makouez-chat-btn" aria-label="Ouvrir le chat Makouez IT">
      💬
      <div id="makouez-chat-notif" style="display:none"></div>
    </button>
  `;

  const win = document.createElement('div');
  win.id = 'makouez-chat-window';
  win.innerHTML = `
    <div id="makouez-chat-header">
      <div class="chat-header-info">
        <div class="chat-avatar">M</div>
        <div>
          <div class="chat-header-name">Assistant Makouez IT</div>
          <div class="chat-header-status"><span class="chat-status-dot"></span> En ligne</div>
        </div>
      </div>
      <button class="chat-close-btn" id="chatCloseBtn">✕</button>
    </div>
    <div id="makouez-chat-messages"></div>
    <div class="chat-suggestions" id="chatSuggestions"></div>
    <div id="makouez-chat-input-row">
      <textarea id="makouez-chat-input" placeholder="Posez votre question…" rows="1"></textarea>
      <button id="makouez-chat-send">➤</button>
    </div>
  `;

  document.body.appendChild(win);
  document.body.appendChild(fab);

  // ─── LOGIQUE ───────────────────────────────────────────────────────────────
  let isOpen    = false;
  let isLoading = false;
  let messages  = [];
  let hasOpened = false;

  const suggestions = [
    'Quels sont vos tarifs ?',
    'Vous intervenez où ?',
    'Comment prendre RDV ?',
    'C\'est quoi le Contrat Sérénité ?',
  ];

  // Événements
  document.getElementById('makouez-chat-btn').addEventListener('click', toggleChat);
  document.getElementById('chatCloseBtn').addEventListener('click', toggleChat);
  document.getElementById('makouez-chat-send').addEventListener('click', sendMessage);
  document.getElementById('makouez-chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
  });
  document.getElementById('makouez-chat-input').addEventListener('input', function() {
    this.style.height = '36px';
    this.style.height = Math.min(this.scrollHeight, 100) + 'px';
  });

  function toggleChat() {
    isOpen = !isOpen;
    const chatWin = document.getElementById('makouez-chat-window');
    const btn     = document.getElementById('makouez-chat-btn');
    chatWin.classList.toggle('open', isOpen);

    if (isOpen) {
      btn.innerHTML = '✕<div id="makouez-chat-notif" style="display:none"></div>';
      if (!hasOpened) {
        hasOpened = true;
        setTimeout(() => {
          addMessage('Bonjour ! 👋 Je suis l\'assistant de Makouez IT. Tarifs, services, prise de RDV — posez vos questions !', 'bot');
          renderSuggestions();
        }, 250);
      }
      setTimeout(() => {
        const input = document.getElementById('makouez-chat-input');
        if (input) input.focus();
      }, 350);
    } else {
      btn.innerHTML = '💬<div id="makouez-chat-notif" style="display:none"></div>';
    }
  }

  function renderSuggestions() {
    const el = document.getElementById('chatSuggestions');
    if (!el || messages.length > 1) { if (el) el.innerHTML = ''; return; }
    el.innerHTML = suggestions.map(s =>
      `<button class="chat-suggestion-btn">${s}</button>`
    ).join('');
    el.querySelectorAll('.chat-suggestion-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        document.getElementById('makouez-chat-input').value = btn.textContent;
        sendMessage();
      });
    });
  }

  function addMessage(text, role) {
    const msgs = document.getElementById('makouez-chat-messages');
    const div  = document.createElement('div');
    div.className = `chat-msg ${role}`;
    div.textContent = text;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return div;
  }

  function showTyping() {
    const msgs = document.getElementById('makouez-chat-messages');
    const div  = document.createElement('div');
    div.className = 'chat-msg typing';
    div.id = 'chat-typing';
    div.innerHTML = '<div class="typing-dot"></div><div class="typing-dot"></div><div class="typing-dot"></div>';
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
  }

  function removeTyping() {
    const t = document.getElementById('chat-typing');
    if (t) t.remove();
  }

  async function sendMessage() {
    const input = document.getElementById('makouez-chat-input');
    const text  = input.value.trim();
    if (!text || isLoading) return;

    input.value = '';
    input.style.height = '36px';
    isLoading = true;
    document.getElementById('makouez-chat-send').disabled = true;
    document.getElementById('chatSuggestions').innerHTML = '';

    addMessage(text, 'user');
    messages.push({ role: 'user', content: text });
    showTyping();

    try {
      // Appel à la Firebase Function proxy (pas de CORS)
      const response = await fetch(PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages })
      });

      removeTyping();

      if (!response.ok) {
        throw new Error('Proxy error ' + response.status);
      }

      const data = await response.json();
      if (data.reply) {
        addMessage(data.reply, 'bot');
        messages.push({ role: 'assistant', content: data.reply });
      } else {
        throw new Error('No reply');
      }
    } catch(e) {
      removeTyping();
      console.error('Chat error:', e);
      addMessage('Une erreur est survenue. Contactez Stevy directement au 06 19 51 57 56 ou sur WhatsApp.', 'bot');
    }

    isLoading = false;
    document.getElementById('makouez-chat-send').disabled = false;
    const input2 = document.getElementById('makouez-chat-input');
    if (input2) input2.focus();
  }

  // Notification après 6 secondes
  setTimeout(() => {
    if (!isOpen) {
      const notif = document.getElementById('makouez-chat-notif');
      if (notif) notif.style.display = 'block';
    }
  }, 6000);

  window.makouezChatToggle = toggleChat;
  window.makouezChatSend   = sendMessage;

})();
