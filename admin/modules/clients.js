// ─────────────────────────────────────────────────────────────────────────────
// clients.js — CRM clients dérivé de `reservations` + `contrats`.
//
// Pas de collection `clients` matérialisée : on agrège en mémoire à chaque
// changement. Les méta enrichies (tags + notes privées) vivent dans
// `clients_meta/{hashId}` (hashId = SHA-256 tronqué de l'email lowercase
// ou du téléphone normalisé). Cette séparation garde Firestore léger et
// rend les agrégats toujours à jour vis-à-vis des collections sources.
// ─────────────────────────────────────────────────────────────────────────────

import { db, fns } from '../core/firebase.js';
import { store, emit, on } from '../core/store.js';
import {
  CLIENT_TAGS_PRESET,
  CONTRAT_TARIFS,
  classifySegment,
  clientHash,
} from '../core/ui.js';
import { promptInput } from '../core/prompt.js';

const DEFAULT_PRIX = 70;
const PAGE_SIZE    = 50;
const MS_PER_MONTH = 30 * 24 * 3600 * 1000;

// État local
let clientsIndex   = [];               // [{ id, key, kind, nom, email, ... }]
let metaCache      = new Map();        // hashId -> { tags, notes }
let currentSegment = 'all';
let currentSearch  = '';
let visibleCount   = PAGE_SIZE;
let currentClientId = null;

// ─── Chargement des méta clients ──────────────────────────────────────────
// Snapshot lecture-seule de l'index pour les autres modules (newsletter, etc.)
export function getClientsIndex() {
  return clientsIndex.slice();
}

export async function loadClientsMeta() {
  try {
    const { collection, getDocs } = fns;
    const snap = await getDocs(collection(db, 'clients_meta'));
    metaCache  = new Map(snap.docs.map((d) => [d.id, d.data()]));
    emit('clients:changed');
  } catch (e) {
    console.error('clients_meta load:', e);
    metaCache = new Map();
  }
}

function getMeta(id) {
  return metaCache.get(id) || { tags: [], notes: [] };
}

async function saveMeta(id, meta) {
  try {
    const { doc, setDoc } = fns;
    await setDoc(doc(db, 'clients_meta', id), meta);
    metaCache.set(id, meta);
  } catch (e) {
    console.error('saveMeta:', e);
    alert('Erreur lors de l\'enregistrement.');
  }
}

// ─── Construction de l'index clients ──────────────────────────────────────
async function buildClientsIndex() {
  const byKey = new Map();

  function ensureClient(rdvOrContrat) {
    let key, kind;
    if (rdvOrContrat.email) {
      key  = String(rdvOrContrat.email).toLowerCase();
      kind = 'e';
    } else if (rdvOrContrat.telephone) {
      key  = String(rdvOrContrat.telephone).replace(/\s+/g, '');
      kind = 't';
    } else {
      return null;
    }
    const dedupKey = `${kind}:${key}`;
    if (!byKey.has(dedupKey)) {
      byKey.set(dedupKey, {
        key, kind,
        nom:       rdvOrContrat.nom       || '',
        email:     rdvOrContrat.email     || '',
        telephone: rdvOrContrat.telephone || '',
        adresse:   rdvOrContrat.adresse   || '',
        rdvs:      [],
        contrats:  [],
        totalSpent: 0,
        firstRdv:   null,
        lastRdv:    null,
      });
    }
    return byKey.get(dedupKey);
  }

  // Consolidation depuis les RDV
  store.allRdvs.forEach((rdv) => {
    const c = ensureClient(rdv);
    if (!c) return;
    c.rdvs.push(rdv);
    if (rdv.nom)                 c.nom       = rdv.nom;        // le plus récent gagne (tri asc)
    if (rdv.adresse)             c.adresse   = rdv.adresse;
    if (rdv.email && !c.email)   c.email     = rdv.email;
    if (rdv.telephone && !c.telephone) c.telephone = rdv.telephone;
    if (rdv.status === 'confirmed' || rdv.status === 'done') {
      c.totalSpent += (typeof rdv.prixReel === 'number') ? rdv.prixReel : DEFAULT_PRIX;
    }
    if (rdv.dateKey) {
      const d = new Date(rdv.dateKey + 'T12:00:00');
      if (!c.firstRdv || d < c.firstRdv) c.firstRdv = d;
      if (!c.lastRdv  || d > c.lastRdv)  c.lastRdv  = d;
    }
  });

  // Consolidation depuis les contrats
  store.allContrats.forEach((co) => {
    const c = ensureClient(co);
    if (!c) return;
    c.contrats.push(co);
    if (co.status === 'active' && co.dateActive?.toDate) {
      const start  = co.dateActive.toDate();
      const months = Math.max(0, Math.floor((Date.now() - start.getTime()) / MS_PER_MONTH));
      c.totalSpent += months * (CONTRAT_TARIFS[co.contrat] || 0);
    }
  });

  // Hash IDs en parallèle
  const arr = Array.from(byKey.values());
  await Promise.all(arr.map(async (c) => {
    c.id      = await clientHash(c.key, c.kind);
    c.segment = classifySegment(c.rdvs.length, c.lastRdv);
  }));

  // Tri : derniers actifs en haut
  arr.sort((a, b) => {
    if (a.lastRdv && b.lastRdv) return b.lastRdv - a.lastRdv;
    if (a.lastRdv) return -1;
    if (b.lastRdv) return  1;
    return (a.nom || '').localeCompare(b.nom || '');
  });

  clientsIndex = arr;
}

