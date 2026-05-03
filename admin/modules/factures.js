// ─────────────────────────────────────────────────────────────────────────────
// factures.js — Émission, suivi et PDF des factures clients.
//
// Numérotation atomique séquentielle via Firestore runTransaction sur
// `counters/factures-{YYYY}` — pas de Cloud Function nécessaire tant qu'on
// est mono-admin (les transactions Firestore garantissent l'unicité).
//
// Génération PDF côté navigateur via pdf-lib (lazy-loaded à la première
// utilisation pour ne pas charger ~500 KB sur chaque session admin).
//
// Statut affiché dérivé du champ `paid` + date d'échéance :
//   - paid=true                  → 'paid'
//   - paid=false & today > due   → 'late'
//   - paid=false                 → 'unpaid'
// ─────────────────────────────────────────────────────────────────────────────

import { db, fns } from '../core/firebase.js';
import { store, emit, on } from '../core/store.js';
import { BUSINESS_INFO, PAIEMENT_MODES } from '../core/ui.js';

const PDF_LIB_URL = 'https://cdn.jsdelivr.net/npm/pdf-lib@1.17.1/dist/pdf-lib.min.js';

// État local
let allFactures   = [];
let currentFilter = 'all';
let currentSearch = '';
let editingId     = null;     // id de la facture en cours d'édition (null = nouvelle)
let formLines     = [];       // [{ description, quantite, prixUnitaire }]

