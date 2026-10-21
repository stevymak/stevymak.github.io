#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// kit/services.mjs — Listes de services et créneaux, générées depuis tarifs.json.
//
// Les services réservables (entrées de « services » qui ont un « libelle ») et
// les créneaux (« reservation ») apparaissent écrits en dur dans plusieurs
// fichiers, pour que la page reste lisible sans JavaScript et par Google.
// Ce module régénère ces blocs entre leurs marqueurs « kit:… » :
//
//   node kit/services.mjs --check   vérifie que le site source est à jour (test)
//   node kit/services.mjs --write   réécrit les blocs du site source
//
// build.mjs l'appelle aussi avec le tarifs.json du client.
// Le serveur (functions/booking.js, callback.js) lit tarifs.json directement.
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const h = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Même format que tarifs.js et tests/check-tarifs.mjs
export function fmt(v) {
  if (v === null) return 'Sur devis';
  const n = (Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ',')).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${n}&nbsp;€`;
}
// Même format que prixService() de functions/booking.js (prix enregistré avec la réservation)
const eur = (n) => `${Number.isInteger(n) ? n : n.toFixed(2).replace('.', ',')}€`;
export function prixAffiche(t) {
  if (t.prix == null) return 'Sur devis';
  if (t.unite === 'h') return `${eur(t.prix)}/h`;
  if (t.aPartirDe) return `À partir de ${eur(t.prix)}`;
  return `${eur(t.prix)}${t.note ? ` (${t.note.toLowerCase()})` : ''}`;
}

export const reservables = (T) => Object.entries(T.services || {}).filter(([, t]) => t.libelle);

// ─── Générateurs de blocs ────────────────────────────────────────────────────
function cartes(T) {
  return reservables(T).map(([k, t]) => {
    const tag = `<span data-tarif="services.${k}.prix">${fmt(t.prix)}</span>`;
    let prix;
    if (t.prix == null) prix = tag;
    else if (t.unite === 'h') prix = `${tag} / heure`;
    else if (t.aPartirDe) prix = `À partir de ${tag}`;
    else prix = `${tag}${t.note ? ` · ${t.note.charAt(0).toLowerCase()}${t.note.slice(1)}` : ''}`;
    const badge = t.badge ? ` <span style="background:var(--blue);color:#fff;font-size:0.65rem;padding:2px 6px;border-radius:4px;margin-left:4px;">${h(t.badge)}</span>` : '';
    return `      <div class="service-card" data-service="${h(t.libelle)}" data-price="${h(prixAffiche(t))}" data-base-price="${t.prix ?? ''}" onclick="selectService(this)"${t.large ? ' style="grid-column:span 2;"' : ''}>
        <span class="emoji"><span aria-hidden="true">${t.icone || '•'}</span></span><span class="name">${h(t.carte || t.libelle)}${badge}</span><span class="price">${prix}</span>
      </div>\n`;
  }).join('');
}

function creneaux(T) {
  const r = T.reservation || {};
  const per = r.periodes || {};
  const w = Math.max(...Object.keys(per).map((k) => k.length)) + 1;
  const lignes = Object.entries(per).map(([k, p]) => `  ${(k + ':').padEnd(w + 1)}{ label: ${JSON.stringify(p.label)}, slots: ${js(p.creneaux)} },`);
  const noms = (l) => l.map((k) => (per[k]?.label || k).replace(/^\S+\s/, '').toLowerCase()).join(', ');
  return `// kit:creneaux
const MAX_PAR_JOUR = ${r.maxParJour || 5};

// Plages horaires (tarifs.json → reservation) — week-end : ${noms(r.weekend || [])} | semaine : ${noms(r.semaine || [])}
const PERIODES = {
${lignes.join('\n')}
};
const PERIODES_SEMAINE = ${js(r.semaine || [])};
const PERIODES_WEEKEND = ${js(r.weekend || [])};

