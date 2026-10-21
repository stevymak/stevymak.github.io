// ─────────────────────────────────────────────────────────────────────────────
// messages.js — Boîte de réception (21/10/2026) : messages envoyés depuis
// l'espace client (questions, résiliations, suppression de compte) et
// demandes de rappel du formulaire de l'accueil. Avant, ces documents étaient
// enregistrés sans jamais être affichés dans l'admin.
// ─────────────────────────────────────────────────────────────────────────────

import { db, fns } from '../core/firebase.js';
import { setSidebarBadge } from '../core/ui.js';
import { esc, jsArg } from '../core/escape.js';

let items = [];
let filtre = 'nonlus';

const SUJETS = {
  'question-rdv': 'Question sur un rendez-vous', 'question-contrat': 'Question sur un contrat',
  modification: 'Demande de modification', resiliation: 'Résiliation de contrat', urgence: 'Problème urgent',
  'suppression-compte': 'Suppression de compte (RGPD)', autre: 'Autre',
};
const ms = (v) => (v?.toMillis ? v.toMillis() : (typeof v === 'string' ? Date.parse(v) : 0)) || 0;
const quand = (v) => { const t = ms(v); return t ? new Date(t).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' }) : '–'; };

export async function loadMessages() {
  const { collection, getDocs } = fns;
  const out = [];
  try {
    const s = await getDocs(collection(db, 'messages_clients'));
    s.docs.forEach((d) => { const m = d.data(); out.push({ id: d.id, col: 'messages_clients', lu: !!m.lu, at: m.createdAt,
      titre: SUJETS[m.sujet] || m.sujet || 'Message', qui: m.email || '–', texte: m.texte || '', urgent: ['urgence', 'resiliation', 'suppression-compte'].includes(m.sujet) }); });
  } catch (e) { console.error('messages_clients', e); }
  try {
    const s = await getDocs(collection(db, 'rappels'));
    s.docs.forEach((d) => { const r = d.data(); out.push({ id: d.id, col: 'rappels', lu: r.statut === 'traite', at: r.createdAt,
      titre: `📞 Rappel demandé – ${r.besoin || ''}`, qui: `${r.prenom || ''} · ${r.telephone || ''}`, tel: r.telephone, texte: '', urgent: false }); });
  } catch (e) { console.error('rappels', e); }
  items = out.sort((a, b) => ms(b.at) - ms(a.at));
  render();
}

function render() {
  const nonLus = items.filter((i) => !i.lu).length;
  setSidebarBadge('messages', nonLus);
  const list = document.getElementById('messagesList');
  if (!list) return;
  const vis = filtre === 'nonlus' ? items.filter((i) => !i.lu) : items;
  document.getElementById('messagesCount').textContent = `${nonLus} non lu${nonLus > 1 ? 's' : ''} · ${items.length} au total`;
  list.innerHTML = vis.length ? vis.map((i) => `
    <div class="rdv-card" style="${i.lu ? 'opacity:.65' : ''}${i.urgent && !i.lu ? ';border-color:#f97316' : ''}">
      <div style="flex:1;min-width:0">
        <div style="font-weight:700">${esc(i.titre)}</div>
        <div style="font-size:.85rem;color:var(--muted)">${esc(i.qui)} · ${esc(quand(i.at))}</div>
        ${i.texte ? `<div style="margin-top:.4rem;white-space:pre-line">${esc(i.texte)}</div>` : ''}
      </div>
      <div style="display:flex;gap:.4rem;flex-wrap:wrap;align-items:flex-start">
        ${i.tel ? `<a class="btn-confirm" href="tel:${esc(String(i.tel).replace(/[^\d+]/g, ''))}" style="text-decoration:none">Appeler</a>` : ''}
        ${i.col === 'messages_clients' && i.qui !== '–' ? `<a class="btn-done" href="mailto:${esc(i.qui)}" style="text-decoration:none">Répondre</a>` : ''}
        <button class="btn-cancel" onclick="toggleMessageLu(${jsArg(i.col)}, ${jsArg(i.id)})">${i.lu ? 'Marquer non lu' : 'Marquer traité'}</button>
      </div>
    </div>`).join('') : '<div class="empty-state" style="padding:1.5rem;color:var(--muted)">Aucun message.</div>';
}

async function toggleMessageLu(col, id) {
  const it = items.find((x) => x.col === col && x.id === id);
  if (!it) return;
  const { doc, updateDoc } = fns;
  try {
    const nv = !it.lu;
    await updateDoc(doc(db, col, id), col === 'rappels' ? { statut: nv ? 'traite' : 'nouveau' } : { lu: nv });
    it.lu = nv; render();
  } catch (e) { alert('Mise à jour impossible : ' + (e?.message || e)); }
}
function setMessagesFiltre(f, btn) {
  filtre = f;
  document.querySelectorAll('#tab-messages .tab-filter').forEach((b) => b.classList.remove('active'));
  btn?.classList.add('active');
  render();
}

window.toggleMessageLu = toggleMessageLu;
window.setMessagesFiltre = setMessagesFiltre;
window.loadMessages = loadMessages;