// ─── Chargement ───────────────────────────────────────────────────────────
export async function loadFactures() {
  try {
    const { collection, getDocs, query, orderBy } = fns;
    const q    = query(collection(db, 'factures'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    allFactures = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    emit('factures:changed');
  } catch (e) {
    console.error('factures load:', e);
    document.getElementById('facturesList').innerHTML =
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

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysISO(iso, days) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function statusOf(f) {
  if (f.paid) return 'paid';
  if (f.echeance && new Date(f.echeance + 'T23:59:59') < new Date()) return 'late';
  return 'unpaid';
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function recomputeLineTotals(line) {
  const qty = Number(line.quantite) || 0;
  const pu  = Number(line.prixUnitaire) || 0;
  return qty * pu;
}

// ─── Numérotation atomique ────────────────────────────────────────────────
async function allocateInvoiceNumber() {
  const { runTransaction, doc } = fns;
  const year = new Date().getFullYear();
  const counterRef = doc(db, 'counters', `factures-${year}`);
  const seq = await runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    const last = snap.exists() ? (snap.data().last || 0) : 0;
    const next = last + 1;
    tx.set(counterRef, { last: next, year, updatedAt: Date.now() }, { merge: true });
    return next;
  });
  return {
    numero:   `MK-${year}-${String(seq).padStart(4, '0')}`,
    sequence: seq,
    year,
  };
}

// ─── Stats encart KPI ─────────────────────────────────────────────────────
function renderStats() {
  const oneYearAgo = Date.now() - 365 * 24 * 3600 * 1000;
  let paidSum = 0, paidCount = 0;
  let unpaidSum = 0, unpaidCount = 0;
  let lateSum = 0, lateCount = 0;

  allFactures.forEach((f) => {
    const st = statusOf(f);
    if (st === 'paid') {
      const ts = f.createdAt?.toMillis?.() || f.createdAtMs || Date.now();
      if (ts >= oneYearAgo) {
        paidSum   += Number(f.totalTTC) || 0;
        paidCount += 1;
      }
    } else if (st === 'late') {
      lateSum   += Number(f.totalTTC) || 0;
      lateCount += 1;
    } else {
      unpaidSum   += Number(f.totalTTC) || 0;
      unpaidCount += 1;
    }
  });

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('facStatPaid',        fmtEUR(paidSum));
  set('facStatPaidCount',   `${paidCount} facture${paidCount > 1 ? 's' : ''} encaissée${paidCount > 1 ? 's' : ''}`);
  set('facStatUnpaid',      fmtEUR(unpaidSum));
  set('facStatUnpaidCount', `${unpaidCount} en attente`);
  set('facStatLate',         fmtEUR(lateSum));
  set('facStatLateCount',    `${lateCount} en retard`);
}

// ─── Liste factures ───────────────────────────────────────────────────────
function setFactureFilter(f, btn) {
  currentFilter = f;
  document.querySelectorAll('#tab-factures .tab-filter').forEach((t) => t.classList.remove('active'));
  btn.classList.add('active');
  renderFacturesList();
}

function setFactureSearch(q) {
  currentSearch = (q || '').toLowerCase();
  renderFacturesList();
}

function renderFacturesList() {
  const list = document.getElementById('facturesList');
  if (!list) return;

  let arr = allFactures.slice();
  if (currentFilter !== 'all') {
    arr = arr.filter((f) => statusOf(f) === currentFilter);
  }
  if (currentSearch) {
    arr = arr.filter((f) =>
      (f.numero || '').toLowerCase().includes(currentSearch) ||
      (f.client?.nom || '').toLowerCase().includes(currentSearch) ||
      (f.client?.email || '').toLowerCase().includes(currentSearch) ||
      String(Math.round(Number(f.totalTTC) || 0)).includes(currentSearch),
    );
  }

  if (arr.length === 0) {
    list.innerHTML =
      '<div class="empty-state"><div class="empty-icon">🧾</div>Aucune facture pour le moment.</div>';
    return;
  }

  list.innerHTML = arr.map(factureRowHtml).join('');
}

const STATUS_LABEL = {
  paid:   '✓ Payée',
  unpaid: '⏳ Impayée',
  late:   '⚠ En retard',
};

function factureRowHtml(f) {
  const st     = statusOf(f);
  const dateF  = f.date    ? new Date(f.date    + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: '2-digit' }) : '–';
  const dateE  = f.echeance? new Date(f.echeance + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: '2-digit' }) : null;
  const client = f.client?.nom || f.client?.email || '–';

  return `
    <div class="fac-row ${st}">
      <div class="fac-num">${escapeHtml(f.numero || '–')}</div>
      <div class="fac-row-main">
        <div class="fac-row-client">${escapeHtml(client)}</div>
        <div class="fac-row-meta">
          📅 ${dateF}${dateE ? ` · échéance ${dateE}` : ''}
          ${f.client?.email ? ` · 📧 ${escapeHtml(f.client.email)}` : ''}
        </div>
      </div>
      <div class="fac-row-amount">
        ${fmtEUR(Number(f.totalTTC) || 0)}
        <div style="margin-top:0.2rem"><span class="fac-status-pill fac-status-${st}">${STATUS_LABEL[st]}</span></div>
      </div>
      <div class="fac-row-actions">
        <button class="btn-soft" onclick="downloadFacturePdf('${f.id}')" title="Télécharger PDF">📄</button>
        <button class="btn-soft" onclick="openFactureForm('${f.id}')" title="Modifier">✏️</button>
        <button class="btn-${f.paid ? 'soft' : 'confirm'}" onclick="toggleFacturePaid('${f.id}')" title="Statut paiement">${f.paid ? '↩ Impayée' : '✓ Payée'}</button>
        <button class="btn-cancel" onclick="deleteFacture('${f.id}')" title="Supprimer" style="flex:0 0 auto;padding:0.4rem 0.6rem">🗑</button>
      </div>
    </div>`;
}

// ─── Form : ouvrir en création ou édition ────────────────────────────────
function openFactureForm(id = null) {
  editingId = id;
  const f = id ? allFactures.find((x) => x.id === id) : null;

  document.getElementById('factureModalTitle').textContent =
    f ? `Facture ${f.numero}` : 'Nouvelle facture';
  document.getElementById('facSavePdfBtn').textContent =
    f ? '💾 + 📄 PDF' : '💾 + 📄 PDF';

  document.getElementById('facClientNom').value     = f?.client?.nom       || '';
  document.getElementById('facClientEmail').value   = f?.client?.email     || '';
  document.getElementById('facClientTel').value     = f?.client?.telephone || '';
  document.getElementById('facClientAdresse').value = f?.client?.adresse   || '';
  document.getElementById('facClientSearch').value  = '';
  document.getElementById('facClientSuggest').style.display = 'none';

  const date = f?.date || todayISO();
  document.getElementById('facDate').value = date;
  document.getElementById('facEcheance').value =
    f?.echeance || addDaysISO(date, BUSINESS_INFO.delaiPaiementJours || 30);

  document.getElementById('facPaiement').value = f?.paiement || 'virement';
  document.getElementById('facTva').value      = (f?.tva ?? 0);
  document.getElementById('facPaid').checked   = !!f?.paid;
  document.getElementById('facNotes').value    = f?.notes || '';

  formLines = (f?.items?.length ? f.items : [{ description: '', quantite: 1, prixUnitaire: 0 }])
    .map((it) => ({
      description:  it.description  || '',
      quantite:     Number(it.quantite) || 0,
      prixUnitaire: Number(it.prixUnitaire) || 0,
    }));
  renderFormLines();
  recomputeFormTotals();

  document.getElementById('factureModal').classList.add('show');
}

function closeFactureForm() {
  document.getElementById('factureModal').classList.remove('show');
  editingId = null;
  formLines = [];
}

function renderFormLines() {
  const host = document.getElementById('facLinesList');
  host.innerHTML = formLines.map((l, i) => `
    <div class="fac-line" data-i="${i}">
      <input class="form-input fac-line-desc" placeholder="Description de la prestation" value="${escapeHtml(l.description)}">
      <input class="form-input fac-line-qty"  type="number" min="0" step="0.5" value="${l.quantite}">
      <input class="form-input fac-line-pu"   type="number" min="0" step="0.01" value="${l.prixUnitaire}">
      <div class="fac-line-total">${fmtEUR(recomputeLineTotals(l))}</div>
      <button class="fac-line-del" onclick="removeFactureLine(${i})">✕</button>
    </div>`).join('');

  host.querySelectorAll('.fac-line').forEach((row) => {
    const i = Number(row.dataset.i);
    row.querySelector('.fac-line-desc').addEventListener('input', (e) => {
      formLines[i].description = e.target.value;
    });
    row.querySelector('.fac-line-qty').addEventListener('input', (e) => {
      formLines[i].quantite = Number(e.target.value) || 0;
      row.querySelector('.fac-line-total').textContent = fmtEUR(recomputeLineTotals(formLines[i]));
      recomputeFormTotals();
    });
    row.querySelector('.fac-line-pu').addEventListener('input', (e) => {
      formLines[i].prixUnitaire = Number(e.target.value) || 0;
      row.querySelector('.fac-line-total').textContent = fmtEUR(recomputeLineTotals(formLines[i]));
      recomputeFormTotals();
    });
  });
}

function addFactureLine() {
  formLines.push({ description: '', quantite: 1, prixUnitaire: 0 });
  renderFormLines();
}

function removeFactureLine(i) {
  formLines.splice(i, 1);
  if (formLines.length === 0) formLines.push({ description: '', quantite: 1, prixUnitaire: 0 });
  renderFormLines();
  recomputeFormTotals();
}

function recomputeFormTotals() {
  const totalHT = formLines.reduce((s, l) => s + recomputeLineTotals(l), 0);
  const tva     = Number(document.getElementById('facTva').value) || 0;
  const totalTVA = totalHT * tva / 100;
  const totalTTC = totalHT + totalTVA;

  document.getElementById('facTotalHT').textContent  = fmtEUR(totalHT);
  document.getElementById('facTotalTVA').textContent = fmtEUR(totalTVA);
  document.getElementById('facTotalTTC').textContent = fmtEUR(totalTTC);
  document.getElementById('facTotalTvaRow').style.display = tva > 0 ? 'flex' : 'none';

  return { totalHT, totalTVA, totalTTC, tva };
}

// ─── Suggestions clients (pré-remplit à partir des RDV/contrats) ────────
function buildClientCandidates() {
  const map = new Map();
  const push = (src) => {
    if (!src.email && !src.telephone) return;
    const key = (src.email || src.telephone || '').toLowerCase();
    if (!map.has(key)) {
      map.set(key, {
        nom:       src.nom       || '',
        email:     src.email     || '',
        telephone: src.telephone || '',
        adresse:   src.adresse   || '',
      });
    }
  };
  store.allRdvs.forEach(push);
  store.allContrats.forEach(push);
  return Array.from(map.values());
}

function attachClientSearch() {
  const input  = document.getElementById('facClientSearch');
  const drop   = document.getElementById('facClientSuggest');
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
        document.getElementById('facClientNom').value     = c.nom       || '';
        document.getElementById('facClientEmail').value   = c.email     || '';
        document.getElementById('facClientTel').value     = c.telephone || '';
        document.getElementById('facClientAdresse').value = c.adresse   || '';
        drop.style.display = 'none';
        input.value = '';
      };
    });
  });

  input.addEventListener('blur', () => setTimeout(() => { drop.style.display = 'none'; }, 200));
}