function getPeriodesForDate(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = new Date(y, m - 1, d).getDay(); // 0=dim 6=sam
  return (dow === 0 || dow === 6) ? PERIODES_WEEKEND : PERIODES_SEMAINE;
}
// /kit:creneaux
`;
}

function optionsEspaceClient(T) {
  return `        <option value="">— Sélectionner —</option>\n${reservables(T).map(([, t]) => `        <option>${h(t.libelle)}</option>\n`).join('')}        <option>Autre</option>\n`;
}

function optionsRappel(T) {
  const autres = T.reservation?.rappelAutres || ['Autre'];
  return [...reservables(T).filter(([, t]) => t.rappel !== false).map(([, t]) => [t.libelle, t.rappel || t.carte || t.libelle]), ...autres.map((a) => [a, a])]
    .map(([v, l]) => `            <option value="${h(v)}">${h(l)}</option>\n`).join('');
}

function servicesAdmin(T) {
  const noms = [...reservables(T).map(([, t]) => t.libelle), ...Object.values(T.pro || {}).map((x) => `${x.nom}${x.ht && !/\bpro\b/i.test(x.nom) ? ' (pro)' : ''}`)];
  return `// kit:services-admin (suggestions du champ « Service », générées depuis tarifs.json)
const SERVICES = [
${noms.map((n) => `  ${JSON.stringify(n)},`).join('\n')}
];
// /kit:services-admin`;
}

// fichier → [marqueur, générateur, style de commentaire]
export const BLOCS = {
  'makouez-it-rdv.html': [['services-cartes', cartes, 'html'], ['creneaux', creneaux, 'js-entier']],
  'mon-rdv.html': [['services-options', optionsEspaceClient, 'html']],
  'index.html': [['rappel-options', optionsRappel, 'html']],
  'admin/modules/reservations.js': [['services-admin', servicesAdmin, 'js-entier']],
};

const js = (a) => JSON.stringify(a).replace(/","/g, '", "');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function appliquer(fichier, texte, T) {
  for (const [nom, gen, style] of BLOCS[fichier] || []) {
    if (style === 'html') {
      const re = new RegExp(`(<!-- kit:${esc(nom)} -->\\n)[\\s\\S]*?(<!-- /kit:${esc(nom)} -->)`);
      if (!re.test(texte)) throw new Error(`${fichier} : marqueur kit:${nom} introuvable`);
      texte = texte.replace(re, (m, a, b) => a + gen(T) + b);
    } else {
      const re = new RegExp(`// kit:${esc(nom)}[\\s\\S]*?// /kit:${esc(nom)}\\n?`);
      if (!re.test(texte)) throw new Error(`${fichier} : marqueur kit:${nom} introuvable`);
      const bloc = gen(T);
      texte = texte.replace(re, () => bloc + (bloc.endsWith('\n') ? '' : '\n'));
    }
  }
  return texte;
}

// Régénère tous les blocs d'un dossier de site (source ou dist/<client>)
export function regenerer(dossier, T, { ecrire = true } = {}) {
  const differents = [];
  for (const f of Object.keys(BLOCS)) {
    const p = path.join(dossier, f);
    if (!fs.existsSync(p)) continue;
    const avant = fs.readFileSync(p, 'utf8');
    const apres = appliquer(f, avant, T);
    if (apres !== avant) { differents.push(f); if (ecrire) fs.writeFileSync(p, apres); }
  }
  return differents;
}

// ─── Ligne de commande ───────────────────────────────────────────────────────
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const T = JSON.parse(fs.readFileSync(path.join(ROOT, 'tarifs.json'), 'utf8'));
  const ecrire = process.argv.includes('--write');
  const d = regenerer(ROOT, T, { ecrire });
  if (ecrire) console.log(d.length ? `✓ blocs régénérés : ${d.join(', ')}` : '✓ déjà à jour');
  else if (d.length) { console.error(`✗ listes de services ou créneaux différentes de tarifs.json : ${d.join(', ')}\n  lancer : node kit/services.mjs --write`); process.exit(1); }
  else console.log('✓ listes de services et créneaux conformes à tarifs.json');
}
