// ─────────────────────────────────────────────────────────────────────────────
// communications.js — Newsletter & templates emails.
//
// Deux vues internes : Templates (réutilisables) et Campagnes (envois +
// statistiques). Les destinataires sont calculés côté admin à partir de
// l'index clients (segment + tag) puis transmis à la Cloud Function
// `sendCampaign` qui envoie via Resend.
//
// Tracking : Resend webhook → Cloud Function `resendWebhook` → incrémente
// les compteurs sur `campagnes/{id}.stats`.
// ─────────────────────────────────────────────────────────────────────────────

import { db, fns, callSendCampaign } from '../core/firebase.js';
import { store, emit, on } from '../core/store.js';
import { TEMPLATE_KINDS, CLIENT_TAGS_PRESET } from '../core/ui.js';
import { getClientsIndex } from './clients.js';

// État local
let allTemplates = [];
let allCampagnes = [];
let editingTplId  = null;
let editingCampId = null;
let currentView   = 'campagnes';

// ─── Chargements ──────────────────────────────────────────────────────────
export async function loadTemplates() {
  try {
    const { collection, getDocs, query, orderBy } = fns;
    const q    = query(collection(db, 'templates'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    allTemplates = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    emit('templates:changed');
  } catch (e) {
    console.error('templates load:', e);
    document.getElementById('templatesList').innerHTML =
      '<div class="empty-state"><div class="empty-icon">⚠️</div>Erreur de chargement.</div>';
  }
}

export async function loadCampagnes() {
  try {
    const { collection, getDocs, query, orderBy } = fns;
    const q    = query(collection(db, 'campagnes'), orderBy('createdAt', 'desc'));
    const snap = await getDocs(q);
    allCampagnes = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    emit('campagnes:changed');
  } catch (e) {
    console.error('campagnes load:', e);
    document.getElementById('campagnesList').innerHTML =
      '<div class="empty-state"><div class="empty-icon">⚠️</div>Erreur de chargement.</div>';
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

function formatDate(ts) {
  if (!ts) return '–';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: '2-digit' });
}

function setView(view) {
  currentView = view;
  document.querySelectorAll('.comm-tab').forEach((b) => b.classList.toggle('active', b.dataset.commView === view));
  document.querySelectorAll('.comm-view').forEach((v) => v.classList.remove('active'));
  document.getElementById('commView-' + view)?.classList.add('active');
}

// ─── Rendu liste templates ────────────────────────────────────────────────
function renderTemplates() {
  const host = document.getElementById('templatesList');
  if (!host) return;

  if (allTemplates.length === 0) {
    host.innerHTML =
      '<div class="empty-state"><div class="empty-icon">📋</div>Aucun template pour le moment. Crée-en un pour démarrer.</div>';
    return;
  }

  host.innerHTML = allTemplates.map((t) => {
    const meta = TEMPLATE_KINDS[t.kind] || TEMPLATE_KINDS.newsletter;
    return `
      <div class="comm-row">
        <div class="comm-row-icon">${meta.icon}</div>
        <div class="comm-row-main">
          <div class="comm-row-name">${escapeHtml(t.nom || '–')}</div>
          <div class="comm-row-sub">${meta.label} · sujet : ${escapeHtml(t.sujet || '–')} · créé le ${formatDate(t.createdAt)}</div>
        </div>
        <div class="comm-row-stats"></div>
        <div class="comm-row-actions">
          <button class="btn-soft" onclick="openTemplateForm('${t.id}')" title="Modifier">✏️</button>
          <button class="btn-soft" onclick="useTemplateForCampagne('${t.id}')" title="Utiliser pour une campagne">📤 Utiliser</button>
          <button class="btn-cancel" onclick="deleteTemplate('${t.id}')" title="Supprimer" style="flex:0 0 auto;padding:0.4rem 0.6rem">🗑</button>
        </div>
      </div>`;
  }).join('');
}

// ─── Rendu liste campagnes ────────────────────────────────────────────────
function renderCampagnes() {
  const host = document.getElementById('campagnesList');
  if (!host) return;

  if (allCampagnes.length === 0) {
    host.innerHTML =
      '<div class="empty-state"><div class="empty-icon">📤</div>Aucune campagne pour le moment.</div>';
    return;
  }

  host.innerHTML = allCampagnes.map((c) => {
    const stats = c.stats || {};
    const sent  = stats.sent || 0;
    const opened= stats.opened || 0;
    const clicked = stats.clicked || 0;
    const sentAtLabel = c.sentAt ? `Envoyée le ${formatDate(c.sentAt)}` : 'Brouillon';
    const openRate = sent > 0 ? Math.round((opened / sent) * 100) : 0;
    const clickRate= sent > 0 ? Math.round((clicked / sent) * 100) : 0;

    const actions = [];
    if (!c.sentAt) {
      actions.push(`<button class="btn-soft"    onclick="openCampagneForm('${c.id}')" title="Modifier">✏️</button>`);
      actions.push(`<button class="btn-confirm" onclick="sendExistingCampagne('${c.id}')" title="Envoyer">📤 Envoyer</button>`);
    } else {
      actions.push(`<button class="btn-soft"    onclick="openCampagneForm('${c.id}')" title="Voir détails">👁</button>`);
      actions.push(`<button class="btn-soft"    onclick="duplicateCampagne('${c.id}')" title="Dupliquer">⧉</button>`);
    }
    actions.push(`<button class="btn-cancel" onclick="deleteCampagne('${c.id}')" title="Supprimer" style="flex:0 0 auto;padding:0.4rem 0.6rem">🗑</button>`);

    return `
      <div class="comm-row">
        <div class="comm-row-icon">📧</div>
        <div class="comm-row-main">
          <div class="comm-row-name">${escapeHtml(c.nom || '–')}</div>
          <div class="comm-row-sub">${sentAtLabel} · segment ${escapeHtml(c.segment || 'all')}${c.tagFilter ? ` · tag ${escapeHtml(c.tagFilter)}` : ''} · ${c.recipientCount || 0} destinataires</div>
        </div>
        <div class="comm-row-stats">
          ${c.sentAt ? `<strong>${sent}</strong> envois<br>${openRate}% ouverts · ${clickRate}% clics` : '<strong>—</strong> non envoyé'}
        </div>
        <div class="comm-row-actions">${actions.join('')}</div>
      </div>`;
  }).join('');
}

// ─── Form template ────────────────────────────────────────────────────────
function openTemplateForm(id = null) {
  editingTplId = id;
  const t = id ? allTemplates.find((x) => x.id === id) : null;

  document.getElementById('templateModalTitle').textContent = t ? `Template "${t.nom}"` : 'Nouveau template';
  document.getElementById('tplNom').value   = t?.nom   || '';
  document.getElementById('tplKind').value  = t?.kind  || 'newsletter';
  document.getElementById('tplSujet').value = t?.sujet || '';
  document.getElementById('tplHtml').value  = t?.html  || '';

  refreshTemplatePreview();
  document.getElementById('templateModal').classList.add('show');
}

function closeTemplateForm() {
  document.getElementById('templateModal').classList.remove('show');
  editingTplId = null;
}

function refreshTemplatePreview() {
  const html = document.getElementById('tplHtml').value || '<p style="color:#888;text-align:center;padding:2rem">L\'aperçu apparaîtra ici…</p>';
  const iframe = document.getElementById('tplPreview');
  if (iframe?.contentDocument) {
    iframe.contentDocument.open();
    iframe.contentDocument.write(html);
    iframe.contentDocument.close();
  }
}

async function saveTemplate() {
  const nom   = document.getElementById('tplNom').value.trim();
  const kind  = document.getElementById('tplKind').value;
  const sujet = document.getElementById('tplSujet').value.trim();
  const html  = document.getElementById('tplHtml').value;

  if (!nom || !sujet || !html) {
    alert('Nom, sujet et HTML sont requis.');
    return;
  }

  const btn = document.getElementById('tplSaveBtn');
  btn.disabled = true;

  try {
    const { collection, doc, addDoc, updateDoc, serverTimestamp } = fns;
    const payload = { nom, kind, sujet, html, updatedAt: serverTimestamp() };

    if (editingTplId) {
      await updateDoc(doc(db, 'templates', editingTplId), payload);
      const idx = allTemplates.findIndex((x) => x.id === editingTplId);
      if (idx >= 0) allTemplates[idx] = { ...allTemplates[idx], ...payload };
    } else {
      payload.createdAt = serverTimestamp();
      const ref = await addDoc(collection(db, 'templates'), payload);
      allTemplates.unshift({ id: ref.id, ...payload });
    }
    emit('templates:changed');
    closeTemplateForm();
  } catch (e) {
    console.error(e);
    alert('Erreur enregistrement : ' + (e?.message || e));
  } finally {
    btn.disabled = false;
  }
}

async function deleteTemplate(id) {
  const t = allTemplates.find((x) => x.id === id);
  if (!confirm(`Supprimer le template "${t?.nom}" ?`)) return;
  try {
    const { doc, deleteDoc } = fns;
    await deleteDoc(doc(db, 'templates', id));
    allTemplates = allTemplates.filter((x) => x.id !== id);
    emit('templates:changed');
  } catch (e) {
    console.error(e);
    alert('Erreur suppression.');
  }
}

// ─── Form campagne ────────────────────────────────────────────────────────
function openCampagneForm(id = null) {
  editingCampId = id;
  const c = id ? allCampagnes.find((x) => x.id === id) : null;

  document.getElementById('campagneModalTitle').textContent = c ? `Campagne "${c.nom}"` : 'Nouvelle campagne';

  // Liste templates
  const tplSelect = document.getElementById('campTemplate');
  tplSelect.innerHTML = '<option value="">— Partir de zéro —</option>' +
    allTemplates.map((t) => `<option value="${t.id}">${(TEMPLATE_KINDS[t.kind]?.icon || '📋')} ${escapeHtml(t.nom)}</option>`).join('');

  // Liste tags (presets + tags personnalisés présents dans clients_meta)
  const tagSelect = document.getElementById('campTag');
  const customTags = collectAllTags();
  tagSelect.innerHTML = '<option value="">— Aucun —</option>' +
    customTags.map((t) => {
      const preset = CLIENT_TAGS_PRESET.find((p) => p.id === t);
      return `<option value="${escapeHtml(t)}">${preset ? preset.label : t}</option>`;
    }).join('');

  document.getElementById('campNom').value     = c?.nom     || '';
  document.getElementById('campSujet').value   = c?.sujet   || '';
  document.getElementById('campSegment').value = c?.segment || 'all';
  document.getElementById('campTag').value     = c?.tagFilter || '';
  document.getElementById('campHtml').value    = c?.html    || '';

  if (c?.templateId) tplSelect.value = c.templateId;

  updateRecipientCount();
  refreshCampagnePreview();

  // Lock l'édition si déjà envoyée
  const sendBtn = document.getElementById('campSendBtn');
  const saveBtn = document.getElementById('campSaveBtn');
  const isSent = !!c?.sentAt;
  sendBtn.style.display = isSent ? 'none' : '';
  saveBtn.textContent   = isSent ? 'Fermer'   : '💾 Brouillon';
  saveBtn.onclick       = isSent ? closeCampagneForm : (() => saveCampagne(false));

  document.getElementById('campagneModal').classList.add('show');
}

function closeCampagneForm() {
  document.getElementById('campagneModal').classList.remove('show');
  editingCampId = null;
  // Restore le handler par défaut
  document.getElementById('campSaveBtn').onclick = () => saveCampagne(false);
}

function refreshCampagnePreview() {
  const html = document.getElementById('campHtml').value || '<p style="color:#888;text-align:center;padding:2rem">L\'aperçu apparaîtra ici…</p>';
  const iframe = document.getElementById('campPreview');
  if (iframe?.contentDocument) {
    iframe.contentDocument.open();
    iframe.contentDocument.write(html);
    iframe.contentDocument.close();
  }
}

function applyTemplateToCampagne(tplId) {
  const t = allTemplates.find((x) => x.id === tplId);
  if (!t) return;
  document.getElementById('campSujet').value = t.sujet || '';
  document.getElementById('campHtml').value  = t.html  || '';
  refreshCampagnePreview();
}

function useTemplateForCampagne(tplId) {
  setView('campagnes');
  openCampagneForm();
  setTimeout(() => {
    const sel = document.getElementById('campTemplate');
    sel.value = tplId;
    applyTemplateToCampagne(tplId);
  }, 50);
}

// ─── Calcul des destinataires (utilise l'index clients) ──────────────────
function computeRecipients() {
  const segment = document.getElementById('campSegment').value;
  const tag     = document.getElementById('campTag').value;
  const idx     = getClientsIndex();

  let arr = idx.filter((c) => c.email);  // pas d'envoi sans email
  if (segment !== 'all') {
    arr = arr.filter((c) => c.segment.id === segment);
  }
  if (tag) {
    // Lookup tags via store (clients_meta cache global) — on traverse l'index :
    // chaque client porte son id (hash), mais l'accès à ses tags nécessite
    // clients_meta. On le récupère via un getter exposé par clients.js.
    // Pour la V1, on filtre via un flag qu'on charge via getClientsIndex —
    // mais l'index ne contient pas les tags. Donc on délègue à clients.js
    // un autre helper. Si pas dispo on garde tout.
    arr = arr.filter((c) => (c.tags || []).includes(tag));
  }

  return arr.map((c) => ({
    email: c.email,
    nom:   c.nom || '',
  }));
}

function collectAllTags() {
  const set = new Set();
  CLIENT_TAGS_PRESET.forEach((p) => set.add(p.id));
  // On parcourt aussi les tags portés par les clients (custom)
  getClientsIndex().forEach((c) => (c.tags || []).forEach((t) => set.add(t)));
  return Array.from(set);
}

function updateRecipientCount() {
  const recipients = computeRecipients();
  const el = document.getElementById('campRecipientCount');
  if (el) {
    el.textContent = `Destinataires : ${recipients.length}` +
      (recipients.length > 100 ? ' ⚠ quota Resend gratuit = 100/jour' : '');
    el.style.color = recipients.length > 100 ? 'var(--warning)' : 'var(--muted)';
  }
}

async function saveCampagne(sendNow) {
  const nom     = document.getElementById('campNom').value.trim();
  const sujet   = document.getElementById('campSujet').value.trim();
  const segment = document.getElementById('campSegment').value;
  const tag     = document.getElementById('campTag').value;
  const html    = document.getElementById('campHtml').value;
  const templateId = document.getElementById('campTemplate').value || null;

  if (!nom || !sujet || !html) {
    alert('Nom, sujet et HTML sont requis.');
    return;
  }

  const recipients = sendNow ? computeRecipients() : [];
  if (sendNow && recipients.length === 0) {
    alert('Aucun destinataire pour ce segment.');
    return;
  }
  if (sendNow && !confirm(`Envoyer la campagne à ${recipients.length} destinataire${recipients.length > 1 ? 's' : ''} ?`)) {
    return;
  }

  const saveBtn = document.getElementById('campSaveBtn');
  const sendBtn = document.getElementById('campSendBtn');
  saveBtn.disabled = true; sendBtn.disabled = true;

  try {
    const { collection, doc, addDoc, updateDoc, serverTimestamp } = fns;

    let savedId = editingCampId;
    let payload = {
      nom, sujet, html,
      segment,
      tagFilter:  tag || null,
      templateId,
      updatedAt:  serverTimestamp(),
    };

    if (editingCampId) {
      await updateDoc(doc(db, 'campagnes', editingCampId), payload);
      const idx = allCampagnes.findIndex((x) => x.id === editingCampId);
      if (idx >= 0) allCampagnes[idx] = { ...allCampagnes[idx], ...payload };
    } else {
      payload.createdAt = serverTimestamp();
      payload.stats     = { sent: 0, opened: 0, clicked: 0, bounced: 0, complained: 0, errors: 0 };
      const ref = await addDoc(collection(db, 'campagnes'), payload);
      savedId = ref.id;
      allCampagnes.unshift({ id: savedId, ...payload });
    }

    if (sendNow) {
      sendBtn.textContent = '⏳ Envoi en cours…';
      const res = await callSendCampaign({
        campagneId: savedId,
        subject:    sujet,
        html,
        recipients,
      });
      const data = res?.data || {};
      alert(`Campagne envoyée :\n  ✓ ${data.sent || 0} succès\n  ✗ ${data.errors || 0} erreur(s)`);
      await loadCampagnes();
    }

    emit('campagnes:changed');
    closeCampagneForm();
  } catch (e) {
    console.error(e);
    alert('Erreur : ' + (e?.message || e));
  } finally {
    saveBtn.disabled = false; sendBtn.disabled = false;
    sendBtn.textContent = '📤 Enregistrer + Envoyer';
  }
}

async function sendExistingCampagne(id) {
  const c = allCampagnes.find((x) => x.id === id);
  if (!c) return;

  const segment = c.segment || 'all';
  const tag     = c.tagFilter || '';

  // Recompute recipients depuis l'index actuel
  let idx = getClientsIndex().filter((x) => x.email);
  if (segment !== 'all') idx = idx.filter((x) => x.segment.id === segment);
  if (tag)               idx = idx.filter((x) => (x.tags || []).includes(tag));
  const recipients = idx.map((x) => ({ email: x.email, nom: x.nom || '' }));

  if (recipients.length === 0) { alert('Aucun destinataire pour cette campagne.'); return; }
  if (!confirm(`Envoyer "${c.nom}" à ${recipients.length} destinataire${recipients.length > 1 ? 's' : ''} ?`)) return;

  try {
    const res = await callSendCampaign({
      campagneId: id,
      subject:    c.sujet,
      html:       c.html,
      recipients,
    });
    const data = res?.data || {};
    alert(`Campagne envoyée :\n  ✓ ${data.sent || 0} succès\n  ✗ ${data.errors || 0} erreur(s)`);
    await loadCampagnes();
  } catch (e) {
    console.error(e);
    alert('Erreur envoi : ' + (e?.message || e));
  }
}

async function duplicateCampagne(id) {
  const c = allCampagnes.find((x) => x.id === id);
  if (!c) return;
  try {
    const { collection, addDoc, serverTimestamp } = fns;
    const payload = {
      nom: `${c.nom} (copie)`,
      sujet: c.sujet,
      html:  c.html,
      segment: c.segment,
      tagFilter: c.tagFilter || null,
      templateId: c.templateId || null,
      stats: { sent: 0, opened: 0, clicked: 0, bounced: 0, complained: 0, errors: 0 },
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };
    const ref = await addDoc(collection(db, 'campagnes'), payload);
    allCampagnes.unshift({ id: ref.id, ...payload });
    emit('campagnes:changed');
  } catch (e) {
    console.error(e);
    alert('Erreur duplication.');
  }
}

async function deleteCampagne(id) {
  const c = allCampagnes.find((x) => x.id === id);
  if (!confirm(`Supprimer la campagne "${c?.nom}" ?`)) return;
  try {
    const { doc, deleteDoc } = fns;
    await deleteDoc(doc(db, 'campagnes', id));
    allCampagnes = allCampagnes.filter((x) => x.id !== id);
    emit('campagnes:changed');
  } catch (e) {
    console.error(e);
    alert('Erreur suppression.');
  }
}

// ─── Souscriptions + wiring ───────────────────────────────────────────────
on('templates:changed', renderTemplates);
on('campagnes:changed', renderCampagnes);
// Si la liste clients change, on met à jour le compteur dans la modale ouverte
on('clients:changed', updateRecipientCount);
on('rdvs:changed',     updateRecipientCount);
on('contrats:changed', updateRecipientCount);

// Tabs internes
document.querySelectorAll('.comm-tab').forEach((b) => {
  b.addEventListener('click', () => setView(b.dataset.commView));
});

// Live preview templates / campagnes
document.getElementById('tplHtml')?.addEventListener('input',  refreshTemplatePreview);
document.getElementById('campHtml')?.addEventListener('input', refreshCampagnePreview);

// Recipient count en live
document.getElementById('campSegment')?.addEventListener('change', updateRecipientCount);
document.getElementById('campTag')?.addEventListener('change',     updateRecipientCount);

// Sélection template dans le formulaire campagne
document.getElementById('campTemplate')?.addEventListener('change', (e) => {
  if (e.target.value) applyTemplateToCampagne(e.target.value);
});

// Click en dehors → fermer
document.getElementById('templateModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'templateModal') closeTemplateForm();
});
document.getElementById('campagneModal')?.addEventListener('click', (e) => {
  if (e.target.id === 'campagneModal') closeCampagneForm();
});

// Compat handlers inline
window.openTemplateForm     = openTemplateForm;
window.closeTemplateForm    = closeTemplateForm;
window.saveTemplate         = saveTemplate;
window.deleteTemplate       = deleteTemplate;
window.useTemplateForCampagne = useTemplateForCampagne;

window.openCampagneForm     = openCampagneForm;
window.closeCampagneForm    = closeCampagneForm;
window.saveCampagne         = saveCampagne;
window.sendExistingCampagne = sendExistingCampagne;
window.duplicateCampagne    = duplicateCampagne;
window.deleteCampagne       = deleteCampagne;
