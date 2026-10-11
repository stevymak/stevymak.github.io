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

import { db, fns, callSendInvoiceReminder } from '../core/firebase.js';
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
        ${!f.paid && f.client?.email
          ? `<button class="btn-reminder" data-fac-reminder-id="${f.id}" onclick="sendFactureReminder('${f.id}')" title="Envoyer une relance email">📧 ${f.reminderSendCount ? `Relance ${f.reminderSendCount + 1}` : 'Relance'}</button>`
          : ''}
        <button class="btn-${f.paid ? 'soft' : 'confirm'}" onclick="toggleFacturePaid('${f.id}')" title="Statut paiement">${f.paid ? '↩ Impayée' : '✓ Payée'}</button>
        <button class="btn-cancel" onclick="deleteFacture('${f.id}')" title="Supprimer" style="flex:0 0 auto;padding:0.4rem 0.6rem">🗑</button>
      </div>
      ${f.reminderSendCount && !f.paid
        ? `<div class="reminder-status" style="grid-column:1/-1;text-align:right;font-size:0.72rem;color:var(--muted);margin-top:0.25rem">Dernière relance : ${reminderTimeLabel(f)} · ${f.reminderSendCount}/3</div>`
        : ''}
    </div>`;
}

function reminderTimeLabel(f) {
  const ts = f.reminderSentAt?.toDate?.() || (f.reminderSentAtMs ? new Date(f.reminderSentAtMs) : null);
  if (!ts) return '–';
  return ts.toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
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
      clientEmailLc: email.toLowerCase(),   // sert à retrouver la facture pour l'email de remerciement
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

    // PDF généré une seule fois : copie conservée pour l'email de remerciement
    // + téléchargement si on a cliqué sur « Enregistrer + PDF ».
    const saved = allFactures.find((x) => x.id === savedId);
    if (saved) {
      let bytes = null;
      try {
        bytes = await buildInvoicePdf(saved);
        await storeInvoicePdf(saved.id, saved.numero, bytes);
      } catch (e) {
        console.error('facture pdf store:', e);
        alert("Facture enregistrée, mais la copie PDF destinée à l'email client n'a pas pu être sauvegardée.\n" + (e?.message || e));
      }
      if (downloadPdf) {
        try {
          bytes = bytes || await buildInvoicePdf(saved);
          triggerPdfDownload(bytes, saved.numero);
        } catch (e) {
          console.error(e);
          alert('Erreur génération PDF : ' + (e?.message || e));
        }
      }
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
    try { await storeInvoicePdf(f.id, f.numero, await buildInvoicePdf(f)); }
    catch (e) { console.error('facture pdf refresh:', e); }
  } catch (e) {
    console.error(e);
    alert('Erreur mise à jour du statut.');
  }
}

async function sendFactureReminder(id) {
  const f = allFactures.find((x) => x.id === id);
  if (!f) return;
  if (!f.client?.email) {
    alert('Pas d\'email client sur cette facture.');
    return;
  }

  const sent = Number(f.reminderSendCount || 0);
  if (sent >= 3) {
    alert('Plafond de 3 relances atteint.');
    return;
  }

  if (sent > 0) {
    const last = reminderTimeLabel(f);
    if (!confirm(`Une relance a déjà été envoyée le ${last}.\nEnvoyer une ${sent + 1}ᵉ relance ?`)) return;
  } else {
    if (!confirm(`Envoyer une relance à ${f.client.email} pour la facture ${f.numero} ?`)) return;
  }

  const btn = document.querySelector(`[data-fac-reminder-id="${id}"]`);
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Envoi…'; }

  try {
    const res = await callSendInvoiceReminder({ factureId: id });
    if (res.data?.skipped) {
      alert(`Relance non envoyée (${res.data.reason}).`);
      if (btn) { btn.disabled = false; btn.textContent = '📧 Relance'; }
      return;
    }
    // Mise à jour locale optimiste
    f.reminderSendCount = (f.reminderSendCount || 0) + 1;
    f.reminderSent      = true;
    f.reminderSentAt    = { toDate: () => new Date() };
    f.reminderSentAtMs  = Date.now();

    if (btn) {
      btn.textContent = '✅ Relance envoyée';
      btn.style.color = 'var(--success)';
    }
    setTimeout(() => emit('factures:changed'), 2000);
  } catch (e) {
    console.error(e);
    if (btn) { btn.disabled = false; btn.textContent = '❌ Échec'; btn.style.color = 'var(--danger)'; }
    alert('Impossible d\'envoyer la relance.\n' + (e?.message || e));
    setTimeout(() => emit('factures:changed'), 2500);
  }
}

async function deleteFacture(id) {
  const f = allFactures.find((x) => x.id === id);
  if (!confirm(`Supprimer la facture ${f?.numero || ''} ?\n(le numéro reste consommé dans la séquence)`)) return;
  try {
    const { doc, deleteDoc } = fns;
    await deleteDoc(doc(db, 'factures', id));
    deleteDoc(doc(db, 'factures_pdf', id)).catch(() => {});
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

function triggerPdfDownload(bytes, numero) {
  const blob = new Blob([bytes], { type: 'application/pdf' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `${numero || 'facture'}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function bytesToBase64(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

// Copie du PDF dans `factures_pdf/{id}` (collection séparée pour ne pas
// alourdir la liste des factures). La Cloud Function « Terminé » la joint
// à l'email de remerciement.
async function storeInvoicePdf(id, numero, bytes) {
  const base64 = bytesToBase64(bytes);
  if (base64.length > 900000) throw new Error('PDF trop volumineux pour être stocké');
  const { doc, setDoc, serverTimestamp } = fns;
  await setDoc(doc(db, 'factures_pdf', id), {
    numero:    numero || '',
    base64,
    updatedAt: serverTimestamp(),
  });
}

async function downloadInvoicePdf(f) {
  try {
    const bytes = await buildInvoicePdf(f);
    triggerPdfDownload(bytes, f.numero);
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

  const doc      = await PDFDocument.create();
  const helv     = await doc.embedFont(StandardFonts.Helvetica);
  const helvBold = await doc.embedFont(StandardFonts.HelveticaBold);

  doc.setTitle(`Facture ${f.numero || ''}`.trim());
  doc.setAuthor(BUSINESS_INFO.nom || '');
  doc.setCreator(BUSINESS_INFO.nom || '');

  // ── Gabarit ──────────────────────────────────────────────────────────
  const W = 595.28, H = 841.89;
  const M  = 42;                 // marges gauche / droite
  const CW = W - 2 * M;          // largeur utile
  const FOOTER_H = 60;           // hauteur réservée au pied de page
  const BOTTOM   = FOOTER_H + 16; // limite basse du contenu

  const C = {
    ink:    rgb(0.10, 0.11, 0.15),
    muted:  rgb(0.42, 0.45, 0.52),
    line:   rgb(0.87, 0.89, 0.93),
    band:   rgb(0.96, 0.97, 0.99),
    accent: rgb(0.05, 0.08, 0.18),
    blue:   rgb(0.23, 0.51, 0.96),
    green:  rgb(0.09, 0.55, 0.30),
    red:    rgb(0.78, 0.16, 0.16),
    white:  rgb(1, 1, 1),
  };

  const pages = [];
  let page, y;

  // ── Helpers de dessin ────────────────────────────────────────────────
  const font    = (bold) => (bold ? helvBold : helv);
  const clean   = (s) => sanitizeForPdf(s);
  const widthOf = (s, size, bold) => font(bold).widthOfTextAtSize(clean(s), size);

  // align 'right' : x = bord droit du texte
  const text = (s, x, yy, { size = 10, bold = false, color = C.ink, align = 'left' } = {}) => {
    const t = clean(s);
    if (!t) return;
    const px = align === 'right' ? x - widthOf(t, size, bold) : x;
    page.drawText(t, { x: px, y: yy, size, font: font(bold), color });
  };
  const fill = (x, yy, w, h, color) =>
    page.drawRectangle({ x, y: yy, width: w, height: h, color });
  const hline = (x1, x2, yy, color = C.line, thickness = 0.6) =>
    page.drawLine({ start: { x: x1, y: yy }, end: { x: x2, y: yy }, thickness, color });
  const label = (s, x, yy) => text(String(s).toUpperCase(), x, yy, { size: 7.5, bold: true, color: C.muted });

  // Retour à la ligne automatique (gère aussi les \n et les mots trop longs)
  const wrap = (s, maxW, size, bold) => {
    const out = [];
    String(s ?? '').split(/\r?\n/).forEach((para) => {
      const words = para.split(/\s+/).filter(Boolean);
      if (words.length === 0) { out.push(''); return; }
      let cur = '';
      const flush = () => { if (cur) out.push(cur); cur = ''; };
      words.forEach((word) => {
        let w = word;
        while (widthOf(w, size, bold) > maxW && w.length > 1) {
          let cut = w.length - 1;
          while (cut > 1 && widthOf(w.slice(0, cut), size, bold) > maxW) cut--;
          flush();
          out.push(w.slice(0, cut));
          w = w.slice(cut);
        }
        const test = cur ? `${cur} ${w}` : w;
        if (widthOf(test, size, bold) <= maxW) cur = test;
        else { flush(); cur = w; }
      });
      flush();
    });
    return out;
  };

  // ── Pages ────────────────────────────────────────────────────────────
  const newPage = () => {
    page = doc.addPage([W, H]);
    pages.push(page);
    fill(0, H - 8, W, 8, C.accent);
    y = H - 8;
  };

  const continuationPage = () => {
    newPage();
    y -= 36;
    text(BUSINESS_INFO.nom, M, y, { size: 11, bold: true, color: C.accent });
    text(`Facture ${f.numero || ''} (suite)`, W - M, y, { size: 10, bold: true, color: C.blue, align: 'right' });
    y -= 12;
    hline(M, W - M, y);
    y -= 22;
  };

  // S'assure qu'il reste h points avant le pied de page, sinon nouvelle page
  const ensureSpace = (h) => {
    if (y - h < BOTTOM) { continuationPage(); return true; }
    return false;
  };

  // ── Données ──────────────────────────────────────────────────────────
  const status = statusOf(f);
  const paid   = status === 'paid';
  const items  = Array.isArray(f.items) ? f.items : [];
  const paiementLabel = (PAIEMENT_MODES.find((p) => p.id === f.paiement)?.label) || f.paiement || '–';
  const paidDate = f.paidAt ? new Date(f.paidAt).toLocaleDateString('fr-FR') : null;
  const fmtQty = (q) => new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 }).format(Number(q) || 0);
  const fmtIban = (s) => String(s).replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim();

  // ═════════════════════════════════════════════════════════════════════
  // PAGE 1 : en-tête
  // ═════════════════════════════════════════════════════════════════════
  newPage();
  y -= 40;
  text(BUSINESS_INFO.nom, M, y, { size: 17, bold: true, color: C.accent });
  text('FACTURE', W - M, y + 1, { size: 24, bold: true, color: C.accent, align: 'right' });
  y -= 18;
  text(BUSINESS_INFO.formeJuridique, M, y, { size: 9, color: C.muted });
  text(f.numero || '', W - M, y, { size: 12, bold: true, color: C.blue, align: 'right' });

  if (paid) {
    y -= 22;
    const badge = `PAYÉE${paidDate ? ' LE ' + paidDate : ''}`;
    const bw = widthOf(badge, 8.5, true) + 20;
    page.drawRectangle({ x: W - M - bw, y: y - 5, width: bw, height: 18, borderColor: C.green, borderWidth: 1 });
    text(badge, W - M - bw / 2 - widthOf(badge, 8.5, true) / 2, y + 1, { size: 8.5, bold: true, color: C.green });
  }
  y -= 24;

  // Bandeau de références (émission / échéance / règlement)
  const stripH = 46;
  fill(M, y - stripH, CW, stripH, C.band);
  const cellW = CW / 3;
  const cells = [
    { k: "Date d'émission",   v: formatDateFR(f.date),     color: C.ink },
    { k: 'Échéance',          v: formatDateFR(f.echeance), color: status === 'late' ? C.red : C.ink },
    { k: 'Mode de règlement', v: paiementLabel,            color: C.ink },
  ];
  cells.forEach((c, i) => {
    const cx = M + 16 + i * cellW;
    label(c.k, cx, y - 17);
    text(c.v, cx, y - 34, { size: 11, bold: true, color: c.color });
  });
  y -= stripH + 28;

  // Deux colonnes : émetteur / client
  const colGap = 28;
  const colW   = (CW - colGap) / 2;
  const xL = M, xR = M + colW + colGap;

  const column = (title, x, build) => {
    let cy = y;
    label(title, x, cy);
    hline(x, x + colW, cy - 6, C.line, 0.8);
    cy -= 22;
    const put = (s, o = {}) => {
      if (!s) return;
      const size = o.size || 9.5;
      wrap(s, colW, size, !!o.bold).forEach((ln) => {
        text(ln, x, cy, { size, bold: !!o.bold, color: o.color || C.ink });
        cy -= size + 3.5;
      });
    };
    build(put);
    return cy;
  };

  const yLeft = column('Émetteur', xL, (put) => {
    put(BUSINESS_INFO.adresse);
    put(`${BUSINESS_INFO.cp || ''} ${BUSINESS_INFO.ville || ''}`);
    put(BUSINESS_INFO.siret ? `SIRET : ${BUSINESS_INFO.siret}` : '');
    put(BUSINESS_INFO.email);
    put(BUSINESS_INFO.telephone);
  });
  const yRight = column('Facturé à', xR, (put) => {
    put(f.client?.nom || '–', { size: 11.5, bold: true });
    put(f.client?.adresse);
    put(f.client?.email);
    put(f.client?.telephone);
  });
  y = Math.min(yLeft, yRight) - 14;

  // ═════════════════════════════════════════════════════════════════════
  // Tableau des prestations
  // ═════════════════════════════════════════════════════════════════════
  const xDesc  = M + 12;
  const rTotal = W - M - 12;
  const rPU    = rTotal - 92;
  const rQty   = rPU - 86;
  const descW  = rQty - 46 - xDesc;
  const LH = 12.5, PAD = 8;

  const tableHeader = () => {
    fill(M, y - 22, CW, 22, C.accent);
    const ty = y - 14.5;
    text('DESCRIPTION', xDesc, ty, { size: 8, bold: true, color: C.white });
    text('QTÉ',      rQty,   ty, { size: 8, bold: true, color: C.white, align: 'right' });
    text('PU HT',    rPU,    ty, { size: 8, bold: true, color: C.white, align: 'right' });
    text('TOTAL HT', rTotal, ty, { size: 8, bold: true, color: C.white, align: 'right' });
    y -= 22;
  };

  ensureSpace(22 + 40);
  tableHeader();

  items.forEach((it, idx) => {
    const lines = wrap(it.description || '–', descW, 10, false);
    const rowH  = lines.length * LH + PAD * 2 - 3;

    if (y - rowH < BOTTOM) {
      continuationPage();
      tableHeader();
    }
    if (idx % 2 === 1) fill(M, y - rowH, CW, rowH, C.band);

    const base = y - PAD - 8;
    lines.forEach((ln, i) => text(ln, xDesc, base - i * LH, { size: 10 }));
    const q  = Number(it.quantite) || 0;
    const pu = Number(it.prixUnitaire) || 0;
    text(fmtQty(q),        rQty,   base, { size: 10, align: 'right' });
    text(fmtEURPdf(pu),    rPU,    base, { size: 10, align: 'right' });
    text(fmtEURPdf(q * pu), rTotal, base, { size: 10, bold: true, align: 'right' });

    y -= rowH;
    hline(M, W - M, y);
  });

  // ═════════════════════════════════════════════════════════════════════
  // Totaux + modalités de règlement (côte à côte)
  // ═════════════════════════════════════════════════════════════════════
  ensureSpace(160);
  y -= 30;

  const totW = 232;
  const xT   = W - M - totW;

  // — Colonne droite : totaux
  let ty = y;
  const totalRow = (lbl, val) => {
    text(lbl, xT + 12, ty - 14, { size: 10, color: C.muted });
    text(val, W - M - 12, ty - 14, { size: 10, align: 'right' });
    ty -= 24;
    hline(xT, W - M, ty);
  };
  totalRow('Total HT', fmtEURPdf(f.totalHT || 0));
  if (Number(f.tva) > 0) totalRow(`TVA (${f.tva} %)`, fmtEURPdf(f.totalTVA || 0));

  fill(xT, ty - 32, totW, 32, C.accent);
  text('TOTAL TTC', xT + 12, ty - 20, { size: 11, bold: true, color: C.white });
  text(fmtEURPdf(f.totalTTC || 0), W - M - 12, ty - 20, { size: 13, bold: true, color: C.white, align: 'right' });
  ty -= 32 + 16;

  if (paid) {
    text('Reste à payer : 0,00 EUR', W - M, ty, { size: 9.5, bold: true, color: C.green, align: 'right' });
  } else {
    text(`À régler avant le ${formatDateFR(f.echeance)}`, W - M, ty, {
      size: 9.5, bold: true, color: status === 'late' ? C.red : C.ink, align: 'right',
    });
  }
  ty -= 14;

  // — Colonne gauche : règlement
  let ly = y;
  const leftW = CW - totW - 28;
  label('Modalités de règlement', M, ly);
  hline(M, M + leftW, ly - 6, C.line, 0.8);
  ly -= 22;
  const kv = (k, v) => {
    if (!v) return;
    text(k, M, ly, { size: 9, color: C.muted });
    text(v, M + 62, ly, { size: 9.5, bold: true });
    ly -= 14;
  };
  kv('Mode', paiementLabel);
  if (BUSINESS_INFO.iban && BUSINESS_INFO.iban !== 'À COMPLÉTER') kv('IBAN', fmtIban(BUSINESS_INFO.iban));
  if (BUSINESS_INFO.bic  && BUSINESS_INFO.bic  !== 'À COMPLÉTER') kv('BIC', BUSINESS_INFO.bic);
  if (!paid) kv('Référence', f.numero);

  y = Math.min(ly, ty) - 10;

  // ═════════════════════════════════════════════════════════════════════
  // Mentions, notes
  // ═════════════════════════════════════════════════════════════════════
  const paragraph = (title, str, size, color) => {
    const lines = wrap(str, CW, size, false);
    ensureSpace((title ? 24 : 0) + Math.min(lines.length, 3) * (size + 3.5));
    if (title) { label(title, M, y); y -= 15; }
    lines.forEach((ln) => {
      if (y < BOTTOM) continuationPage();
      text(ln, M, y, { size, color });
      y -= size + 3.5;
    });
    y -= 8;
  };

  if (f.notes) paragraph('Notes', f.notes, 9.5, C.ink);

  if (Number(f.tva) === 0 && BUSINESS_INFO.mentionTVA) {
    paragraph('', BUSINESS_INFO.mentionTVA, 8.5, C.muted);
  }

  const retard = BUSINESS_INFO.mentionRetard ||
    "En cas de retard de paiement, une pénalité égale à trois fois le taux d'intérêt légal sera appliquée, " +
    "ainsi qu'une indemnité forfaitaire de 40 € pour frais de recouvrement (art. L441-10 du Code de commerce). " +
    "Pas d'escompte pour paiement anticipé.";
  paragraph('', retard, 8, C.muted);

  // ═════════════════════════════════════════════════════════════════════
  // Pied de page sur toutes les pages
  // ═════════════════════════════════════════════════════════════════════
  const total = pages.length;
  pages.forEach((pg, i) => {
    page = pg;
    hline(M, W - M, FOOTER_H, C.line, 0.6);
    const l1 = [BUSINESS_INFO.nom, BUSINESS_INFO.formeJuridique, BUSINESS_INFO.siret ? `SIRET ${BUSINESS_INFO.siret}` : '']
      .filter(Boolean).join('  ·  ');
    const l2 = [BUSINESS_INFO.email, BUSINESS_INFO.telephone, BUSINESS_INFO.site].filter(Boolean).join('  ·  ');
    text(l1, M, FOOTER_H - 15, { size: 7.5, color: C.muted });
    text(l2, M, FOOTER_H - 26, { size: 7.5, color: C.muted });
    text(`Page ${i + 1} / ${total}`, W - M, FOOTER_H - 15, { size: 7.5, color: C.muted, align: 'right' });
  });

  return await doc.save();
}

// pdf-lib (polices standard) n'encode que le jeu WinAnsi. On remplace les
// espaces insécables fines produites par Intl (U+202F) — qui faisaient
// planter la génération dès 1 000 EUR — et on retire tout ce qui n'est pas
// encodable (emojis, etc.). Accents, œ, guillemets et tirets sont conservés.
function sanitizeForPdf(s) {
  return String(s ?? '')
    .replace(/[\u202F\u00A0\u2009\u2007]/g, ' ')
    .replace(/€/g, 'EUR')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[^\u0020-\u007E\u00A1-\u00FF\u0152\u0153\u0178\u2013\u2014\u2018\u2019\u201C\u201D\u2022\u2026]/g, '')
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
window.sendFactureReminder = sendFactureReminder;
