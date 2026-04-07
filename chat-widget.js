/**
 * Makouez IT – Widget Chat IA
 * À inclure dans index.html avec : <script src="chat-widget.js"></script>
 * IMPORTANT : Régénérez votre clé API après l'avoir testée.
 */

(function() {
  // ─── CONFIG ────────────────────────────────────────────────────────────────
  const API_KEY = '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';

  const SYSTEM_PROMPT = `Tu es l'assistant virtuel de Makouez IT, une entreprise de dépannage informatique à domicile en Île-de-France, fondée par Stevy, technicien informatique avec 9 ans d'expérience.

Ton rôle : répondre aux questions des visiteurs sur les services, tarifs, disponibilités et orienter vers la prise de rendez-vous.

SERVICES PROPOSÉS :
- Dépannage PC / Mac : 60€ à 80€
- Installation Windows / Logiciels : à partir de 60€
- Réseau Wi-Fi : à partir de 60€
- Récupération de données : à partir de 80€
- Sauvegarde & sécurité : à partir de 60€
- Formation / Accompagnement : 40€/h
- Intégration / Développement web : à partir de 150€

CONTRATS MENSUELS :
- Contrat Sérénité : 39€/mois (interventions illimitées, priorité 24h, support téléphonique)
- Pack Senior+ : 49€/mois (visites régulières, formation progressive, hotline dédiée)
- Pack Famille : 59€/mois (3 appareils, contrôle parental, interventions illimitées)

INFOS PRATIQUES :
- Zone : Île-de-France, principalement 93 (Seine-Saint-Denis) et environs
- Délai : sous 24h à 48h en général
- Paiement après intervention, devis gratuit
- Contact : 06 19 51 57 56 | contact@makouezit.org | WhatsApp disponible
- Prise de RDV en ligne sur makouezit.org/makouez-it-rdv.html

CONSIGNES :
- Réponds en français, de manière chaleureuse et professionnelle
- Sois concis (3-4 phrases max par réponse)
- Si la question concerne un problème technique spécifique, donne un conseil rapide puis propose un RDV
- Pour les prix, indique toujours que le devis est confirmé sur place
- Ne promets pas de disponibilités spécifiques sans confirmation de Stevy
- Si tu ne sais pas, redirige vers le contact direct`;

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
    #makouez-chat-btn {
      width: 52px;
      height: 52px;
      border-radius: 50%;
      background: #111120;
      border: 1px solid #3b82f640;
      color: #60a5fa;
      font-size: 1.3rem;
      cursor: pointer;
      box-shadow: 0 4px 20px rgba(59,130,246,0.3);
      transition: transform 0.2s, box-shadow 0.2s;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    #makouez-chat-btn:hover {
      transform: scale(1.08);
      box-shadow: 0 6px 28px rgba(59,130,246,0.5);
    }
    #makouez-chat-notif {
      position: absolute;
      top: -4px;
      right: -4px;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: #ef4444;
      border: 2px solid #09090f;
      animation: chat-pulse 2s infinite;
    }
    @keyframes chat-pulse { 0%,100%{transform:scale(1)} 50%{transform:scale(1.2)} }
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
    }
    #makouez-chat-fab:hover #makouez-chat-tooltip {
      opacity: 1;
      transform: translateX(0);
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
      z-index: 199;
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
    }
    .chat-header-info { display: flex; align-items: center; gap: 0.6rem; }
    .chat-avatar {
      width: 32px; height: 32px;
      border-radius: 50%;
      background: linear-gradient(135deg, #3b82f6, #60a5fa);
      display: flex; align-items: center; justify-content: center;
      font-size: 0.85rem; font-weight: 700; color: #fff;
      font-family: 'Syne', sans-serif;
    }
    .chat-header-name { font-size: 0.88rem; font-weight: 600; color: #f0f0ff; }
    .chat-header-status { font-size: 0.72rem; color: #22c55e; display: flex; align-items: center; gap: 4px; }
    .chat-status-dot { width: 6px; height: 6px; border-radius: 50%; background: #22c55e; animation: chat-pulse 2s infinite; }
    .chat-close-btn {
      background: transparent; border: none; color: #8888aa;
      font-size: 1rem; cursor: pointer; padding: 0.2rem; line-height: 1;
      transition: color 0.2s;
    }
    .chat-close-btn:hover { color: #f0f0ff; }
    #makouez-chat-messages {
      flex: 1;
      overflow-y: auto;
      padding: 1rem;
      display: flex;
      flex-direction: column;
      gap: 0.75rem;
      scroll-behavior: smooth;
    }
    #makouez-chat-messages::-webkit-scrollbar { width: 4px; }
    #makouez-chat-messages::-webkit-scrollbar-track { background: transparent; }
    #makouez-chat-messages::-webkit-scrollbar-thumb { background: #ffffff20; border-radius: 99px; }
    .chat-msg {
      max-width: 85%;
      padding: 0.6rem 0.85rem;
      border-radius: 12px;
      font-size: 0.85rem;
      line-height: 1.5;
      word-break: break-word;
    }
    .chat-msg.bot {
      background: #ffffff0a;
      border: 1px solid #ffffff14;
      color: #f0f0ff;
      align-self: flex-start;
      border-bottom-left-radius: 4px;
    }
    .chat-msg.user {
      background: #3b82f6;
      color: #fff;
      align-self: flex-end;
      border-bottom-right-radius: 4px;
    }
    .chat-msg.typing {
      background: #ffffff0a;
      border: 1px solid #ffffff14;
      color: #8888aa;
      align-self: flex-start;
      font-size: 0.8rem;
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .typing-dot {
      width: 6px; height: 6px;
      border-radius: 50%;
      background: #8888aa;
      animation: typing-bounce 1.2s infinite;
    }
    .typing-dot:nth-child(2) { animation-delay: 0.2s; }
    .typing-dot:nth-child(3) { animation-delay: 0.4s; }
    @keyframes typing-bounce { 0%,60%,100%{transform:translateY(0)} 30%{transform:translateY(-6px)} }
    .chat-suggestions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.4rem;
      padding: 0 1rem 0.5rem;
    }
    .chat-suggestion-btn {
      background: #3b82f618;
      border: 1px solid #3b82f640;
      color: #60a5fa;
      font-family: 'DM Sans', sans-serif;
      font-size: 0.75rem;
      padding: 0.3rem 0.7rem;
      border-radius: 99px;
      cursor: pointer;
      transition: background 0.2s;
      white-space: nowrap;
    }
    .chat-suggestion-btn:hover { background: #3b82f628; }
    #makouez-chat-input-row {
      padding: 0.75rem 1rem;
      border-top: 1px solid #ffffff14;
      display: flex;
      gap: 0.5rem;
      align-items: center;
    }
    #makouez-chat-input {
      flex: 1;
      background: #ffffff08;
      border: 1px solid #ffffff14;
      border-radius: 8px;
      padding: 0.55rem 0.85rem;
      color: #f0f0ff;
      font-family: 'DM Sans', sans-serif;
      font-size: 0.85rem;
      outline: none;
      transition: border-color 0.2s;
      resize: none;
      height: 36px;
      max-height: 100px;
    }
    #makouez-chat-input:focus { border-color: #3b82f660; }
    #makouez-chat-input::placeholder { color: #8888aa; }
    #makouez-chat-send {
      width: 34px; height: 34px;
      border-radius: 8px;
      background: #3b82f6;
      border: none;
      color: #fff;
      font-size: 0.9rem;
      cursor: pointer;
      transition: opacity 0.2s;
      flex-shrink: 0;
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
    <div id="makouez-chat-tooltip">Posez vos questions à notre assistant</div>
    <button id="makouez-chat-btn" onclick="window.makouezChatToggle()" aria-label="Ouvrir le chat">
      💬
      <div id="makouez-chat-notif"></div>
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
      <button class="chat-close-btn" onclick="window.makouezChatToggle()">✕</button>
    </div>
    <div id="makouez-chat-messages"></div>
    <div class="chat-suggestions" id="chatSuggestions"></div>
    <div id="makouez-chat-input-row">
      <textarea id="makouez-chat-input" placeholder="Posez votre question…" rows="1"></textarea>
      <button id="makouez-chat-send" onclick="window.makouezChatSend()">➤</button>
    </div>
  `;

  document.body.appendChild(fab);
  document.body.appendChild(win);

  // ─── LOGIQUE ───────────────────────────────────────────────────────────────
  let isOpen     = false;
  let isLoading  = false;
  let messages   = []; // historique pour l'API
  let hasOpened  = false;

  const suggestions = [
    'Quels sont vos tarifs ?',
    'Vous intervenez où ?',
    'Comment prendre RDV ?',
    'Qu\'est-ce que le Contrat Sérénité ?',
    'Mon PC est lent, vous pouvez aider ?',
  ];

  function renderSuggestions() {
    const el = document.getElementById('chatSuggestions');
    if (messages.length > 1) { el.innerHTML = ''; return; }
    el.innerHTML = suggestions.map(s =>
      `<button class="chat-suggestion-btn" onclick="window.makouezChatSendText('${s}')">${s}</button>`
    ).join('');
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

  window.makouezChatToggle = function() {
    isOpen = !isOpen;
    const chatWin = document.getElementById('makouez-chat-window');
    chatWin.classList.toggle('open', isOpen);
    document.getElementById('makouez-chat-btn').textContent = isOpen ? '✕' : '💬';
    if (isOpen) {
      // Supprimer la notification
      const notif = document.getElementById('makouez-chat-notif');
      if (notif) notif.remove();
      // Message de bienvenue au premier ouverture
      if (!hasOpened) {
        hasOpened = true;
        setTimeout(() => {
          addMessage('Bonjour ! 👋 Je suis l\'assistant de Makouez IT. Comment puis-je vous aider ? Je peux répondre à vos questions sur nos services, tarifs et disponibilités.', 'bot');
          renderSuggestions();
        }, 300);
      }
      setTimeout(() => document.getElementById('makouez-chat-input').focus(), 400);
    } else {
      document.getElementById('makouez-chat-btn').innerHTML = '💬';
    }
  };

  window.makouezChatSendText = function(text) {
    document.getElementById('makouez-chat-input').value = text;
    window.makouezChatSend();
  };

  window.makouezChatSend = async function() {
    const input = document.getElementById('makouez-chat-input');
    const text  = input.value.trim();
    if (!text || isLoading) return;

    input.value = '';
    input.style.height = '36px';
    isLoading = true;
    document.getElementById('makouez-chat-send').disabled = true;

    // Affiche le message utilisateur
    addMessage(text, 'user');
    document.getElementById('chatSuggestions').innerHTML = '';

    // Ajoute au contexte
    messages.push({ role: 'user', content: text });

    // Indicateur typing
    showTyping();

    try {
      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': API_KEY,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 300,
          system: SYSTEM_PROMPT,
          messages: messages
        })
      });

      const data = await response.json();
      removeTyping();

      if (data.content && data.content[0]) {
        const reply = data.content[0].text;
        addMessage(reply, 'bot');
        messages.push({ role: 'assistant', content: reply });
      } else {
        addMessage('Désolé, je n\'ai pas pu répondre. Contactez directement Stevy au 06 19 51 57 56.', 'bot');
      }
    } catch(e) {
      removeTyping();
      addMessage('Une erreur est survenue. Contactez Stevy directement au 06 19 51 57 56 ou sur WhatsApp.', 'bot');
    }

    isLoading = false;
    document.getElementById('makouez-chat-send').disabled = false;
    input.focus();
  };

  // Entrée pour envoyer
  document.getElementById('makouez-chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      window.makouezChatSend();
    }
  });

  // Auto-resize textarea
  document.getElementById('makouez-chat-input').addEventListener('input', function() {
    this.style.height = '36px';
    this.style.height = Math.min(this.scrollHeight, 100) + 'px';
  });

  // Afficher la notification après 5 secondes
  setTimeout(() => {
    if (!isOpen && !hasOpened) {
      const notif = document.getElementById('makouez-chat-notif');
      if (notif) notif.style.display = 'block';
    }
  }, 5000);

})();