// ─── Filtrage (segment + recherche) ──────────────────────────────────────
function filteredClients() {
  let arr = clientsIndex;
  if (currentSegment !== 'all') {
    arr = arr.filter((c) => c.segment.id === currentSegment);
  }
  if (currentSearch) {
    const q  = currentSearch.toLowerCase();
    const qd = q.replace(/\s+/g, '');
    arr = arr.filter(
      (c) =>
        (c.nom || '').toLowerCase().includes(q) ||
        (c.email || '').toLowerCase().includes(q) ||
        (c.telephone || '').replace(/\s+/g, '').includes(qd),
    );
  }
  return arr;
}

// ─── Rendu liste ──────────────────────────────────────────────────────────
function renderSegmentCounts() {
  const counts = { all: clientsIndex.length, new: 0, fidele: 0, vip: 0, dormant: 0 };
  clientsIndex.forEach((c) => { counts[c.segment.id]++; });
  Object.entries(counts).forEach(([k, v]) => {
    const el = document.getElementById('segCount-' + k);
    if (el) el.textContent = v;
  });
}

function renderClientsList() {
  const list = document.getElementById('clientsList');
  if (!list) return;

  const arr   = filteredClients();
  const slice = arr.slice(0, visibleCount);

  if (slice.length === 0) {
    list.innerHTML = '<div class="empty-state"><div class="empty-icon">👥</div>Aucun client trouvé.</div>';
    const more = document.getElementById('clientsLoadMore');
    if (more) more.style.display = 'none';
    return;
  }

  list.innerHTML = slice.map(clientRowHtml).join('');

  const more = document.getElementById('clientsLoadMore');
  if (more) {
    if (arr.length > visibleCount) {
      more.style.display = 'block';
      more.textContent = `Charger plus (${arr.length - visibleCount} restants)`;
    } else {
      more.style.display = 'none';
    }
  }
}

function clientRowHtml(c) {
  const meta = getMeta(c.id);
  const tags = (meta.tags || []).slice(0, 3);
  const tagsHtml = tags.map((t) => {
    const preset = CLIENT_TAGS_PRESET.find((p) => p.id === t);
    const label  = preset ? preset.label : t;
    const color  = preset ? preset.color : '#8888aa';
    return `<span class="client-tag" style="color:${color};border-color:${color}40;background:${color}15">${escapeHtml(label)}</span>`;
  }).join('');

  const initials = (c.nom || '?').split(/\s+/).filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase() || '?';
  const lastRdv  = c.lastRdv
    ? c.lastRdv.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: '2-digit' })
    : '–';
  const display  = c.nom || c.email || c.telephone || '–';

  return `
    <div class="client-row" onclick="openClientCard('${c.id}')">
      <div class="client-avatar" style="background:${c.segment.color}20;color:${c.segment.color}">${escapeHtml(initials)}</div>
      <div class="client-row-main">
        <div class="client-row-top">
          <div class="client-name">${escapeHtml(display)}</div>
          <span class="client-segment" style="color:${c.segment.color};border-color:${c.segment.color}40;background:${c.segment.color}15">${c.segment.label}</span>
        </div>
        <div class="client-row-sub">
          ${c.email ? `📧 ${escapeHtml(c.email)}` : ''}
          ${c.telephone ? ` · 📞 ${escapeHtml(c.telephone)}` : ''}
        </div>
        ${tagsHtml ? `<div class="client-row-tags">${tagsHtml}</div>` : ''}
      </div>
      <div class="client-row-stats">
        <div class="client-row-stat"><strong>${c.rdvs.length}</strong> RDV</div>
        <div class="client-row-stat"><strong>${Math.round(c.totalSpent)} €</strong></div>
        <div class="client-row-stat client-row-last">Dernier · ${lastRdv}</div>
      </div>
    </div>`;
}

function setSegment(seg, btn) {
  currentSegment = seg;
  visibleCount   = PAGE_SIZE;
  document.querySelectorAll('#tab-clients .seg-btn').forEach((b) => b.classList.remove('active'));
  btn.classList.add('active');
  renderClientsList();
}

