// ─────────────────────────────────────────────────────────────────────────────
// devis.js — Devis (proposition commerciale) avec conversion 1-clic en
// facture.
//
// Statuts :
//   draft → sent → accepted | refused | expired | converted
//
// Numérotation séquentielle annuelle `DV-YYYY-NNNN` via runTransaction
// sur counters/devis-{YYYY}.
//
// PDF généré via pdf-lib (lazy-loaded). Layout très proche d'une facture
// mais avec bandeau "DEVIS", date de validité prominente, et bloc
// "Bon pour accord" pour signature.
// ─────────────────────────────────────────────────────────────────────────────

import { db, fns } from '../core/firebase.js';
import { store, emit, on } from '../core/store.js';
import { BUSINESS_INFO, PAIEMENT_MODES } from '../core/ui.js';

const PDF_LIB_URL = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';
const VALIDITE_JOURS_DEFAULT = 30;

// État local
let allDevis      = [];
let currentFilter = 'all';
let currentSearch = '';
let editingId     = null;
let formLines     = [];

// ─── Chargement ───────────────────────────────────────────────────────────
export async function loadDevis() {
  try {
    const { collection, getDocs, query, orderBy } = fns;
    const q    = query(collection(db, 'devis'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    allDevis = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    emit('devis:changed');
  } catch (e) {
    console.error('devis load:', e);
    document.getElementById('devisList').innerHTML =
      '<div class="empty-state"><div class="empty-icon">⚠️</div>Erreur de chargement.</div>';
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────
function fmtEUR(n) {
  if (!Number.isFinite(n)) return '–';
  return new Intl.NumberFormat('fr-FR', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(n) + ' €';
}

function todayISO() { return new Date().toISOString().slice(0, 10); }

function addDaysISO(iso, days) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function statusOf(d) {
  if (d.status === 'converted') return 'converted';
  if (d.status === 'accepted')  return 'accepted';
  if (d.status === 'refused')   return 'refused';
  if (d.validite && new Date(d.validite + 'T23:59:59') < new Date() && d.status !== 'accepted') return 'expired';
  return 'sent';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function recomputeLineTotals(line) {
  return (Number(line.quantite) || 0) * (Number(line.prixUnitaire) || 0);
}

// ─── Numérotation atomique ────────────────────────────────────────────────
async function allocateDevisNumber() {
  const { runTransaction, doc } = fns;
  const year = new Date().getFullYear();
  const ref  = doc(db, 'counters', `devis-${year}`);
  const seq  = await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const last = snap.exists() ? (snap.data().last || 0) : 0;
    const next = last + 1;
    tx.set(ref, { last: next, year, updatedAt: Date.now() }, { merge: true });
    return next;
  });
  return {
    numero:   `DV-${year}-${String(seq).padStart(4, '0')}`,
    sequence: seq,
    year,
  };
}

// ─── Stats ────────────────────────────────────────────────────────────────
function renderStats() {
  let sentSum = 0, sentCount = 0;
  let acceptedSum = 0, acceptedCount = 0;
  let totalDecided = 0, totalAccepted = 0;

  allDevis.forEach((d) => {
    const st  = statusOf(d);
    const ttc = Number(d.totalTTC) || 0;
    if (st === 'sent') { sentSum += ttc; sentCount++; }
    if (st === 'accepted') { acceptedSum += ttc; acceptedCount++; }
    if (['accepted', 'refused', 'converted'].includes(st)) {
      totalDecided++;
      if (st === 'accepted' || st === 'converted') totalAccepted++;
    }
  });

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('devStatSent',          fmtEUR(sentSum));
  set('devStatSentCount',     `${sentCount} en cours`);
  set('devStatAccepted',      fmtEUR(acceptedSum));
  set('devStatAcceptedCount', `${acceptedCount} prêt${acceptedCount > 1 ? 's' : ''} à convertir`);
  const rate = totalDecided > 0 ? Math.round((totalAccepted / totalDecided) * 100) : 0;
  set('devStatRate',           totalDecided > 0 ? `${rate}%` : '–');
  set('devStatRateCount',     `${totalAccepted}/${totalDecided} décisions`);
}

// ─── Liste ────────────────────────────────────────────────────────────────
function setDevisFilter(f, btn) {
  currentFilter = f;
  document.querySelectorAll('#tab-devis .tab-filter').forEach((t) => t.classList.remove('active'));
  btn.classList.add('active');
  renderDevisList();
}

function setDevisSearch(q) {
  currentSearch = (q || '').toLowerCase();
  renderDevisList();
}

const STATUS_LABEL = {
  sent:      '📤 Envoyé',
  accepted:  '✅ Accepté',
  refused:   '✗ Refusé',
  expired:   '⏰ Expiré',
  converted: '🧾 Converti',
};

function renderDevisList() {
  const list = document.getElementById('devisList');
  if (!list) return;

  let arr = allDevis.slice();
  if (currentFilter !== 'all') {
    arr = arr.filter((d) => statusOf(d) === currentFilter);
  }
  if (currentSearch) {
    arr = arr.filter((d) =>
      (d.numero || '').toLowerCase().includes(currentSearch) ||
      (d.client?.nom || '').toLowerCase().includes(currentSearch) ||
      (d.client?.email || '').toLowerCase().includes(currentSearch) ||
      String(Math.round(Number(d.totalTTC) || 0)).includes(currentSearch),
    );
  }

  if (arr.length === 0) {
    list.innerHTML =
      '<div class="empty-state"><div class="empty-icon">💼</div>Aucun devis pour le moment.</div>';
    return;
  }

  list.innerHTML = arr.map(devisRowHtml).join('');
}

function devisRowHtml(d) {
  const st     = statusOf(d);
  const dateF  = d.date     ? new Date(d.date     + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: '2-digit' }) : '–';
  const dateV  = d.validite ? new Date(d.validite + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: '2-digit' }) : null;
  const client = d.client?.nom || d.client?.email || '–';

  const actions = [];
  actions.push(`<button class="btn-soft" onclick="downloadDevisPdf('${d.id}')" title="PDF">📄</button>`);
  actions.push(`<button class="btn-soft" onclick="openDevisForm('${d.id}')" title="Modifier">✏️</button>`);

  if (st === 'sent') {
    actions.push(`<button class="btn-confirm" onclick="setDevisStatus('${d.id}','accepted')" title="Accepter">✓ Accepter</button>`);
    actions.push(`<button class="btn-cancel"  onclick="setDevisStatus('${d.id}','refused')"  title="Refuser">✗</button>`);
  } else if (st === 'accepted') {
    actions.push(`<button class="btn-purple" onclick="convertDevisToFacture('${d.id}')" title="Convertir en facture">🧾 Facturer</button>`);
  } else if (st === 'converted' && d.factureId) {
    actions.push(`<button class="btn-soft" onclick="goToFactureFromDevis('${d.factureId}')" title="Voir la facture">→ Facture</button>`);
  }
  actions.push(`<button class="btn-cancel" onclick="deleteDevis('${d.id}')" title="Supprimer" style="flex:0 0 auto;padding:0.4rem 0.6rem">🗑</button>`);

  return `
    <div class="fac-row ${st === 'expired' ? 'late' : ''} ${st === 'converted' ? 'paid' : ''}">
      <div class="fac-num">${escapeHtml(d.numero || '–')}</div>
      <div class="fac-row-main">
        <div class="fac-row-client">${escapeHtml(client)}</div>
        <div class="fac-row-meta">
          📅 ${dateF}${dateV ? ` · validité ${dateV}` : ''}
          ${d.client?.email ? ` · 📧 ${escapeHtml(d.client.email)}` : ''}
        </div>
      </div>
      <div class="fac-row-amount">
        ${fmtEUR(Number(d.totalTTC) || 0)}
        <div style="margin-top:0.2rem"><span class="fac-status-pill fac-status-${st}">${STATUS_LABEL[st]}</span></div>
      </div>
      <div class="fac-row-actions">${actions.join('')}</div>
    </div>`;
}

// ─── Form ─────────────────────────────────────────────────────────────────
function openDevisForm(id = null) {
  editingId = id;
  const d = id ? allDevis.find((x) => x.id === id) : null;

  document.getElementById('devisModalTitle').textContent =
    d ? `Devis ${d.numero}` : 'Nouveau devis';

  document.getElementById('devClientNom').value     = d?.client?.nom       || '';
  document.getElementById('devClientEmail').value   = d?.client?.email     || '';
  document.getElementById('devClientTel').value     = d?.client?.telephone || '';
  document.getElementById('devClientAdresse').value = d?.client?.adresse   || '';
  document.getElementById('devClientSearch').value  = '';
  document.getElementById('devClientSuggest').style.display = 'none';

  const date = d?.date || todayISO();
  document.getElementById('devDate').value     = date;
  document.getElementById('devValidite').value = d?.validite || addDaysISO(date, VALIDITE_JOURS_DEFAULT);
  document.getElementById('devStatut').value   = d?.status   || 'sent';
  document.getElementById('devTva').value      = (d?.tva ?? 0);
  document.getElementById('devNotes').value    = d?.notes    || '';

  formLines = (d?.items?.length ? d.items : [{ description: '', quantite: 1, prixUnitaire: 0 }])
    .map((it) => ({
      description:  it.description  || '',
      quantite:     Number(it.quantite) || 0,
      prixUnitaire: Number(it.prixUnitaire) || 0,
    }));
  renderFormLines();
  recomputeFormTotals();

  document.getElementById('devisModal').classList.add('show');
}

function closeDevisForm() {
  document.getElementById('devisModal').classList.remove('show');
  editingId = null;
  formLines = [];
}

function renderFormLines() {
  const host = document.getElementById('devLinesList');
  host.innerHTML = formLines.map((l, i) => `
    <div class="fac-line" data-i="${i}">
      <input class="form-input dev-line-desc" placeholder="Description de la prestation" value="${escapeHtml(l.description)}">
      <input class="form-input dev-line-qty"  type="number" min="0" step="0.5"  value="${l.quantite}">
      <input class="form-input dev-line-pu"   type="number" min="0" step="0.01" value="${l.prixUnitaire}">
      <div class="fac-line-total">${fmtEUR(recomputeLineTotals(l))}</div>
      <button class="fac-line-del" onclick="removeDevisLine(${i})">✕</button>
    </div>`).join('');

  host.querySelectorAll('.fac-line').forEach((row) => {
    const i = Number(row.dataset.i);
    row.querySelector('.dev-line-desc').addEventListener('input', (e) => {
      formLines[i].description = e.target.value;
    });
    row.querySelector('.dev-line-qty').addEventListener('input', (e) => {
      formLines[i].quantite = Number(e.target.value) || 0;
      row.querySelector('.fac-line-total').textContent = fmtEUR(recomputeLineTotals(formLines[i]));
      recomputeFormTotals();
    });
    row.querySelector('.dev-line-pu').addEventListener('input', (e) => {
      formLines[i].prixUnitaire = Number(e.target.value) || 0;
      row.querySelector('.fac-line-total').textContent = fmtEUR(recomputeLineTotals(formLines[i]));
      recomputeFormTotals();
    });
  });
}

function addDevisLine() {
  formLines.push({ description: '', quantite: 1, prixUnitaire: 0 });
  renderFormLines();
}

function removeDevisLine(i) {
  formLines.splice(i, 1);
  if (formLines.length === 0) formLines.push({ description: '', quantite: 1, prixUnitaire: 0 });
  renderFormLines();
  recomputeFormTotals();
}

function recomputeFormTotals() {
  const totalHT  = formLines.reduce((s, l) => s + recomputeLineTotals(l), 0);
  const tva      = Number(document.getElementById('devTva').value) || 0;
  const totalTVA = totalHT * tva / 100;
  const totalTTC = totalHT + totalTVA;

  document.getElementById('devTotalHT').textContent  = fmtEUR(totalHT);
  document.getElementById('devTotalTVA').textContent = fmtEUR(totalTVA);
  document.getElementById('devTotalTTC').textContent = fmtEUR(totalTTC);
  document.getElementById('devTotalTvaRow').style.display = tva > 0 ? 'flex' : 'none';

  return { totalHT, totalTVA, totalTTC, tva };
}

// ─── Suggestions clients (mêmes sources que factures.js) ─────────────────
function buildClientCandidates() {
  const map = new Map();
  const push = (src) => {
    if (!src.email && !src.telephone) return;
    const key = (src.email || src.telephone || '').toLowerCase();
    if (!map.has(key)) {
      map.set(key, {
        nom: src.nom || '', email: src.email || '',
        telephone: src.telephone || '', adresse: src.adresse || '',
      });
    }
  };
  store.allRdvs.forEach(push);
  store.allContrats.forEach(push);
  return Array.from(map.values());
}

function attachClientSearch() {
  const input = document.getElementById('devClientSearch');
  const drop  = document.getElementById('devClientSuggest');
  if (!input || !drop) return;

  input.addEventListener('input', (e) => {
    const q = e.target.value.trim().toLowerCase();
    if (q.length < 2) { drop.style.display = 'none'; return; }
    const candidates = buildClientCandidates().filter((c) =>
      (c.nom || '').toLowerCase().includes(q) ||
      (c.email || '').toLowerCase().includes(q) ||
      (c.telephone || '').replace(/\s+/g, '').includes(q.replace(/\s+/g, '')),
    ).slice(0, 8);
    if (candidates.length === 0) { drop.style.display = 'none'; return; }
    drop.innerHTML = candidates.map((c, i) =>
      `<div class="fac-client-suggest-row" data-i="${i}">
        <strong>${escapeHtml(c.nom || c.email || '–')}</strong>
        <small>${escapeHtml(c.email || '')}${c.telephone ? ' · ' + escapeHtml(c.telephone) : ''}</small>
      </div>`).join('');
    drop.style.display = 'block';
    drop.querySelectorAll('.fac-client-suggest-row').forEach((row) => {
      row.onclick = () => {
        const c = candidates[Number(row.dataset.i)];
        document.getElementById('devClientNom').value     = c.nom       || '';
        document.getElementById('devClientEmail').value   = c.email     || '';
        document.getElementById('devClientTel').value     = c.telephone || '';
        document.getElementById('devClientAdresse').value = c.adresse   || '';
        drop.style.display = 'none';
        input.value = '';
      };
    });
  });

  input.addEventListener('blur', () => setTimeout(() => { drop.style.display = 'none'; }, 200));
}

// ─── Sauvegarde ───────────────────────────────────────────────────────────
async function saveDevis(downloadPdf) {
  const nom     = document.getElementById('devClientNom').value.trim();
  const email   = document.getElementById('devClientEmail').value.trim();
  const tel     = document.getElementById('devClientTel').value.trim();
  const adresse = document.getElementById('devClientAdresse').value.trim();

  if (!nom && !email) { alert('Indique au moins un nom ou un email pour le client.'); return; }

  const items = formLines
    .filter((l) => (l.description || '').trim() && Number(l.prixUnitaire) > 0)
    .map((l) => ({
      description: l.description.trim(),
      quantite:    Number(l.quantite) || 0,
      prixUnitaire:Number(l.prixUnitaire) || 0,
    }));

  if (items.length === 0) { alert('Ajoute au moins une ligne avec une description et un prix.'); return; }

  const totals   = recomputeFormTotals();
  const date     = document.getElementById('devDate').value || todayISO();
  const validite = document.getElementById('devValidite').value || addDaysISO(date, VALIDITE_JOURS_DEFAULT);
  const status   = document.getElementById('devStatut').value;
  const notes    = document.getElementById('devNotes').value.trim();

  const btnSave = document.getElementById('devSaveBtn');
  const btnPdf  = document.getElementById('devSavePdfBtn');
  btnSave.disabled = true; btnPdf.disabled = true;

  try {
    const { collection, doc, addDoc, updateDoc, serverTimestamp } = fns;

    let savedId = editingId;
    let payload = {
      client:    { nom, email, telephone: tel, adresse },
      date, validite,
      items,
      totalHT:  totals.totalHT,
      tva:      totals.tva,
      totalTVA: totals.totalTVA,
      totalTTC: totals.totalTTC,
      status,
      notes,
      updatedAt: serverTimestamp(),
    };

    if (editingId) {
      await updateDoc(doc(db, 'devis', editingId), payload);
      const idx = allDevis.findIndex((x) => x.id === editingId);
      if (idx >= 0) allDevis[idx] = { ...allDevis[idx], ...payload };
    } else {
      const { numero, sequence, year } = await allocateDevisNumber();
      payload = {
        ...payload,
        numero, sequence, year,
        createdAt:   serverTimestamp(),
        createdAtMs: Date.now(),
      };
      const ref = await addDoc(collection(db, 'devis'), payload);
      savedId = ref.id;
      allDevis.unshift({ id: savedId, ...payload });
    }

    emit('devis:changed');

    if (downloadPdf) {
      const d = allDevis.find((x) => x.id === savedId);
      if (d) await downloadDocPdf(d);
    }

    closeDevisForm();
  } catch (e) {
    console.error(e);
    alert('Erreur enregistrement : ' + (e?.message || e));
  } finally {
    btnSave.disabled = false; btnPdf.disabled = false;
  }
}

async function setDevisStatus(id, status) {
  const d = allDevis.find((x) => x.id === id);
  if (!d) return;
  try {
    const { doc, updateDoc } = fns;
    await updateDoc(doc(db, 'devis', id), { status });
    d.status = status;
    emit('devis:changed');
  } catch (e) {
    console.error(e);
    alert('Erreur changement de statut.');
  }
}

async function deleteDevis(id) {
  const d = allDevis.find((x) => x.id === id);
  if (!confirm(`Supprimer le devis ${d?.numero || ''} ?\n(le numéro reste consommé dans la séquence)`)) return;
  try {
    const { doc, deleteDoc } = fns;
    await deleteDoc(doc(db, 'devis', id));
    allDevis = allDevis.filter((x) => x.id !== id);
    emit('devis:changed');
  } catch (e) {
    console.error(e);
    alert('Erreur suppression.');
  }
}

// ─── Conversion devis → facture ──────────────────────────────────────────
async function convertDevisToFacture(id) {
  const d = allDevis.find((x) => x.id === id);
  if (!d) return;
  if (!confirm(`Convertir le devis ${d.numero} en facture ?`)) return;

  try {
    const { collection, doc, addDoc, updateDoc, runTransaction, serverTimestamp } = fns;

    // Allouer un numéro de facture
    const year = new Date().getFullYear();
    const counterRef = doc(db, 'counters', `factures-${year}`);
    const seq = await runTransaction(db, async (tx) => {
      const snap = await tx.get(counterRef);
      const last = snap.exists() ? (snap.data().last || 0) : 0;
      const next = last + 1;
      tx.set(counterRef, { last: next, year, updatedAt: Date.now() }, { merge: true });
      return next;
    });
    const numero = `MK-${year}-${String(seq).padStart(4, '0')}`;

    // Créer la facture
    const today = todayISO();
    const factPayload = {
      client:    d.client,
      date:      today,
      echeance:  addDaysISO(today, BUSINESS_INFO.delaiPaiementJours || 30),
      items:     d.items,
      totalHT:   d.totalHT,
      tva:       d.tva,
      totalTVA:  d.totalTVA,
      totalTTC:  d.totalTTC,
      paiement:  'virement',
      paid:      false,
      paidAt:    null,
      notes:     d.notes ? `Devis : ${d.numero}\n${d.notes}` : `Issue du devis ${d.numero}`,
      numero, sequence: seq, year,
      sourceDevisId:     id,
      sourceDevisNumero: d.numero,
      createdAt:   serverTimestamp(),
      createdAtMs: Date.now(),
      updatedAt:   serverTimestamp(),
    };
    const ref = await addDoc(collection(db, 'factures'), factPayload);

    // Marquer le devis comme converti
    await updateDoc(doc(db, 'devis', id), {
      status:         'converted',
      factureId:      ref.id,
      factureNumero:  numero,
      convertedAt:    Date.now(),
    });
    d.status        = 'converted';
    d.factureId     = ref.id;
    d.factureNumero = numero;

    emit('devis:changed');
    emit('factures:changed');

    // Charger la nouvelle facture dans la liste factures
    const { getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js');
    const newFactSnap = await getDoc(ref);
    if (newFactSnap.exists()) {
      // Notifier factures.js via un event de reload simple
      const { loadFactures } = await import('./factures.js');
      await loadFactures();
    }

    alert(`✅ Devis converti en facture ${numero}`);
  } catch (e) {
    console.error(e);
    alert('Erreur conversion : ' + (e?.message || e));
  }
}

function goToFactureFromDevis(factureId) {
  // Bascule sur l'onglet factures et met le numéro en filtre de recherche
  window.location.hash = 'factures';
  setTimeout(() => {
    const input = document.getElementById('facturesSearch');
    if (input) {
      input.value = factureId.slice(0, 6); // approche : on laisse l'admin scroller, ou améliorer plus tard
      input.dispatchEvent(new Event('input'));
    }
  }, 100);
}

// ─── Génération PDF ───────────────────────────────────────────────────────
async function ensurePdfLib() {
  if (window.PDFLib) return window.PDFLib;
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = PDF_LIB_URL;
    s.onload  = resolve;
    s.onerror = () => reject(new Error('Échec chargement pdf-lib'));
    document.head.appendChild(s);
  });
  return window.PDFLib;
}

async function downloadDocPdf(d) {
  try {
    const bytes = await buildDevisPdf(d);
    const blob  = new Blob([bytes], { type: 'application/pdf' });
    const url   = URL.createObjectURL(blob);
    const a     = document.createElement('a');
    a.href      = url;
    a.download  = `${d.numero || 'devis'}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    console.error(e);
    alert('Erreur génération PDF : ' + (e?.message || e));
  }
}

async function downloadDevisPdf(id) {
  const d = allDevis.find((x) => x.id === id);
  if (!d) return;
  await downloadDocPdf(d);
}

async function buildDevisPdf(d) {
  const PDFLib = await ensurePdfLib();
  const { PDFDocument, StandardFonts, rgb } = PDFLib;

  const doc      = await PDFDocument.create();
  const page     = doc.addPage([595.28, 841.89]); // A4
  const helv     = await doc.embedFont(StandardFonts.Helvetica);
  const helvBold = await doc.embedFont(StandardFonts.HelveticaBold);

  const W = 595.28;
  const margin = 40;
  let y = 800;

  const drawText = (text, opts = {}) => {
    const { x = margin, size = 10, bold = false, color = rgb(0.1, 0.1, 0.15), align } = opts;
    const font = bold ? helvBold : helv;
    const safe = sanitizeForPdf(String(text || ''));
    let xPos = x;
    if (align === 'right') {
      const width = font.widthOfTextAtSize(safe, size);
      xPos = (typeof opts.right === 'number' ? opts.right : W - margin) - width;
    }
    page.drawText(safe, { x: xPos, y: opts.y ?? y, size, font, color });
  };

  // Émetteur
  drawText(BUSINESS_INFO.nom, { size: 16, bold: true });
  y -= 16;
  drawText(BUSINESS_INFO.formeJuridique, { size: 9, color: rgb(0.4, 0.4, 0.5) }); y -= 12;
  drawText(BUSINESS_INFO.adresse,                              { size: 9 }); y -= 11;
  drawText(`${BUSINESS_INFO.cp} ${BUSINESS_INFO.ville}`,      { size: 9 }); y -= 11;
  drawText(`SIRET : ${BUSINESS_INFO.siret}`,                  { size: 9 }); y -= 11;
  drawText(BUSINESS_INFO.email,                                { size: 9 }); y -= 11;
  drawText(BUSINESS_INFO.telephone,                            { size: 9 }); y -= 11;

  // Bandeau titre violet
  y -= 16;
  page.drawRectangle({ x: margin, y: y - 4, width: W - 2 * margin, height: 32, color: rgb(0.4, 0.18, 0.6) });
  drawText('DEVIS', { x: margin + 12, y: y + 8, size: 18, bold: true, color: rgb(1, 1, 1) });
  drawText(d.numero || '', { x: W - margin - 12, y: y + 12, size: 12, bold: true, color: rgb(0.85, 0.7, 1), align: 'right' });
  drawText(`Émis le ${formatDateFR(d.date)}`, { x: W - margin - 12, y: y - 2, size: 8, color: rgb(0.95, 0.85, 1), align: 'right' });
  y -= 36;

  // Bloc client
  y -= 14;
  drawText('Devis pour :', { size: 9, bold: true, color: rgb(0.4, 0.4, 0.5) }); y -= 14;
  drawText(d.client?.nom || '–', { size: 11, bold: true }); y -= 13;
  if (d.client?.adresse)   { drawText(d.client.adresse,   { size: 9 }); y -= 11; }
  if (d.client?.email)     { drawText(d.client.email,     { size: 9 }); y -= 11; }
  if (d.client?.telephone) { drawText(d.client.telephone, { size: 9 }); y -= 11; }

  // Validité
  y -= 8;
  drawText(`Valable jusqu'au ${formatDateFR(d.validite)}`, { size: 9, bold: true, color: rgb(0.4, 0.18, 0.6) });

  // Tableau lignes
  y -= 26;
  page.drawRectangle({ x: margin, y: y - 4, width: W - 2 * margin, height: 22, color: rgb(0.95, 0.93, 0.99) });
  drawText('Description', { x: margin + 8,                  y: y + 4, size: 9, bold: true });
  drawText('Qté',         { x: W - margin - 200,            y: y + 4, size: 9, bold: true });
  drawText('PU HT',       { x: W - margin - 130,            y: y + 4, size: 9, bold: true });
  drawText('Total HT',    { x: W - margin - 12,             y: y + 4, size: 9, bold: true, align: 'right' });
  y -= 18;

  (d.items || []).forEach((it) => {
    if (y < 180) return; // pas de saut de page géré ici
    const total = (Number(it.quantite) || 0) * (Number(it.prixUnitaire) || 0);
    drawText(it.description || '–',    { x: margin + 8,        y: y + 4, size: 10 });
    drawText(String(it.quantite),       { x: W - margin - 200, y: y + 4, size: 10 });
    drawText(fmtEURPdf(it.prixUnitaire),{ x: W - margin - 130, y: y + 4, size: 10 });
    drawText(fmtEURPdf(total),          { x: W - margin - 12,  y: y + 4, size: 10, align: 'right' });
    y -= 18;
    page.drawLine({ start: { x: margin, y: y + 12 }, end: { x: W - margin, y: y + 12 }, thickness: 0.4, color: rgb(0.85, 0.86, 0.9) });
  });

  // Totaux
  y -= 14;
  drawText('Total HT',                 { x: W - margin - 130, y: y + 4, size: 10 });
  drawText(fmtEURPdf(d.totalHT || 0),  { x: W - margin - 12,  y: y + 4, size: 10, align: 'right' });
  y -= 14;

  if (Number(d.tva) > 0) {
    drawText(`TVA (${d.tva}%)`,           { x: W - margin - 130, y: y + 4, size: 10 });
    drawText(fmtEURPdf(d.totalTVA || 0),  { x: W - margin - 12,  y: y + 4, size: 10, align: 'right' });
    y -= 14;
  }

  page.drawLine({ start: { x: W - margin - 200, y: y + 12 }, end: { x: W - margin, y: y + 12 }, thickness: 0.6, color: rgb(0.4, 0.18, 0.6) });
  drawText('Total TTC',                  { x: W - margin - 130, y: y - 4, size: 12, bold: true });
  drawText(fmtEURPdf(d.totalTTC || 0),   { x: W - margin - 12,  y: y - 4, size: 12, bold: true, align: 'right', color: rgb(0.55, 0.25, 0.85) });
  y -= 28;

  // Mention TVA si 0
  if (Number(d.tva) === 0) {
    y -= 8;
    drawText(BUSINESS_INFO.mentionTVA, { size: 8, color: rgb(0.5, 0.5, 0.55) });
    y -= 14;
  }

  // Notes
  if (d.notes) {
    y -= 12;
    drawText('Notes :', { size: 9, bold: true, color: rgb(0.4, 0.4, 0.5) }); y -= 11;
    splitTextLines(d.notes, 90).forEach((line) => {
      drawText(line, { size: 9 }); y -= 11;
    });
  }

  // Bloc "Bon pour accord"
  y = Math.max(y - 30, 130);
  page.drawRectangle({ x: margin, y: y - 60, width: W - 2 * margin, height: 70, color: rgb(0.97, 0.97, 0.99), borderColor: rgb(0.4, 0.18, 0.6), borderWidth: 0.5 });
  drawText('Bon pour accord', { x: margin + 12, y: y - 12, size: 10, bold: true, color: rgb(0.4, 0.18, 0.6) });
  drawText('Date :   ………………………………………', { x: margin + 12, y: y - 30, size: 9 });
  drawText('Signature précédée de la mention "Bon pour accord" :', { x: margin + 12, y: y - 46, size: 8, color: rgb(0.5, 0.5, 0.55) });

  // Pied de page
  drawText(`Devis émis par ${BUSINESS_INFO.nom} · ${BUSINESS_INFO.site}`, {
    x: margin, y: 30, size: 8, color: rgb(0.55, 0.55, 0.6),
  });

  return await doc.save();
}

function sanitizeForPdf(s) {
  return s
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}]/gu, '')
    .replace(/€/g, 'EUR')
    .trim();
}

