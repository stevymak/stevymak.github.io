#!/usr/bin/env node
// Vérifie la cohérence des prix et des mentions commerciales du site.
//   node tests/check-tarifs.mjs
// 1. Chaque élément data-tarif="chemin" affiche en dur la valeur de tarifs.json.
// 2. functions/tarifs.json est identique à tarifs.json (emails, chat IA).
// 3. Aucune mention retirée ne réapparaît (prix nets, crédit d'impôt, offre Découverte…).
// 4. Les listes de services et les créneaux écrits dans les pages suivent tarifs.json (kit/services.mjs).
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const tarifs = JSON.parse(readFileSync(join(ROOT, 'tarifs.json'), 'utf8'));

const norm = (s) => s.replace(/&nbsp;|&#8239;|&#160;|&#x202f;/gi, ' ').replace(/[\s\u00a0\u202f]+/g, ' ').trim();
function fmt(v) {
  if (v === null) return 'Sur devis';
  const n = (Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ','))
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return `${n} €`;
}
const get = (o, p) => p.split('.').reduce((x, k) => (x == null ? undefined : x[k]), o);

const errors = [];
let checked = 0;

// 1. data-tarif
const pages = readdirSync(ROOT).filter((f) => f.endsWith('.html'));
const TAG = /<(\w+)\b[^>]*\bdata-tarif="([^"]+)"[^>]*>([^<]*)</g;
for (const f of pages) {
  const html = readFileSync(join(ROOT, f), 'utf8');
  for (const m of html.matchAll(TAG)) {
    const [, , path, text] = m;
    const v = get(tarifs, path);
    checked++;
    if (v === undefined) errors.push(`${f} : chemin inconnu « ${path} »`);
    else if (norm(text) !== norm(fmt(v))) errors.push(`${f} : ${path} affiche « ${norm(text)} » au lieu de « ${fmt(v)} »`);
  }
}

// 2. copie pour les Cloud Functions
try {
  const copy = readFileSync(join(ROOT, 'functions', 'tarifs.json'), 'utf8');
  if (copy !== readFileSync(join(ROOT, 'tarifs.json'), 'utf8')) errors.push('functions/tarifs.json diffère de tarifs.json (lancer : cp tarifs.json functions/tarifs.json)');
} catch { errors.push('functions/tarifs.json manquant (lancer : cp tarifs.json functions/tarifs.json)'); }

// 3. mentions interdites (pages publiques + chat + fonctions)
const FORBIDDEN = [
  [/\b\d{1,3},50\s?(€|&nbsp;€)\s?net/i, 'prix « net » après crédit d’impôt'],
  [/(?<!Aucun )cr[ée]dit d.imp[ôo]t/i, 'mention du crédit d’impôt'],
  [/services?[- ]a[- ]la[- ]personne\.html/i, 'lien vers la page SAP retirée'],
  [/D[ée]couverte[^<]{0,40}19\s?€|19\s?€\s?\/\s?mois/i, 'offre Découverte supprimée'],
  [/pr[ée]avis de 30 jours/i, 'préavis de 30 jours (contrats désormais sans préavis)'],
  [/\bch[èe]que/i, 'paiement par chèque (non accepté)'],
];
const SCAN = [...pages.filter((f) => !['services-a-la-personne.html', '404.html'].includes(f)), 'chat-widget.js', 'functions/legacy-v2.js', 'functions/extras.js', 'admin/core/ui.js', 'admin/modules/devis.js', 'admin/modules/factures.js'];
for (const f of SCAN) {
  let s;
  try { s = readFileSync(join(ROOT, f), 'utf8'); } catch { continue; }
  for (const [re, label] of FORBIDDEN) {
    const m = s.match(re);
    if (m) {
      const line = s.slice(0, m.index).split('\n').length;
      errors.push(`${f}:${line} : ${label} → « ${norm(m[0]).slice(0, 60)} »`);
    }
  }
}

// 4. listes de services et créneaux (cartes de réservation, espace client, rappel, admin)
{
  const { regenerer } = await import('../kit/services.mjs');
  const d = regenerer(ROOT, tarifs, { ecrire: false });
  if (d.length) errors.push(`listes de services ou créneaux différentes de tarifs.json : ${d.join(', ')} (lancer : node kit/services.mjs --write)`);
}

if (errors.length) {
  console.error(`✗ ${errors.length} problème(s) :\n  - ${errors.join('\n  - ')}`);
  process.exit(1);
}
console.log(`✓ ${checked} prix vérifiés sur ${pages.length} pages, copie functions/tarifs.json à jour, aucune mention retirée, listes de services conformes.`);