// ─── Sauvegarde ───────────────────────────────────────────────────────────
async function saveFacture(downloadPdf) {
  const nom     = document.getElementById('facClientNom').value.trim();
  const email   = document.getElementById('facClientEmail').value.trim();
  const tel     = document.getElementById('facClientTel').value.trim();
  const adresse = document.getElementById('facClientAdresse').value.trim();

  if (!nom && !email) {
    alert('Indique au moins un nom ou un email pour le client.');
    return;
  }

  const items = formLines
    .filter((l) => (l.description || '').trim() && Number(l.prixUnitaire) > 0)
    .map((l) => ({
      description:  l.description.trim(),
      quantite:     Number(l.quantite) || 0,
      prixUnitaire: Number(l.prixUnitaire) || 0,
    }));

  if (items.length === 0) {
    alert('Ajoute au moins une ligne avec une description et un prix.');
    return;
  }

  const totals  = recomputeFormTotals();
  const date    = document.getElementById('facDate').value || todayISO();
  const echeance= document.getElementById('facEcheance').value || addDaysISO(date, BUSINESS_INFO.delaiPaiementJours || 30);
  const paiement= document.getElementById('facPaiement').value;
  const paid    = document.getElementById('facPaid').checked;
  const notes   = document.getElementById('facNotes').value.trim();

  const btnSave = document.getElementById('facSaveBtn');
  const btnPdf  = document.getElementById('facSavePdfBtn');
  btnSave.disabled = true; btnPdf.disabled = true;

  try {
    const { collection, doc, addDoc, updateDoc, serverTimestamp } = fns;

    let savedId = editingId;
    let payload = {
      client:    { nom, email, telephone: tel, adresse },
      date, echeance,
      items,
      totalHT:   totals.totalHT,
      tva:       totals.tva,
      totalTVA:  totals.totalTVA,
      totalTTC:  totals.totalTTC,
      paiement,
      paid,
      paidAt:    paid ? (Date.now()) : null,
      notes,
      updatedAt: serverTimestamp(),
    };

    if (editingId) {
      await updateDoc(doc(db, 'factures', editingId), payload);
      const idx = allFactures.findIndex((x) => x.id === editingId);
      if (idx >= 0) allFactures[idx] = { ...allFactures[idx], ...payload };
    } else {
      // Nouvelle facture : on alloue un numéro
      const { numero, sequence, year } = await allocateInvoiceNumber();
      payload = {
        ...payload,
        numero,
        sequence,
        year,
        createdAt:   serverTimestamp(),
        createdAtMs: Date.now(),
      };
      const ref = await addDoc(collection(db, 'factures'), payload);
      savedId = ref.id;
      allFactures.unshift({ id: savedId, ...payload });
    }

    emit('factures:changed');

    if (downloadPdf) {
      const f = allFactures.find((x) => x.id === savedId);
      if (f) await downloadInvoicePdf(f);
    }

    closeFactureForm();
  } catch (e) {
    console.error(e);
    alert('Erreur enregistrement : ' + (e?.message || e));
  } finally {
    btnSave.disabled = false; btnPdf.disabled = false;
  }
}

