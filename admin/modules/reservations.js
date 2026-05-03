// ─────────────────────────────────────────────────────────────────────────────
// reservations.js — Liste des RDV, filtres, modale détail, actions
// (confirmer / terminer / annuler / supprimer / envoyer rappel).
// ─────────────────────────────────────────────────────────────────────────────

import { db, fns, callSendReminder } from '../core/firebase.js';
import { store, emit, on } from '../core/store.js';
import { formatDateLong } from '../core/ui.js';

let currentFilter = 'all';

// ─── Chargement initial ───────────────────────────────────────────────────
export async function loadAll() {
  try {
    const { collection, getDocs, query, orderBy } = fns;
    const q = query(collection(db, 'reservations'), orderBy('dateKey', 'asc'));
    const snap = await getDocs(q);

    store.allRdvs = [];
    snap.forEach((d) => store.allRdvs.push({ id: d.id, ...d.data() }));
    store.allRdvs.sort((a, b) =>
      a.dateKey + a.time < b.dateKey + b.time ? -1 : 1,
    );

    document.getElementById('lastRefresh').textContent =
      'Mis à jour ' +
      new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

    emit('rdvs:changed');
  } catch (e) {
    document.getElementById('rdvList').innerHTML =
      '<div class="empty-state"><div class="empty-icon">⚠️</div>Erreur de chargement.</div>';
  }
}

// ─── Filtres ──────────────────────────────────────────────────────────────
function setFilter(f, btn) {
  currentFilter = f;
  document
    .querySelectorAll('#tab-reservations .tab-filter')
    .forEach((t) => t.classList.remove('active'));
  btn.classList.add('active');
  renderRdvs();
}

// ─── Rendu de la liste ────────────────────────────────────────────────────
export function renderRdvs() {
  let filtered;
  if (currentFilter === 'modified')
    filtered = store.allRdvs.filter((r) => r.status === 'pending' && r.modificationNote);
  else if (currentFilter === 'all') filtered = store.allRdvs;
  else filtered = store.allRdvs.filter((r) => r.status === currentFilter);

  const list = document.getElementById('rdvList');
  if (!list) return;

  if (filtered.length === 0) {
    list.innerHTML =
      '<div class="empty-state"><div class="empty-icon">📭</div>Aucun rendez-vous dans cette catégorie</div>';
    return;
  }

  const badgeMap = {
    pending: 'badge-pending',
    confirmed: 'badge-confirmed',
    cancelled: 'badge-cancelled',
    done: 'badge-done',
  };
  const labelMap = {
    pending: '⏳ En attente',
    confirmed: '✓ Confirmé',
    cancelled: '✗ Annulé',
    done: '✓ Terminé',
  };

  list.innerHTML = '';
  filtered.forEach((rdv) => {
    const hasModif = rdv.modificationNote && rdv.status === 'pending';
    const dateLabel = rdv.dateKey ? formatDateLong(rdv.dateKey) : rdv.dateKey;

    const card = document.createElement('div');
    card.className =
      'rdv-card' +
      (rdv.status === 'confirmed' ? ' confirmed' : '') +
      (rdv.status === 'cancelled' ? ' cancelled' : '') +
      (hasModif ? ' modified' : '');

    card.innerHTML = `
      <div class="rdv-top">
        <div class="rdv-service">${rdv.service || '–'}</div>
        <div class="rdv-badges">
          ${hasModif ? `<div class="badge-modif">✏️ Modification</div>` : ''}
          <div class="rdv-badge ${badgeMap[rdv.status] || 'badge-pending'}">${labelMap[rdv.status] || rdv.status}</div>
        </div>
      </div>
      <div class="rdv-info">
        <div class="rdv-info-item"><div class="rdv-info-label">📅 Date</div><div>${dateLabel}</div></div>
        <div class="rdv-info-item"><div class="rdv-info-label">🕐 Plage</div><div>${rdv.timeLabel || rdv.time || '–'}</div></div>
        <div class="rdv-info-item"><div class="rdv-info-label">👤 Client</div><div>${rdv.nom || '–'}</div></div>
        <div class="rdv-info-item"><div class="rdv-info-label">📞 Téléphone</div><div>${rdv.telephone || '–'}</div></div>
        <div class="rdv-info-item"><div class="rdv-info-label">📧 Email</div><div>${rdv.email || '–'}</div></div>
        <div class="rdv-info-item"><div class="rdv-info-label">💰 Tarif</div><div>${rdv.price || '–'}</div></div>
        <div class="rdv-info-item" style="grid-column:1/-1"><div class="rdv-info-label">📍 Adresse</div><div>${rdv.adresse || '–'}</div></div>
      </div>
      ${rdv.description ? `<div class="rdv-desc">💬 ${rdv.description}</div>` : ''}
      ${hasModif ? `<div class="rdv-modif-note"><span>✏️</span><div><strong>Message du client :</strong> ${rdv.modificationNote}</div></div>` : ''}
      <div class="rdv-actions">
        ${rdv.status === 'pending' ? `<button class="btn-confirm" onclick="updateStatus('${rdv.id}','confirmed')">✓ Confirmer</button>` : ''}
        ${rdv.status === 'confirmed' ? `<button class="btn-done" onclick="updateStatus('${rdv.id}','done')">✓ Terminé</button>` : ''}
        ${rdv.status !== 'cancelled'
          ? `<button class="btn-cancel" onclick="updateStatus('${rdv.id}','cancelled')">✗ Annuler</button>`
          : `<button class="btn-cancel" onclick="deleteRdv('${rdv.id}')">🗑 Supprimer</button>`}
        ${rdv.status !== 'cancelled' && rdv.status !== 'done'
          ? `<div style="display:flex;flex-direction:column;flex:1;min-width:0">
              <button class="btn-reminder" data-reminder-id="${rdv.id}" onclick="sendReminder('${rdv.id}')">📧 ${rdv.reminderSent ? 'Renvoyer rappel' : 'Envoyer rappel'}</button>
              ${rdv.reminderSent && rdv.reminderSentAt?.toDate
                ? `<div class="reminder-status">Dernier envoi : ${rdv.reminderSentAt.toDate().toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</div>`
                : ''}
            </div>`
          : ''}
      </div>`;
    list.appendChild(card);
  });
}

