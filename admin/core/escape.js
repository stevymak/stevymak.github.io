// ─────────────────────────────────────────────────────────────────────────────
// escape.js — Échappement des données avant insertion dans du HTML.
//
// Toute donnée venant de Firestore (et donc potentiellement d'un formulaire
// public : réservations, contrats, avis, devis web…) DOIT passer par l'un de
// ces helpers avant d'être placée dans un template injecté via innerHTML.
//
//   esc(v)    → texte entre balises :          <div>${esc(r.nom)}</div>
//   attr(v)   → valeur d'attribut entre "…" :   <option value="${attr(n)}">
//   jsArg(v)  → argument JS dans un onclick :   onclick="updateStatus(${jsArg(r.id)},'done')"
//
// jsArg produit une chaîne JSON (guillemets doubles) ré-échappée pour
// l'attribut : le navigateur décode &quot; puis le JS lit un littéral
// de chaîne valide, sans possibilité de sortir de l'argument.
// ─────────────────────────────────────────────────────────────────────────────

const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' };

export function escapeHtml(v) {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"'`]/g, (m) => MAP[m]);
}

export const esc = escapeHtml;

export function escapeAttr(v) {
  return escapeHtml(v);
}

export const attr = escapeAttr;

export function jsArg(v) {
  return escapeAttr(JSON.stringify(v === null || v === undefined ? '' : String(v)));
}
