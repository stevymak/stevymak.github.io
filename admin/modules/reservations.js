// ─────────────────────────────────────────────────────────────────────────────
// reservations.js — Liste des RDV, filtres, modale détail, actions
// (confirmer / terminer / annuler / supprimer / envoyer rappel).
// Inclut la création / édition d'un RDV directement depuis l'admin.
// ─────────────────────────────────────────────────────────────────────────────

import { db, fns, callSendReminder } from '../core/firebase.js';
import { store, emit, on } from '../core/store.js';
import { formatDateLong } from '../core/ui.js';
import { promptInput } from '../core/prompt.js';

const SERVICES = [
  'Dépannage informatique',
  'Installation / Configuration PC',
  'Récupération de données',
  'Installation réseau & Wi-Fi',
  'Formation informatique',
  'Sauvegardes & Sécurité',
  'Audit sécurité TPE',
  'Intervention ponctuelle Pro',
  'Maintenance contrat Pro',
  'Intégration / Développement web',
];

// ID en cours d'édition (null = création)
let _editingRdvId = null;

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
        <div class="rdv-info-item"><div class="rdv-info-label">💰 Tarif</div><div>${formatRdvPrix(rdv)}</div></div>
        <div class="rdv-info-item" style="grid-column:1/-1"><div class="rdv-info-label">📍 Adresse</div><div>${rdv.adresse || '–'}</div></div>
      </div>
      ${rdv.description ? `<div class="rdv-desc">💬 ${rdv.description}</div>` : ''}
      ${hasModif ? `<div class="rdv-modif-note"><span>✏️</span><div><strong>Message du client :</strong> ${rdv.modificationNote}</div></div>` : ''}
      <div class="rdv-actions">
        ${rdv.status === 'pending' ? `<button class="btn-confirm" onclick="updateStatus('${rdv.id}','confirmed')">✓ Confirmer</button>` : ''}
        ${rdv.status === 'confirmed' ? `<button class="btn-done" onclick="updateStatus('${rdv.id}','done')">✓ Terminé</button>` : ''}
        ${rdv.status === 'done' ? `<button class="btn-soft" onclick="editPrixReel('${rdv.id}')">✏️ Prix facturé</button>` : ''}
        <button class="btn-soft" onclick="openEditRdvForm('${rdv.id}')" title="Modifier ce RDV">✏️ Éditer</button>
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

// ─── Helpers ──────────────────────────────────────────────────────────────
function formatRdvPrix(rdv) {
  if (typeof rdv.prixReel === 'number' && Number.isFinite(rdv.prixReel)) {
    return rdv.prixReel + ' € <span style="color:var(--muted);font-size:0.7rem">facturé</span>';
  }
  return rdv.price || '–';
}

// ─── Mutations ────────────────────────────────────────────────────────────
async function updateStatus(id, status) {
  try {
    const { doc, updateDoc } = fns;
    const rdv = store.allRdvs.find((r) => r.id === id);

    let prixReel = null;
    if (status === 'done') {
      const fallback = (typeof rdv?.prixReel === 'number') ? rdv.prixReel : 70;
      prixReel = await promptInput({
        title: '✓ Marquer terminé',
        message: 'Prix réel facturé pour cette intervention ? (utilisé pour le suivi du CA)',
        type: 'number',
        defaultValue: fallback,
        unit: '€',
        min: 0,
        step: 1,
        confirmLabel: 'Valider et terminer',
      });
      if (prixReel === null) return; // annulation utilisateur
    }

    const upd = { status };
    if (status === 'confirmed') upd.modificationNote = null;
    if (status === 'done')      upd.prixReel = prixReel;

    await updateDoc(doc(db, 'reservations', id), upd);

    if (rdv) {
      rdv.status = status;
      if (status === 'confirmed') rdv.modificationNote = null;
      if (status === 'done')      rdv.prixReel = prixReel;
    }
    emit('rdvs:changed');
  } catch (e) {
    console.error(e);
    alert('Erreur lors de la mise à jour.');
  }
}

