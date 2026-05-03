// ─────────────────────────────────────────────────────────────────────────────
// contrats.js — Demandes de contrats récurrents (Sérénité / Senior+ / Famille).
// Affiche les stats, le MRR, la liste filtrée, et permet de basculer le statut
// (new → contacted → active) ou de résilier / supprimer.
// ─────────────────────────────────────────────────────────────────────────────

import { db, fns } from '../core/firebase.js';
import { store, emit, on } from '../core/store.js';
import {
  CONTRAT_LABELS,
  CONTRAT_TARIFS,
  CONTRAT_PILLS,
  setSidebarBadge,
} from '../core/ui.js';

let currentContratFilter = 'all';

// ─── Chargement initial ───────────────────────────────────────────────────
export async function loadContrats() {
  try {
    const { collection, getDocs, query, orderBy } = fns;
    const q = query(collection(db, 'contrats'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    store.allContrats = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    emit('contrats:changed');
  } catch (e) {
    document.getElementById('contratsList').innerHTML =
      '<div class="empty-state"><div class="empty-icon">⚠️</div>Erreur de chargement.</div>';
  }
}

// ─── Stats + MRR + badge ──────────────────────────────────────────────────
function updateContratStats() {
  const { allContrats } = store;

  const n  = allContrats.filter((c) => c.status === 'new').length;
  const ct = allContrats.filter((c) => c.status === 'contacted').length;
  const ac = allContrats.filter((c) => c.status === 'active').length;
  const ca = allContrats.filter((c) => c.status === 'cancelled').length;

  document.getElementById('cStatNew').textContent       = n;
  document.getElementById('cStatContacted').textContent = ct;
  document.getElementById('cStatActive').textContent    = ac;
  document.getElementById('cStatCancelled').textContent = ca;
  const dashStat = document.getElementById('statContratsActifs');
  if (dashStat) dashStat.textContent = ac;

  let mrr = 0;
  const breakdown = { serenite: 0, senior: 0, famille: 0 };
  allContrats
    .filter((c) => c.status === 'active')
    .forEach((c) => {
      mrr += CONTRAT_TARIFS[c.contrat] || 0;
      if (breakdown[c.contrat] !== undefined) breakdown[c.contrat]++;
    });

  document.getElementById('mrrVal').textContent = mrr + '€';
  document.getElementById('mrrSub').textContent =
    ac > 0 ? `${ac} contrat${ac > 1 ? 's' : ''} actif${ac > 1 ? 's' : ''}` : 'Aucun contrat actif';

  const colors = { serenite: '#3b82f6', senior: '#f59e0b', famille: '#22c55e' };
  document.getElementById('mrrBreakdown').innerHTML = Object.entries(breakdown)
    .filter(([, count]) => count > 0)
    .map(
      ([k, count]) => `
        <div class="mrr-line">
          <div class="mrr-dot" style="background:${colors[k]}"></div>
          <span style="color:var(--muted)">${CONTRAT_LABELS[k]}</span>
          <span style="margin-left:auto;font-weight:600">${count}×${CONTRAT_TARIFS[k]}€</span>
        </div>`,
    )
    .join('');

  setSidebarBadge('contrats', n);
}

// ─── Filtres ──────────────────────────────────────────────────────────────
function setContratFilter(f, btn) {
  currentContratFilter = f;
  document
    .querySelectorAll('#tab-contrats .tab-filter')
    .forEach((t) => t.classList.remove('active'));
  btn.classList.add('active');
  renderContrats();
}

// ─── Rendu liste ──────────────────────────────────────────────────────────
function renderContrats() {
  const filtered =
    currentContratFilter === 'all'
      ? store.allContrats
      : store.allContrats.filter((c) => c.status === currentContratFilter);

  const list = document.getElementById('contratsList');
  if (!list) return;

  if (filtered.length === 0) {
    list.innerHTML =
      '<div class="empty-state"><div class="empty-icon">📄</div>Aucune demande dans cette catégorie.</div>';
    return;
  }

  const statusMap = {
    new: '🆕 Nouvelle',
    contacted: '📞 Contacté',
    active: '✅ Actif',
    cancelled: 'Résilié',
  };
  const badgeMap = {
    new: 'badge-new-contrat',
    contacted: 'badge-contacted',
    active: 'badge-active-c',
    cancelled: 'badge-resilie',
  };

  list.innerHTML = '';
  filtered.forEach((c) => {
    const date = c.createdAt?.toDate
      ? c.createdAt.toDate().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
      : '–';
    const dateAct = c.dateActive?.toDate
      ? c.dateActive.toDate().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
      : null;
    const label = CONTRAT_LABELS[c.contrat] || c.contrat || '–';
    const tarif = CONTRAT_TARIFS[c.contrat] ? CONTRAT_TARIFS[c.contrat] + '€/mois' : '–';
    const pill  = CONTRAT_PILLS[c.contrat] || '';

    const card = document.createElement('div');
    card.className = `contrat-card-admin ${c.status}`;
    card.innerHTML = `
      <div class="contrat-top">
        <div class="contrat-name">${c.nom || '–'} <span class="contrat-pill ${pill}">${label}</span></div>
        <div class="rdv-badges">
          <div class="rdv-badge ${badgeMap[c.status] || ''}">${statusMap[c.status] || c.status}</div>
          ${c.status === 'active'
            ? `<div class="rdv-badge" style="background:#a855f715;color:#a855f7;border:1px solid #a855f730">${tarif}</div>`
            : ''}
        </div>
      </div>
      <div class="rdv-info">
        <div class="rdv-info-item"><div class="rdv-info-label">📞 Téléphone</div><div>${c.telephone || '–'}</div></div>
        <div class="rdv-info-item"><div class="rdv-info-label">📧 Email</div><div>${c.email || '–'}</div></div>
        <div class="rdv-info-item"><div class="rdv-info-label">📍 Adresse</div><div>${c.adresse || '–'}</div></div>
        <div class="rdv-info-item"><div class="rdv-info-label">📅 Demande reçue</div><div>${date}</div></div>
        ${dateAct ? `<div class="rdv-info-item"><div class="rdv-info-label">✅ Actif depuis</div><div>${dateAct}</div></div>` : ''}
        <div class="rdv-info-item"><div class="rdv-info-label">💰 Tarif</div><div>${tarif}</div></div>
      </div>
      ${c.note ? `<div class="rdv-desc">💬 ${c.note}</div>` : ''}
      <div class="rdv-actions">
        ${c.status === 'new' ? `<button class="btn-purple" onclick="updateContratStatus('${c.id}','contacted')">📞 Marquer contacté</button>` : ''}
        ${c.status === 'contacted' ? `<button class="btn-confirm" onclick="updateContratStatus('${c.id}','active')">✅ Activer le contrat</button>` : ''}
        ${c.status === 'active' ? `<button class="btn-done" onclick="updateContratStatus('${c.id}','contacted')">↩ Repasser en contacté</button>` : ''}
        ${c.status !== 'cancelled'
          ? `<button class="btn-cancel" onclick="updateContratStatus('${c.id}','cancelled')">Résilier</button>`
          : `<button class="btn-cancel" onclick="deleteContrat('${c.id}')">🗑 Supprimer</button>`}
      </div>`;
    list.appendChild(card);
  });
}

// ─── Mutations ────────────────────────────────────────────────────────────
async function updateContratStatus(id, status) {
  try {
    const { doc, updateDoc, serverTimestamp } = fns;
    const upd = { status };
    if (status === 'active') upd.dateActive = serverTimestamp();
    await updateDoc(doc(db, 'contrats', id), upd);

    const c = store.allContrats.find((x) => x.id === id);
    if (c) {
      c.status = status;
      if (status === 'active') c.dateActive = { toDate: () => new Date() };
    }
    emit('contrats:changed');
  } catch (e) {
    alert('Erreur lors de la mise à jour.');
  }
}

async function deleteContrat(id) {
  if (!confirm('Supprimer définitivement cette demande ?')) return;
  try {
    const { doc, deleteDoc } = fns;
    await deleteDoc(doc(db, 'contrats', id));
    store.allContrats = store.allContrats.filter((c) => c.id !== id);
    emit('contrats:changed');
  } catch (e) {
    alert('Erreur lors de la suppression.');
  }
}

// ─── Souscriptions ────────────────────────────────────────────────────────
on('contrats:changed', () => {
  updateContratStats();
  renderContrats();
});

// ─── Compat handlers inline ───────────────────────────────────────────────
window.loadContrats        = loadContrats;
window.setContratFilter    = setContratFilter;
window.updateContratStatus = updateContratStatus;
window.deleteContrat       = deleteContrat;