function setSearch(q) {
  currentSearch = q || '';
  visibleCount  = PAGE_SIZE;
  renderClientsList();
}

function loadMoreClients() {
  visibleCount += PAGE_SIZE;
  renderClientsList();
}

// ─── Modale fiche client ──────────────────────────────────────────────────
function openClientCard(id) {
  const c = clientsIndex.find((x) => x.id === id);
  if (!c) return;
  currentClientId = id;

  document.getElementById('clientModalTitle').innerHTML =
    `${escapeHtml(c.nom || c.email || c.telephone || '–')} <span class="client-segment" style="color:${c.segment.color};border-color:${c.segment.color}40;background:${c.segment.color}15">${c.segment.label}</span>`;

  document.getElementById('clientModalContact').innerHTML = `
    <div class="modal-info-row"><span class="modal-info-icon">📧</span><div class="modal-info-val">${escapeHtml(c.email || '–')}</div></div>
    <div class="modal-info-row"><span class="modal-info-icon">📞</span><div class="modal-info-val">${escapeHtml(c.telephone || '–')}</div></div>
    <div class="modal-info-row"><span class="modal-info-icon">📍</span><div class="modal-info-val">${escapeHtml(c.adresse || '–')}</div></div>
  `;

  document.getElementById('clientModalStats').innerHTML = `
    <div class="cstat"><div class="cstat-num">${c.rdvs.length}</div><div class="cstat-lbl">Interventions</div></div>
    <div class="cstat"><div class="cstat-num">${Math.round(c.totalSpent)} €</div><div class="cstat-lbl">Total dépensé</div></div>
    <div class="cstat"><div class="cstat-num">${c.contrats.filter((x) => x.status === 'active').length}</div><div class="cstat-lbl">Contrats actifs</div></div>
    <div class="cstat"><div class="cstat-num">${c.firstRdv ? c.firstRdv.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: '2-digit' }) : '–'}</div><div class="cstat-lbl">Premier RDV</div></div>
  `;

  renderTags();
  renderNotes(getMeta(id).notes || []);
  renderHistoryRdvs(c);
  renderHistoryContrats(c);

  document.getElementById('clientModal').classList.add('show');
}

function renderTags() {
  if (!currentClientId) return;
  const host    = document.getElementById('clientModalTags');
  const meta    = getMeta(currentClientId);
  const userTags = meta.tags || [];

  const presetsHtml = CLIENT_TAGS_PRESET.map((p) => {
    const sel = userTags.includes(p.id);
    return `<button class="client-tag-btn ${sel ? 'sel' : ''}" data-tag="${p.id}" style="color:${p.color};border-color:${p.color}${sel ? '80' : '40'};background:${p.color}${sel ? '25' : '10'}">${p.label}</button>`;
  }).join('');

  const customTags = userTags
    .filter((t) => !CLIENT_TAGS_PRESET.find((p) => p.id === t))
    .map((t) => `<button class="client-tag-btn sel" data-tag="${escapeAttr(t)}" style="color:#8888aa;border-color:#8888aa80;background:#8888aa25">${escapeHtml(t)} ✕</button>`)
    .join('');

  host.innerHTML = presetsHtml + customTags + `<button class="client-tag-add" id="clientTagAdd">+ Ajouter</button>`;

  host.querySelectorAll('.client-tag-btn').forEach((btn) => {
    btn.onclick = () => toggleTag(btn.dataset.tag);
  });
  document.getElementById('clientTagAdd').onclick = addCustomTag;
}

async function toggleTag(tagId) {
  if (!currentClientId) return;
  const meta = { ...(metaCache.get(currentClientId) || { tags: [], notes: [] }) };
  meta.tags  = meta.tags || [];
  if (meta.tags.includes(tagId)) {
    meta.tags = meta.tags.filter((t) => t !== tagId);
  } else {
    meta.tags = [...meta.tags, tagId];
  }
  await saveMeta(currentClientId, meta);
  renderTags();
  renderClientsList();
}

async function addCustomTag() {
  const raw = await promptInput({
    title:       'Ajouter un tag',
    message:     'Saisis un tag personnalisé (lettres, chiffres, espaces).',
    placeholder: 'ex: bricoleur',
  });
  if (!raw) return;
  const cleaned = String(raw).toLowerCase().trim().replace(/[^a-z0-9 àâäéèêëïîôöùûüç-]/g, '').slice(0, 30);
  if (!cleaned) return;
  await toggleTag(cleaned);
}