async function editPrixReel(id) {
  const rdv = store.allRdvs.find((r) => r.id === id);
  if (!rdv) return;
  const fallback = (typeof rdv.prixReel === 'number') ? rdv.prixReel : 70;
  const prixReel = await promptInput({
    title: '✏️ Modifier le prix facturé',
    message: 'Saisis le prix réellement facturé pour cette intervention.',
    type: 'number',
    defaultValue: fallback,
    unit: '€',
    min: 0,
    step: 1,
  });
  if (prixReel === null) return;
  try {
    const { doc, updateDoc } = fns;
    await updateDoc(doc(db, 'reservations', id), { prixReel });
    rdv.prixReel = prixReel;
    emit('rdvs:changed');
  } catch (e) {
    console.error(e);
    alert('Erreur lors de la mise à jour du prix.');
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

// ─── Création / Édition RDV depuis l'admin ───────────────────────────────

export function openCreateRdvForm(prefillDateKey = '') {
  _openRdvForm(null, prefillDateKey);
}

export function openEditRdvForm(id) {
  const rdv = store.allRdvs.find((r) => r.id === id);
  if (rdv) _openRdvForm(rdv, '');
}

function _openRdvForm(rdv, prefillDateKey) {
  _editingRdvId = rdv?.id || null;
  const isEdit  = !!rdv;

  // Titre + libellé bouton
  document.getElementById('rdvFormTitle').textContent   = isEdit ? '✏️ Modifier le RDV' : '+ Nouveau rendez-vous';
  document.getElementById('rdvFormSubmit').textContent  = isEdit ? 'Enregistrer les modifications' : 'Créer le rendez-vous';
  document.getElementById('rdvFormSubmit').disabled     = false;
  document.getElementById('rdvFormErr').style.display   = 'none';

  // Pré-remplissage champs
  document.getElementById('rfService').value   = rdv?.service   || '';
  document.getElementById('rfNom').value       = rdv?.nom       || '';
  document.getElementById('rfTel').value       = rdv?.telephone || '';
  document.getElementById('rfEmail').value     = rdv?.email     || '';
  document.getElementById('rfAdresse').value   = rdv?.adresse   || '';
  document.getElementById('rfDate').value      = rdv?.dateKey   || prefillDateKey || '';
  document.getElementById('rfTime').value      = rdv?.time      || '09:00';
  document.getElementById('rfTimeLabel').value = rdv?.timeLabel || '';
  document.getElementById('rfPrice').value     = rdv?.price     || '';
  document.getElementById('rfDesc').value      = rdv?.description || '';
  document.getElementById('rfStatus').value    = rdv?.status    || 'pending';

  // Remplir la datalist Services
  const svcList = document.getElementById('rfServiceList');
  svcList.innerHTML = SERVICES.map((s) => `<option value="${s}">`).join('');

  // Remplir la datalist Clients depuis les RDV existants
  const names = [...new Set(store.allRdvs.map((r) => r.nom).filter(Boolean))].sort();
  document.getElementById('rfNomList').innerHTML = names.map((n) => `<option value="${n}">`).join('');

  document.getElementById('rdvCreateModal').classList.add('show');
  document.body.style.overflow = 'hidden';
  // Focus sur le service si création
  if (!isEdit) setTimeout(() => document.getElementById('rfService').focus(), 60);
}

function _closeRdvCreateModal() {
  document.getElementById('rdvCreateModal').classList.remove('show');
  document.body.style.overflow = '';
  _editingRdvId = null;
}

async function _submitRdvForm() {
  const btn    = document.getElementById('rdvFormSubmit');
  const errEl  = document.getElementById('rdvFormErr');
  const isEdit = !!_editingRdvId;

  const service     = document.getElementById('rfService').value.trim();
  const nom         = document.getElementById('rfNom').value.trim();
  const telephone   = document.getElementById('rfTel').value.trim();
  const email       = document.getElementById('rfEmail').value.trim().toLowerCase();
  const adresse     = document.getElementById('rfAdresse').value.trim();
  const dateKey     = document.getElementById('rfDate').value;
  const time        = document.getElementById('rfTime').value;
  const timeLabel   = document.getElementById('rfTimeLabel').value.trim() || time;
  const price       = document.getElementById('rfPrice').value.trim() || null;
  const description = document.getElementById('rfDesc').value.trim()  || null;
  const status      = document.getElementById('rfStatus').value;

  if (!service || !nom || !dateKey || !time) {
    errEl.textContent    = 'Les champs Service, Nom, Date et Heure sont obligatoires.';
    errEl.style.display  = 'block';
    return;
  }

  btn.disabled     = true;
  btn.textContent  = isEdit ? 'Enregistrement…' : 'Création en cours…';
  errEl.style.display = 'none';

  try {
    const { doc, updateDoc, addDoc, collection, serverTimestamp } = fns;

    const data = {
      service, nom, telephone, email, adresse,
      dateKey, time, timeLabel, price,
      description, status,
      source: 'admin',
    };

    if (isEdit) {
      await updateDoc(doc(db, 'reservations', _editingRdvId), data);
      const idx = store.allRdvs.findIndex((r) => r.id === _editingRdvId);
      if (idx !== -1) store.allRdvs[idx] = { ...store.allRdvs[idx], ...data };
    } else {
      data.createdAt = serverTimestamp();
      const ref = await addDoc(collection(db, 'reservations'), data);
      store.allRdvs.push({ id: ref.id, ...data });
    }

    // Re-tri chronologique
    store.allRdvs.sort((a, b) => (a.dateKey + a.time < b.dateKey + b.time ? -1 : 1));

    _closeRdvCreateModal();
    emit('rdvs:changed');
  } catch (e) {
    console.error(e);
    btn.disabled    = false;
    btn.textContent = isEdit ? 'Enregistrer les modifications' : 'Créer le rendez-vous';
    errEl.textContent   = 'Erreur Firebase : ' + (e.message || 'inconnue');
    errEl.style.display = 'block';
  }
}

// Fermeture sur clic overlay
document.getElementById('rdvCreateModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'rdvCreateModal') _closeRdvCreateModal();
});

// ─── Compat handlers inline ───────────────────────────────────────────────
window.loadAll            = loadAll;
window.setFilter          = setFilter;
window.openRdvModal       = openRdvModal;
window.closeModal         = closeModal;
window.updateStatus       = updateStatus;
window.deleteRdv          = deleteRdv;
window.sendReminder       = sendReminder;
window.editPrixReel       = editPrixReel;
window.openCreateRdvForm  = openCreateRdvForm;
window.openEditRdvForm    = openEditRdvForm;
window.closeRdvCreateModal = _closeRdvCreateModal;
window.submitRdvForm      = _submitRdvForm;