async function toggleFacturePaid(id) {
  const f = allFactures.find((x) => x.id === id);
  if (!f) return;
  try {
    const { doc, updateDoc } = fns;
    const paid = !f.paid;
    await updateDoc(doc(db, 'factures', id), { paid, paidAt: paid ? Date.now() : null });
    f.paid   = paid;
    f.paidAt = paid ? Date.now() : null;
    emit('factures:changed');
  } catch (e) {
    console.error(e);
    alert('Erreur mise à jour du statut.');
  }
}

async function deleteFacture(id) {
  const f = allFactures.find((x) => x.id === id);
  if (!confirm(`Supprimer la facture ${f?.numero || ''} ?\n(le numéro reste consommé dans la séquence)`)) return;
  try {
    const { doc, deleteDoc } = fns;
    await deleteDoc(doc(db, 'factures', id));
    allFactures = allFactures.filter((x) => x.id !== id);
    emit('factures:changed');
  } catch (e) {
    console.error(e);
    alert('Erreur suppression.');
  }
}

// ─── Génération PDF (pdf-lib lazy-loaded) ─────────────────────────────────
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

async function downloadInvoicePdf(f) {
  try {
    const bytes = await buildInvoicePdf(f);
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `${f.numero || 'facture'}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) {
    console.error(e);
    alert('Erreur génération PDF : ' + (e?.message || e));
  }
}

async function downloadFacturePdf(id) {
  const f = allFactures.find((x) => x.id === id);
  if (!f) return;
  await downloadInvoicePdf(f);
}

async function buildInvoicePdf(f) {
  const PDFLib = await ensurePdfLib();
  const { PDFDocument, StandardFonts, rgb } = PDFLib;

  const doc  = await PDFDocument.create();
  const page = doc.addPage([595.28, 841.89]); // A4
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

  // Bandeau titre
  y -= 16;
  page.drawRectangle({ x: margin, y: y - 4, width: W - 2 * margin, height: 32, color: rgb(0.05, 0.08, 0.18) });
  drawText('FACTURE', { x: margin + 12, y: y + 8, size: 18, bold: true, color: rgb(1, 1, 1) });
  drawText(f.numero || '', { x: W - margin - 12, y: y + 12, size: 12, bold: true, color: rgb(0.55, 0.7, 1), align: 'right' });
  drawText(`Date : ${formatDateFR(f.date)}`, { x: W - margin - 12, y: y - 2, size: 8, color: rgb(0.8, 0.8, 1), align: 'right' });
  y -= 36;

  // Bloc client
  y -= 14;
  drawText('Facturé à :', { size: 9, bold: true, color: rgb(0.4, 0.4, 0.5) }); y -= 14;
  drawText(f.client?.nom || '–', { size: 11, bold: true }); y -= 13;
  if (f.client?.adresse) { drawText(f.client.adresse, { size: 9 }); y -= 11; }
  if (f.client?.email)   { drawText(f.client.email,   { size: 9 }); y -= 11; }
  if (f.client?.telephone){drawText(f.client.telephone,{size: 9 }); y -= 11; }

  // Échéance
  y -= 8;
  drawText(`Date d'échéance : ${formatDateFR(f.echeance)}`, { size: 9, color: rgb(0.4, 0.4, 0.5) });

  // Tableau lignes
  y -= 26;
  page.drawRectangle({ x: margin, y: y - 4, width: W - 2 * margin, height: 22, color: rgb(0.93, 0.94, 0.97) });
  drawText('Description', { x: margin + 8,                  y: y + 4, size: 9, bold: true });
  drawText('Qté',         { x: W - margin - 200,            y: y + 4, size: 9, bold: true });
  drawText('PU HT',       { x: W - margin - 130,            y: y + 4, size: 9, bold: true });
  drawText('Total HT',    { x: W - margin - 12,             y: y + 4, size: 9, bold: true, align: 'right' });
  y -= 18;

  (f.items || []).forEach((it) => {
    if (y < 100) {
      // (pas de saut de page géré ici — V1 tient sur une page pour des factures simples)
      return;
    }
    const total = (Number(it.quantite) || 0) * (Number(it.prixUnitaire) || 0);
    drawText(it.description || '–', { x: margin + 8,         y: y + 4, size: 10 });
    drawText(String(it.quantite),   { x: W - margin - 200,  y: y + 4, size: 10 });
    drawText(fmtEURPdf(it.prixUnitaire), { x: W - margin - 130, y: y + 4, size: 10 });
    drawText(fmtEURPdf(total),      { x: W - margin - 12,    y: y + 4, size: 10, align: 'right' });
    y -= 18;
    page.drawLine({ start: { x: margin, y: y + 12 }, end: { x: W - margin, y: y + 12 }, thickness: 0.4, color: rgb(0.85, 0.86, 0.9) });
  });

  // Totaux
  y -= 14;
  drawText('Total HT', { x: W - margin - 130, y: y + 4, size: 10 });
  drawText(fmtEURPdf(f.totalHT || 0), { x: W - margin - 12, y: y + 4, size: 10, align: 'right' });
  y -= 14;

  if (Number(f.tva) > 0) {
    drawText(`TVA (${f.tva}%)`, { x: W - margin - 130, y: y + 4, size: 10 });
    drawText(fmtEURPdf(f.totalTVA || 0), { x: W - margin - 12, y: y + 4, size: 10, align: 'right' });
    y -= 14;
  }

  page.drawLine({ start: { x: W - margin - 200, y: y + 12 }, end: { x: W - margin, y: y + 12 }, thickness: 0.6, color: rgb(0.4, 0.4, 0.5) });
  drawText('Total TTC',                  { x: W - margin - 130, y: y - 4, size: 12, bold: true });
  drawText(fmtEURPdf(f.totalTTC || 0),   { x: W - margin - 12,  y: y - 4, size: 12, bold: true, align: 'right', color: rgb(0.23, 0.51, 0.96) });
  y -= 28;

  // Mention TVA si 0
  if (Number(f.tva) === 0) {
    y -= 8;
    drawText(BUSINESS_INFO.mentionTVA, { size: 8, color: rgb(0.5, 0.5, 0.55) });
    y -= 14;
  }

  // Modalités de paiement
  y -= 6;
  const paiementLabel = (PAIEMENT_MODES.find((p) => p.id === f.paiement)?.label) || f.paiement || '–';
  drawText(`Paiement : ${paiementLabel}`, { size: 9 }); y -= 12;
  if (BUSINESS_INFO.iban && BUSINESS_INFO.iban !== 'À COMPLÉTER') {
    drawText(`IBAN : ${BUSINESS_INFO.iban}`, { size: 9 }); y -= 11;
  }
  if (BUSINESS_INFO.bic && BUSINESS_INFO.bic !== 'À COMPLÉTER') {
    drawText(`BIC : ${BUSINESS_INFO.bic}`, { size: 9 }); y -= 11;
  }

  // Notes
  if (f.notes) {
    y -= 12;
    drawText('Notes :', { size: 9, bold: true, color: rgb(0.4, 0.4, 0.5) }); y -= 11;
    splitTextLines(f.notes, 90).forEach((line) => {
      drawText(line, { size: 9 }); y -= 11;
    });
  }

  // Pied de page
  drawText(`Facture émise par ${BUSINESS_INFO.nom} · ${BUSINESS_INFO.site}`, {
    x: margin, y: 30, size: 8, color: rgb(0.55, 0.55, 0.6),
  });

  return await doc.save();
}

// pdf-lib StandardFonts ne gèrent pas tous les caractères Unicode → on
// nettoie les emojis et caractères qui posent problème. Les accents sont OK.
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
on('factures:changed', () => {
  renderStats();
  renderFacturesList();
});

document.getElementById('facturesSearch')?.addEventListener('input', (e) => setFactureSearch(e.target.value));
document.getElementById('facTva')?.addEventListener('input',          recomputeFormTotals);
document.getElementById('factureModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'factureModal') closeFactureForm();
});
attachClientSearch();

// Compat handlers inline
window.openFactureForm     = openFactureForm;
window.closeFactureForm    = closeFactureForm;
window.addFactureLine      = addFactureLine;
window.removeFactureLine   = removeFactureLine;
window.saveFacture         = saveFacture;
window.toggleFacturePaid   = toggleFacturePaid;
window.deleteFacture       = deleteFacture;
window.downloadFacturePdf  = downloadFacturePdf;
window.setFactureFilter    = setFactureFilter;