function renderNotes(notes) {
  const host = document.getElementById('clientModalNotes');
  if (!host) return;
  if (notes.length === 0) {
    host.innerHTML = '<div style="color:var(--muted);font-size:0.82rem;padding:0.4rem 0">Aucune note pour ce client.</div>';
    return;
  }
  host.innerHTML = notes
    .slice()
    .reverse()
    .map((n, i) => {
      const idx = notes.length - 1 - i;
      const d   = n.createdAt
        ? new Date(n.createdAt).toLocaleString('fr-FR', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })
        : '';
      return `<div class="client-note">
        <div class="client-note-meta">${d}<button class="client-note-del" data-idx="${idx}" title="Supprimer">✕</button></div>
        <div class="client-note-text">${escapeHtml(n.text || '')}</div>
      </div>`;
    })
    .join('');
  host.querySelectorAll('.client-note-del').forEach((b) => {
    b.onclick = () => removeNote(parseInt(b.dataset.idx, 10));
  });
}

async function addNote() {
  const ta   = document.getElementById('clientNoteInput');
  const text = ta.value.trim();
  if (!text || !currentClientId) return;
  const meta = { ...(metaCache.get(currentClientId) || { tags: [], notes: [] }) };
  meta.notes = [...(meta.notes || []), { text, createdAt: Date.now() }];
  await saveMeta(currentClientId, meta);
  ta.value = '';
  renderNotes(meta.notes);
}

async function removeNote(idx) {
  if (!currentClientId) return;
  const meta = { ...(metaCache.get(currentClientId) || { tags: [], notes: [] }) };
  if (!meta.notes || idx < 0 || idx >= meta.notes.length) return;
  meta.notes = meta.notes.filter((_, i) => i !== idx);
  await saveMeta(currentClientId, meta);
  renderNotes(meta.notes);
}

function renderHistoryRdvs(c) {
  const host = document.getElementById('clientModalRdvs');
  if (!host) return;
  if (c.rdvs.length === 0) {
    host.innerHTML = '<div class="empty-state" style="padding:0.75rem">Aucun RDV.</div>';
    return;
  }
  host.innerHTML = c.rdvs
    .slice()
    .sort((a, b) => (b.dateKey || '').localeCompare(a.dateKey || ''))
    .map((r) => {
      const d    = r.dateKey
        ? new Date(r.dateKey + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: '2-digit' })
        : '–';
      const prix = (typeof r.prixReel === 'number') ? r.prixReel + ' €' : (r.price || '–');
      return `<div class="client-rdv-row">
        <div class="client-rdv-date">${d}</div>
        <div class="client-rdv-svc">${escapeHtml(r.service || '–')}</div>
        <div class="client-rdv-status">${statusLabel(r.status)}</div>
        <div class="client-rdv-prix">${escapeHtml(prix)}</div>
      </div>`;
    })
    .join('');
}

function renderHistoryContrats(c) {
  const host = document.getElementById('clientModalContrats');
  if (!host) return;
  if (c.contrats.length === 0) {
    host.innerHTML = '<div class="empty-state" style="padding:0.75rem">Aucun contrat.</div>';
    return;
  }
  host.innerHTML = c.contrats.map((co) => {
    const ds   = co.dateActive?.toDate
      ? co.dateActive.toDate().toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: '2-digit' })
      : (co.createdAt?.toDate ? co.createdAt.toDate().toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: '2-digit' }) : '–');
    const tarif = CONTRAT_TARIFS[co.contrat] ? CONTRAT_TARIFS[co.contrat] + ' €/m' : '–';
    return `<div class="client-rdv-row">
      <div class="client-rdv-date">${ds}</div>
      <div class="client-rdv-svc">${escapeHtml(co.contrat || '–')}</div>
      <div class="client-rdv-status">${escapeHtml(co.status || '–')}</div>
      <div class="client-rdv-prix">${tarif}</div>
    </div>`;
  }).join('');
}

function statusLabel(s) {
  return ({
    pending:   '⏳ En attente',
    confirmed: '✓ Confirmé',
    done:      '✓ Terminé',
    cancelled: '✗ Annulé',
  })[s] || s || '–';
}

function closeClientModal() {
  document.getElementById('clientModal').classList.remove('show');
  currentClientId = null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}
function escapeAttr(s) { return escapeHtml(s).replace(/`/g, '&#96;'); }

// ─── Souscriptions + wiring ───────────────────────────────────────────────
async function rebuild() {
  await buildClientsIndex();
  renderSegmentCounts();
  renderClientsList();
}

on('rdvs:changed',     rebuild);
on('contrats:changed', rebuild);
on('clients:changed',  rebuild);

document.getElementById('clientsSearch')?.addEventListener('input', (e) => setSearch(e.target.value));
document.getElementById('clientsLoadMore')?.addEventListener('click', loadMoreClients);
document.getElementById('clientNoteAdd')?.addEventListener('click', addNote);
document.getElementById('clientModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'clientModal') closeClientModal();
});

// Compat handlers inline
window.openClientCard   = openClientCard;
window.closeClientModal = closeClientModal;
window.setSegment       = setSegment;
