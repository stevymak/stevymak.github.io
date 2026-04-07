/**
 * Makouez IT – Widget Chat IA
 * Bouton repositionné au-dessus du WhatsApp, bien visible et cliquable
 */

(function() {
  // URL de ta Firebase Function proxy — à mettre à jour après déploiement
  const PROXY_URL = "https://claudeproxy-558314427247-ew.a.run.app";

  // ─── STYLES ────────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    /* Bouton chat — positionné à GAUCHE du WhatsApp, pas au-dessus */
    #makouez-chat-fab {
      position: fixed;
      bottom: 1.75rem;
      right: 5.5rem; /* décalé à gauche du bouton WhatsApp (56px + gap) */
      z-index: 199;
      display: flex;
      flex-direction: column;
      align-items: center;
    }

    #makouez-chat-btn {
      width: 52px;
      height: 52px;
      border-radius: 50%;
      background: #1e1e3a;
      border: 2px solid #3b82f6;
      color: #60a5fa;
      font-size: 1.3rem;
      cursor: pointer;
      box-shadow: 0 4px 20px rgba(59,130,246,0.5);
      transition: transform 0.2s, box-shadow 0.2s, background 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
      -webkit-tap-highlight-color: transparent;
      touch-action: manipulation;
      position: relative;
      /* PAS de pointer-events:none ici */
    }
    #makouez-chat-btn:hover {
      transform: scale(1.1);
      box-shadow: 0 6px 28px rgba(59,130,246,0.7);
      background: #252550;
    }
    #makouez-chat-btn:active {
      transform: scale(0.94);
    }

    /* Label sous le bouton */
    #makouez-chat-label {
      margin-top: 4px;
      font-size: 0.65rem;
      color: #60a5fa;
      font-family: 'DM Sans', sans-serif;
      white-space: nowrap;
      pointer-events: none;
      user-select: none;
    }

    /* Point de notification */
    #makouez-chat-notif {
      position: absolute;
      top: -2px;
      right: -2px;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: #ef4444;
      border: 2px solid #09090f;
      pointer-events: none;
      display: none;
      animation: chat-notif-pulse 2s infinite;
      z-index: 2;
    }
    @keyframes chat-notif-pulse {
      0%,100% { transform: scale(1); opacity: 1; }
      50%      { transform: scale(1.3); opacity: 0.8; }
    }

    /* Fenêtre de chat */
    #makouez-chat-window {
      position: fixed;
      bottom: 6rem;
      right: 1.75rem;
      width: 340px;
      max-height: 500px;
      background: #111120;
      border: 1px solid #3b82f640;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0,0,0,0.7), 0 0 0 1px #3b82f620;
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
    .chat-header-status {
      font-size: 0.72rem; color: #22c55e;
      display: flex; align-items: center; gap: 4px;
    }
    .chat-status-dot {
      width: 6px; height: 6px; border-radius: 50%;
      background: #22c55e; animation: chat-notif-pulse 2s infinite;
    }
    .chat-close-btn {
      background: transparent; border: 1px solid #ffffff20; color: #8888aa;
      width: 28px; height: 28px; border-radius: 6px;
      cursor: pointer; font-size: 0.9rem;
      display: flex; align-items: center; justify-content: center;
      transition: all 0.2s; flex-shrink: 0;
    }
    .chat-close-btn:hover { color: #f0f0ff; border-color: #ffffff40; }

    #makouez-chat-messages {
      flex: 1; overflow-y: auto; padding: 1rem;
      display: flex; flex-direction: column; gap: 0.75rem;
      scroll-behavior: smooth;
    }
    #makouez-chat-messages::-webkit-scrollbar { width: 3px; }
    #makouez-chat-messages::-webkit-scrollbar-thumb { background: #3b82f640; border-radius: 99px; }

    .chat-msg {
      max-width: 86%; padding: 0.65rem 0.9rem;
      border-radius: 12px; font-size: 0.85rem;
      line-height: 1.55; word-break: break-word;
    }
    .chat-msg.bot {
      background: #1a1a35; border: 1px solid #3b82f630;
      color: #f0f0ff; align-self: flex-start; border-bottom-left-radius: 4px;
    }
    .chat-msg.user {
      background: #3b82f6; color: #fff;
      align-self: flex-end; border-bottom-right-radius: 4px;
    }
    .chat-msg.typing {
      background: #1a1a35; border: 1px solid #3b82f630;
      align-self: flex-start; display: flex;
      align-items: center; gap: 5px; padding: 0.75rem 0.9rem;
    }
    .typing-dot {
      width: 7px; height: 7px; border-radius: 50%;
      background: #60a5fa; animation: typing-bounce 1.2s infinite;
    }
    .typing-dot:nth-child(2) { animation-delay: 0.2s; }
    .typing-dot:nth-child(3) { animation-delay: 0.4s; }
    @keyframes typing-bounce {
      0%,60%,100% { transform: translateY(0); opacity: 0.6; }
      30%          { transform: translateY(-6px); opacity: 1; }
    }

    .chat-suggestions {
      display: flex; flex-wrap: wrap; gap: 0.4rem;
      padding: 0 1rem 0.6rem; flex-shrink: 0;
    }
    .chat-suggestion-btn {
      background: #1a1a35; border: 1px solid #3b82f640;
      color: #60a5fa; font-family: 'DM Sans', sans-serif;
      font-size: 0.75rem; padding: 0.3rem 0.75rem;
      border-radius: 99px; cursor: pointer;
      transition: all 0.2s; white-space: nowrap;
    }
    .chat-suggestion-btn:hover {
      background: #3b82f620; border-color: #3b82f680;
    }

    #makouez-chat-input-row {
      padding: 0.75rem 1rem; border-top: 1px solid #ffffff10;
      display: flex; gap: 0.5rem; align-items: flex-end; flex-shrink: 0;
    }
    #makouez-chat-input {
      flex: 1; background: #1a1a35; border: 1px solid #3b82f640;
      border-radius: 10px; padding: 0.6rem 0.9rem;
      color: #f0f0ff; font-family: 'DM Sans', sans-serif;
      font-size: 0.85rem; outline: none;
      transition: border-color 0.2s; resize: none;
      height: 38px; max-height: 100px; line-height: 1.4;
    }
    #makouez-chat-input:focus { border-color: #3b82f6; }
    #makouez-chat-input::placeholder { color: #8888aa; }
    #makouez-chat-send {
      width: 38px; height: 38px; border-radius: 10px;
      background: #3b82f6; border: none; color: #fff;
      font-size: 1rem; cursor: pointer;
      transition: opacity 0.2s, transform 0.1s; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
    }
    #makouez-chat-send:hover { opacity: 0.85; }
    #makouez-chat-send:active { transform: scale(0.92); }
    #makouez-chat-send:disabled { opacity: 0.35; cursor: not-allowed; }

    @media(max-width: 480px) {
      #makouez-chat-window {
        width: calc(100vw - 1.5rem);
        right: 0.75rem;
        bottom: 5.5rem;
      }
      #makouez-chat-fab {
        right: 4.75rem;
        bottom: 1.75rem;
      }
    }
  `;
  document.head.appendChild(style);

  // ─── HTML ──────────────────────────────────────────────────────────────────
  const fab = document.createElement('div');
  fab.id = 'makouez-chat-fab';
  fab.innerHTML = `
    <button id="makouez-chat-btn" aria-label="Ouvrir le chat Makouez IT">
      💬
      <div id="makouez-chat-notif"></div>
    </button>
    <div id="makouez-chat-label">Assistant IA</div>
  `;

  const win = document.createElement('div');
  win.id = 'makouez-chat-window';
  win.innerHTML = `
    <div id="makouez-chat-header">
      <div class="chat-header-info">
        <div class="chat-avatar">M</div>
        <div>
          <div class="chat-header-name">Assistant Makouez IT</div>
          <div class="chat-header-status">
            <span class="chat-status-dot"></span> En ligne
          </div>
        </div>
      </div>
      <button class="chat-close-btn" id="chatCloseBtn" aria-label="Fermer">✕</button>
    </div>
    <div id="makouez-chat-messages"></div>
    <div class="chat-suggestions" id="chatSuggestions"></div>
    <div id="makouez-chat-input-row">
      <textarea id="makouez-chat-input" placeholder="Posez votre question…" rows="1"></textarea>
      <button id="makouez-chat-send" aria-label="Envoyer">➤</button>
    </div>
  `;

  // Insérer dans le DOM
  document.body.appendChild(win);
  document.body.appendChild(fab);

  // ─── EVENTS ────────────────────────────────────────────────────────────────
  let isOpen    = false;
  let isLoading = false;
  let messages  = [];
  let hasOpened = false;

  const suggestions = [
    'Quels sont vos tarifs ?',
    'Zone d\'intervention ?',
    'Prendre un RDV ?',
    'Contrat Sérénité ?',
  ];

  // Attacher les événements après insertion dans le DOM
  document.getElementById('makouez-chat-btn').addEventListener('click', function(e) {
    e.stopPropagation();
    toggleChat();
  });
  document.getElementById('chatCloseBtn').addEventListener('click', function(e) {
    e.stopPropagation();
    toggleChat();
  });
  document.getElementById('makouez-chat-send').addEventListener('click', sendMessage);
  document.getElementById('makouez-chat-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  document.getElementById('makouez-chat-input').addEventListener('input', function() {
    this.style.height = '38px';
    this.style.height = Math.min(this.scrollHeight, 100) + 'px';
  });

  // ─── FONCTIONS ─────────────────────────────────────────────────────────────
  function toggleChat() {
    isOpen = !isOpen;
    const chatWin = document.getElementById('makouez-chat-window');
    const btn     = document.getElementById('makouez-chat-btn');

    chatWin.classList.toggle('open', isOpen);

    if (isOpen) {
      // Masquer la notification
      const notif = document.getElementById('makouez-chat-notif');
      if (notif) notif.style.display = 'none';
      // Changer l'icône
      btn.innerHTML = '✕<div id="makouez-chat-notif" style="display:none"></div>';

      if (!hasOpened) {
        hasOpened = true;
        setTimeout(() => {
          addMessage('Bonjour ! 👋 Je suis l\'assistant de Makouez IT. Je peux vous renseigner sur nos tarifs, services et prise de RDV.', 'bot');
          renderSuggestions();
        }, 200);
      }
      setTimeout(() => {
        const inp = document.getElementById('makouez-chat-input');
        if (inp) inp.focus();
      }, 300);
    } else {
      btn.innerHTML = '💬<div id="makouez-chat-notif" style="display:none"></div>';
    }
  }

  function renderSuggestions() {
    const el = document.getElementById('chatSuggestions');
    if (!el || messages.length >= 1) { if (el) el.innerHTML = ''; return; }
    el.innerHTML = suggestions.map(s =>
      `<button class="chat-suggestion-btn">${s}</button>`
    ).join('');
    el.querySelectorAll('.chat-suggestion-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const inp = document.getElementById('makouez-chat-input');
        if (inp) inp.value = btn.textContent;
        sendMessage();
      });
    });
  }

  function addMessage(text, role) {
    const msgs = document.getElementById('makouez-chat-messages');
    if (!msgs) return;
    const div = document.createElement('div');
    div.className = `chat-msg ${role}`;
    div.textContent = text;
    msgs.appendChild(div);
    msgs.scrollTop = msgs.scrollHeight;
    return div;
  }

  function showTyping() {
    const msgs = document.getElementById('makouez-chat-messages');
    if (!msgs) return;
    const div = document.createElement('div');
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
    if (!input) return;
    const text = input.value.trim();
    if (!text || isLoading) return;

    input.value = '';
    input.style.height = '38px';
    isLoading = true;
    document.getElementById('makouez-chat-send').disabled = true;

    const sugEl = document.getElementById('chatSuggestions');
    if (sugEl) sugEl.innerHTML = '';

    addMessage(text, 'user');
    messages.push({ role: 'user', content: text });
    showTyping();

    try {
      const response = await fetch(PROXY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages })
      });

      removeTyping();

      if (!response.ok) {
        throw new Error('Erreur proxy ' + response.status);
      }

      const data = await response.json();
      if (data.reply) {
        addMessage(data.reply, 'bot');
        messages.push({ role: 'assistant', content: data.reply });
      } else {
        throw new Error('Pas de réponse');
      }
    } catch(e) {
      removeTyping();
      console.error('Chat error:', e);
      addMessage('Désolé, une erreur est survenue. Contactez Stevy au 06 19 51 57 56 ou sur WhatsApp.', 'bot');
    }

    isLoading = false;
    const sendBtn = document.getElementById('makouez-chat-send');
    if (sendBtn) sendBtn.disabled = false;
    const inp = document.getElementById('makouez-chat-input');
    if (inp) inp.focus();
  }

  // Notification après 8 secondes si pas encore ouvert
  setTimeout(() => {
    if (!isOpen) {
      const notif = document.getElementById('makouez-chat-notif');
      if (notif) notif.style.display = 'block';
    }
  }, 8000);

  // API globale
  window.makouezChatToggle = toggleChat;
  window.makouezChatSend   = sendMessage;

})();