// ─── Modale de détail ─────────────────────────────────────────────────────
export function openRdvModal(r) {
  const dateLabel = r.dateKey ? formatDateLong(r.dateKey) : '–';
  const badgeMap = {
    pending: 'badge-pending',
    confirmed: 'badge-confirmed',
    cancelled: 'badge-cancelled',
    done: 'badge-done',
  };
  const labelMap = {
    pending: '⏳ En attente',
    confirmed: '✓ Confirmé',
    cancelled: '✗ Annulé',
    done: '✓ Terminé',
  };

  document.getElementById('modalTitle').innerHTML = `${r.service || '–'} <span class="rdv-badge ${badgeMap[r.status] || 'badge-pending'}" style="font-size:0.7rem;vertical-align:middle">${labelMap[r.status] || r.status}</span>`;

  document.getElementById('modalBody').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:0.5rem">
      <div class="modal-info-row"><span class="modal-info-icon">👤</span><div class="modal-info-val"><strong>${r.nom || '–'}</strong></div></div>
      <div class="modal-info-row"><span class="modal-info-icon">📞</span><div class="modal-info-val">${r.telephone || '–'}</div></div>
      <div class="modal-info-row"><span class="modal-info-icon">📧</span><div class="modal-info-val">${r.email || '–'}</div></div>
      <div class="modal-info-row"><span class="modal-info-icon">📅</span><div class="modal-info-val">${dateLabel}</div></div>
      <div class="modal-info-row"><span class="modal-info-icon">🕐</span><div class="modal-info-val">${r.timeLabel || r.time || '–'}</div></div>
      <div class="modal-info-row"><span class="modal-info-icon">📍</span><div class="modal-info-val">${r.adresse || '–'}</div></div>
      ${r.description ? `<div class="modal-info-row"><span class="modal-info-icon">💬</span><div class="modal-info-val">${r.description}</div></div>` : ''}
    </div>`;

  const actions = document.getElementById('modalActions');
  actions.innerHTML = '';
  if (r.status === 'pending') {
    const b = document.createElement('button');
    b.className = 'btn-confirm';
    b.textContent = '✓ Confirmer';
    b.onclick = () => { updateStatus(r.id, 'confirmed'); closeModal(); };
    actions.appendChild(b);
  }
  if (r.status === 'confirmed') {
    const b = document.createElement('button');
    b.className = 'btn-done';
    b.textContent = '✓ Terminé';
    b.onclick = () => { updateStatus(r.id, 'done'); closeModal(); };
    actions.appendChild(b);
  }
  if (r.status !== 'cancelled') {
    const b = document.createElement('button');
    b.className = 'btn-cancel';
    b.textContent = '✗ Annuler';
    b.onclick = () => { updateStatus(r.id, 'cancelled'); closeModal(); };
    actions.appendChild(b);
  }

  document.getElementById('rdvModal').classList.add('show');
}

function closeModal() {
  document.getElementById('rdvModal').classList.remove('show');
}

// ─── Mutations ────────────────────────────────────────────────────────────
async function updateStatus(id, status) {
  try {
    const { doc, updateDoc } = fns;
    const upd = { status };
    if (status === 'confirmed') upd.modificationNote = null;
    await updateDoc(doc(db, 'reservations', id), upd);
    const rdv = store.allRdvs.find((r) => r.id === id);
    if (rdv) {
      rdv.status = status;
      if (status === 'confirmed') rdv.modificationNote = null;
    }
    emit('rdvs:changed');
  } catch (e) {
    alert('Erreur lors de la mise à jour.');
  }
}

async function deleteRdv(id) {
  if (!confirm('Supprimer définitivement ce rendez-vous ?')) return;
  try {
    const { doc, deleteDoc } = fns;
    await deleteDoc(doc(db, 'reservations', id));
    store.allRdvs = store.allRdvs.filter((r) => r.id !== id);
    emit('rdvs:changed');
  } catch (e) {
    alert('Erreur lors de la suppression.');
  }
}

// ─── Rappel email manuel (Cloud Function callable) ───────────────────────
async function sendReminder(rdvId) {
  const rdv = store.allRdvs.find((r) => r.id === rdvId);
  if (!rdv) return;

  if (rdv.reminderSent) {
    const lastSent = rdv.reminderSentAt?.toDate?.();
    const lastSentStr = lastSent
      ? lastSent.toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
      : 'une date inconnue';
    const confirmed = confirm(`Un rappel a déjà été envoyé le ${lastSentStr}.\nConfirmer le renvoi ?`);
    if (!confirmed) return;
  }

  const btn = document.querySelector(`[data-reminder-id="${rdvId}"]`);
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Envoi en cours…';
  }

  try {
    await callSendReminder({ rdvId });
    if (btn) {
      btn.textContent = '✅ Rappel envoyé !';
      btn.style.color = 'var(--success)';
    }
    const r = store.allRdvs.find((x) => x.id === rdvId);
    if (r) {
      r.reminderSent = true;
      r.reminderSentAt = { toDate: () => new Date() };
      r.reminderSendCount = (r.reminderSendCount || 0) + 1;
    }
    setTimeout(() => renderRdvs(), 2500);
  } catch (e) {
    console.error('Erreur envoi rappel:', e);
    if (btn) {
      btn.disabled = false;
      btn.textContent = '❌ Échec – Réessayer';
      btn.style.color = 'var(--danger)';
    }
    const msg = e?.message || 'Erreur inconnue';
    alert(`Impossible d\'envoyer le rappel.\n${msg}`);
    setTimeout(() => renderRdvs(), 3000);
  }
}

// ─── Souscriptions ────────────────────────────────────────────────────────
on('rdvs:changed', renderRdvs);

// Modale : fermeture au clic sur l'overlay (le handler est posé une fois,
// après que le DOM ait été parsé — admin/main.js est chargé en bas de body).
document.getElementById('rdvModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'rdvModal') closeModal();
});

// ─── Compat handlers inline ───────────────────────────────────────────────
window.loadAll       = loadAll;
window.setFilter     = setFilter;
window.openRdvModal  = openRdvModal;
window.closeModal    = closeModal;
window.updateStatus  = updateStatus;
window.deleteRdv     = deleteRdv;
window.sendReminder  = sendReminder;
