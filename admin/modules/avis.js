// ─────────────────────────────────────────────────────────────────────────────
// avis.js — Modération avis (en attente vs publiés). Approuver promeut le doc
// vers la collection `avis`, rejeter / supprimer le retire.
// ─────────────────────────────────────────────────────────────────────────────

import { db, fns } from '../core/firebase.js';
import { store, emit, on } from '../core/store.js';
import { setSidebarBadge } from '../core/ui.js';

// ─── Chargements ──────────────────────────────────────────────────────────
export async function loadAvis() {
  try {
    const { collection, getDocs, query, orderBy } = fns;
    const q = query(collection(db, 'avis'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    store.allAvis = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    emit('avis:changed');
  } catch (e) {
    console.error(e);
  }
}

export async function loadAvisEnAttente() {
  try {
    const { collection, getDocs, query, orderBy } = fns;
    const q = query(collection(db, 'avis_en_attente'), orderBy('createdAt', 'asc'));
    const snap = await getDocs(q);
    store.avisEnAttente = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    emit('avis-attente:changed');
  } catch (e) {
    console.error(e);
  }
}

// ─── Rendus ───────────────────────────────────────────────────────────────
function renderAvisEnAttente() {
  const section = document.getElementById('avisAttenteSection');
  const list    = document.getElementById('avisAttenteList');
  const count   = document.getElementById('avisAttenteCount');
  if (!section || !list || !count) return;

  setSidebarBadge('avis', store.avisEnAttente.length);

  if (store.avisEnAttente.length > 0) {
    section.style.display = 'block';
  } else {
    section.style.display = 'none';
  }
  count.textContent = store.avisEnAttente.length;

  list.innerHTML = store.avisEnAttente
    .map((a) => {
      const stars = '★'.repeat(a.note || 0) + '☆'.repeat(5 - (a.note || 0));
      const date = a.createdAt?.toDate
        ? a.createdAt
            .toDate()
            .toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
        : '';
      return `<div class="avis-attente-card" id="attente-${a.id}">
        <div class="avis-attente-top">
          <div style="display:flex;align-items:center;gap:0.75rem">
            <span style="color:#f59e0b;font-size:0.9rem">${stars}</span>
            <strong style="font-size:0.9rem">${a.nom || '–'}</strong>
            <span style="color:var(--muted);font-size:0.75rem">${date}</span>
          </div>
          <div class="avis-attente-actions">
            <button class="btn-approve" onclick="approuverAvis('${a.id}')">✓ Approuver</button>
            <button class="btn-reject" onclick="rejeterAvis('${a.id}')">✗ Rejeter</button>
          </div>
        </div>
        <div style="color:var(--muted);font-size:0.85rem;font-style:italic">"${a.comment || ''}"</div>
      </div>`;
    })
    .join('');
}

function renderAvis() {
  const list = document.getElementById('avisList');
  const countEl = document.getElementById('avisCount');
  if (!list) return;

  if (countEl) countEl.textContent = store.allAvis.length ? `(${store.allAvis.length} avis)` : '';

  if (store.allAvis.length === 0) {
    list.innerHTML =
      '<div class="empty-state"><div class="empty-icon">⭐</div>Aucun avis publié pour le moment.</div>';
    return;
  }

  list.innerHTML = store.allAvis
    .map((a) => {
      const stars = '★'.repeat(a.note || 0) + '☆'.repeat(5 - (a.note || 0));
      const date = a.createdAt?.toDate
        ? a.createdAt
            .toDate()
            .toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })
        : '';
      return `<div class="avis-admin-card" id="avis-${a.id}">
        <div class="avis-admin-top">
          <div style="display:flex;align-items:center;gap:0.75rem">
            <div class="avis-stars-display">${stars}</div>
            <div class="avis-nom">${a.nom || '–'}</div>
          </div>
          <div style="display:flex;align-items:center;gap:0.75rem">
            <div class="avis-date-text">${date}</div>
            <button class="btn-delete-avis" onclick="deleteAvis('${a.id}')">🗑 Supprimer</button>
          </div>
        </div>
        <div class="avis-comment-text">"${a.comment || ''}"</div>
      </div>`;
    })
    .join('');
}

// ─── Mutations ────────────────────────────────────────────────────────────
async function approuverAvis(id) {
  const avis = store.avisEnAttente.find((a) => a.id === id);
  if (!avis) return;
  try {
    const { collection, addDoc, doc, deleteDoc, serverTimestamp } = fns;
    await addDoc(collection(db, 'avis'), {
      nom: avis.nom,
      comment: avis.comment,
      note: avis.note,
      createdAt: serverTimestamp(),
    });
    await deleteDoc(doc(db, 'avis_en_attente', id));
    store.avisEnAttente = store.avisEnAttente.filter((a) => a.id !== id);
    emit('avis-attente:changed');
    await loadAvis();
  } catch (e) {
    alert("Erreur lors de l'approbation.");
  }
}

async function rejeterAvis(id) {
  if (!confirm('Rejeter et supprimer cet avis définitivement ?')) return;
  try {
    const { doc, deleteDoc } = fns;
    await deleteDoc(doc(db, 'avis_en_attente', id));
    store.avisEnAttente = store.avisEnAttente.filter((a) => a.id !== id);
    emit('avis-attente:changed');
  } catch (e) {
    alert('Erreur lors du rejet.');
  }
}

async function deleteAvis(id) {
  if (!confirm('Supprimer cet avis définitivement ?')) return;
  try {
    const { doc, deleteDoc } = fns;
    await deleteDoc(doc(db, 'avis', id));
    store.allAvis = store.allAvis.filter((a) => a.id !== id);
    emit('avis:changed');
  } catch (e) {
    alert('Erreur lors de la suppression.');
  }
}

// ─── Souscriptions ────────────────────────────────────────────────────────
on('avis:changed', renderAvis);
on('avis-attente:changed', renderAvisEnAttente);

// ─── Compat handlers inline ───────────────────────────────────────────────
window.approuverAvis = approuverAvis;
window.rejeterAvis   = rejeterAvis;
window.deleteAvis    = deleteAvis;