function fmtEURPdf(n) {
  const v = Number(n) || 0;
  return new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v) + ' EUR';
}

function formatDateFR(iso) {
  if (!iso) return '–';
  return new Date(iso + 'T12:00:00').toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function splitTextLines(text, maxChars) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let cur = '';
  words.forEach((w) => {
    if ((cur + ' ' + w).trim().length > maxChars) {
      if (cur) lines.push(cur);
      cur = w;
    } else {
      cur = (cur + ' ' + w).trim();
    }
  });
  if (cur) lines.push(cur);
  return lines;
}

// ─── Souscriptions + wiring ───────────────────────────────────────────────
on('devis:changed', () => {
  renderStats();
  renderDevisList();
});

document.getElementById('devisSearch')?.addEventListener('input', (e) => setDevisSearch(e.target.value));
document.getElementById('devTva')?.addEventListener('input',          recomputeFormTotals);
document.getElementById('devisModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'devisModal') closeDevisForm();
});
attachClientSearch();

// Compat handlers inline
window.openDevisForm        = openDevisForm;
window.closeDevisForm       = closeDevisForm;
window.addDevisLine         = addDevisLine;
window.removeDevisLine      = removeDevisLine;
window.saveDevis            = saveDevis;
window.setDevisStatus       = setDevisStatus;
window.deleteDevis          = deleteDevis;
window.convertDevisToFacture= convertDevisToFacture;
window.downloadDevisPdf     = downloadDevisPdf;
window.setDevisFilter       = setDevisFilter;
window.goToFactureFromDevis = goToFactureFromDevis;
