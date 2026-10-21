#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// kit/build.mjs — Générateur de sites clients à partir de makouezit.org.
//
//   node kit/build.mjs kit/config/<client>.json
//
// Produit dist/<slug>/ : une copie complète du site (pages, admin, espace
// client, Cloud Functions, règles Firestore) aux couleurs du client :
//   1. copie le site source sans les fichiers internes (notes, tests, kit, .git) ;
//   2. remplace l'identité de Makouez IT (marque, logo, nom, téléphone, emails,
//      SIRET, adresse, domaine, projet Firebase, intégrations) par celle du client ;
//   3. retire les pages et modules non souscrits (pages locales, portfolio…)
//      et les liens qui y menaient, puis filtre le sitemap ;
//   4. retire tout ce qui concerne Noirland Music (fonctions, règle Firestore) ;
//   5. écrit tarifs.json, CNAME, .firebaserc et un rapport de génération
//      (ce qui reste à personnaliser à la main).
// Aucune dépendance : Node 18+ suffit.
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(KIT, '..');
const cfgPath = process.argv[2];
if (!cfgPath) { console.error('Usage : node kit/build.mjs kit/config/<client>.json'); process.exit(1); }

const SRC = JSON.parse(fs.readFileSync(path.join(KIT, 'config', 'source-makouez-it.json'), 'utf8'));
const CFG = JSON.parse(fs.readFileSync(path.resolve(cfgPath), 'utf8'));
const OUT = path.join(ROOT, 'dist', CFG.slug);

// ─── 0. Vérification de la configuration ────────────────────────────────────
const requis = ['slug', 'identite.marque', 'identite.logo.debut', 'identite.prenom', 'identite.nomComplet', 'identite.siret',
  'identite.adresse.rue', 'identite.adresse.codePostal', 'identite.adresse.ville', 'contact.telephone', 'contact.telephoneIntl',
  'contact.whatsapp', 'contact.email', 'contact.emailAdmin', 'site.domaine', 'firebase.projectId'];
const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const manquants = requis.filter((p) => !get(CFG, p));
if (manquants.length) { console.error('Configuration incomplète :', manquants.join(', ')); process.exit(1); }
if (!/^[a-z0-9-]+$/.test(CFG.slug)) { console.error('slug : minuscules, chiffres et tirets uniquement'); process.exit(1); }

// ─── 1. Copie ────────────────────────────────────────────────────────────────
const EXCLURE = new Set(['.git', 'kit', 'dist', 'tests', 'node_modules', 'CHANGELOG.md', 'CORRECTIONS-APPLIQUEES.md',
  'FIRESTORE_NOTES.md', 'TODO-MANUEL.md', 'README.md', 'patch_done_email.py', 'patch_functions.py', 'CNAME', '.firebaserc']);
const EXCLURE_MOTIF = [/\.bak\d*$/, /^index\.js\.bak/, /\.DS_Store$/, /^const \{/]; // « const { … » : fichier parasite créé par erreur dans functions/
fs.rmSync(OUT, { recursive: true, force: true });
function copier(src, dst) {
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    if (EXCLURE.has(e.name) || EXCLURE_MOTIF.some((m) => m.test(e.name))) continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) { fs.mkdirSync(d, { recursive: true }); copier(s, d); }
    else fs.copyFileSync(s, d);
  }
}
fs.mkdirSync(OUT, { recursive: true });
copier(ROOT, OUT);

// ─── 2. Modules et pages retirés ─────────────────────────────────────────────
const PAGES_LOCALES = ['depannage-informatique-aubervilliers.html', 'depannage-informatique-hauts-de-seine-92.html',
  'depannage-informatique-paris-75.html', 'depannage-informatique-pierrefitte-sur-seine.html',
  'depannage-informatique-seine-saint-denis-93.html', 'depannage-informatique-seine-saint-denis.html',
  'depannage-informatique-val-de-marne-94.html', 'depannage-pc-ile-de-france.html', 'depannage-pc-stains.html',
  'technicien-informatique-epinay-sur-seine.html', 'technicien-informatique-saint-denis.html'];
const garder = new Set(CFG.zone?.pagesLocalesAGarder || []);
const retirees = PAGES_LOCALES.filter((p) => !garder.has(p));
if (CFG.modules?.portfolio === false) retirees.push('portfolio.html');
retirees.push('services-a-la-personne.html'); // page de redirection propre à makouezit.org
for (const p of retirees) fs.rmSync(path.join(OUT, p), { force: true });
if (CFG.modules?.offresWeb === false) fs.rmSync(path.join(OUT, 'offres-web.css'), { force: true });

// ─── 3. Table de remplacement (du plus spécifique au plus général) ──────────
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const html = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const S = SRC, C = CFG;
const logoAccent = C.identite.logo.accent || '';
const R = []; // [RegExp|string, remplacement]
const add = (from, to) => { if (from && to != null) R.push([from, String(to)]); };

// Logos HTML (marque en deux couleurs)
R.push([/Makouez ?<span( style="[^"]*")?>IT<\/span>/g, (m, st) => `${html(C.identite.logo.debut)}${logoAccent ? ` <span${st || ''}>${html(logoAccent)}</span>` : ''}`]);
R.push([/Makouez<span>IT(?!<)/g, `${html(C.identite.logo.debut)}<span>${html(logoAccent)}`]);
// Personne
add('Stevy Makouézi', C.identite.nomComplet);
add(S.identite.nomComplet, C.identite.nomComplet);
add('Stevy Makouez', C.identite.nomComplet);
add('Makouézi', C.identite.nom);
// Adresse (pages légales)
add(S.identite.adresse.rue, C.identite.adresse.rue);
add(`${S.identite.adresse.codePostal} ${S.identite.adresse.ville}`, `${C.identite.adresse.codePostal} ${C.identite.adresse.ville}`);
add(`${S.identite.adresse.ville}, ${S.identite.adresse.codePostal}`, `${C.identite.adresse.ville}, ${C.identite.adresse.codePostal}`);
// Contact
add(S.contact.emailAdmin, C.contact.emailAdmin);
add(S.contact.email, C.contact.email);
add(S.contact.emailFacturation, C.contact.emailFacturation || C.contact.email);
add(S.contact.emailNewsletter, C.contact.emailNewsletter || C.contact.email);
add(S.contact.telephoneIntl, C.contact.telephoneIntl);
add(S.contact.telephone, C.contact.telephone);
add(S.contact.whatsapp, C.contact.whatsapp);
add(S.identite.siret, C.identite.siret);
// Firebase et intégrations
add(S.firebase.apiKey, C.firebase.apiKey);
add(S.firebase.appId, C.firebase.appId);
add(S.firebase.messagingSenderId, C.firebase.messagingSenderId);
R.push([/https:\/\/claudeproxy-[a-z0-9]+-ew\.a\.run\.app/g, `https://europe-west1-${C.firebase.projectId}.cloudfunctions.net/claudeProxy`]);
R.push([/makouez-it(?=[.'"/:]|\s*$|\.firebase)/gm, C.firebase.projectId]); // jamais « makouez-it-rdv.html »
add(S.integrations.ga4, C.integrations?.ga4 || 'G-A-RENSEIGNER');
add(S.integrations.googleReviewUrl, C.integrations?.googleReviewUrl || `https://${C.site.domaine}/#avis`);
R.push([new RegExp(esc(S.integrations.mapsApiKeyPrefix) + '[A-Za-z0-9_-]{31}', 'g'), C.integrations?.mapsApiKey || 'CLE-MAPS-A-RENSEIGNER']);
// Domaine, marque, prénom (en dernier : ce sont les plus généraux)
add(`www.${S.site.domaine}`, `www.${C.site.domaine}`);
add(S.site.domaine, C.site.domaine);
add(S.identite.marque, C.identite.marque);
add(S.identite.nom, C.identite.nom);
R.push([/Stevy(?![a-zà-ÿ])/g, C.identite.prenom]);

const TEXTE = /\.(html|js|mjs|cjs|json|css|txt|xml|md|rules|webmanifest)$|^(firestore\.rules|robots\.txt|CNAME)$/;
function remplacer(txt) {
  for (const [from, to] of R) txt = typeof from === 'string' ? txt.split(from).join(to) : txt.replace(from, to);
  return txt;
}
// Retrait des liens vers les pages supprimées (éléments <a> entiers) et des entrées du sitemap
const lienRetire = new RegExp(`<a\\b[^>]*href="/?(?:${retirees.map(esc).join('|')})(?:#[^"]*)?"[^>]*>[\\s\\S]*?</a>`, 'g');
function nettoyerLiens(txt) { return txt.replace(lienRetire, ''); }

const fichiers = [];
(function lister(d) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) { if (e.name !== 'node_modules') lister(p); } else fichiers.push(p); } })(OUT);
for (const f of fichiers) {
  const rel = path.relative(OUT, f);
  if (!TEXTE.test(path.basename(f)) || rel.startsWith('vendor')) continue;
  let t = fs.readFileSync(f, 'utf8');
  const avant = t;
  if (f.endsWith('.html')) t = nettoyerLiens(t);
  if (rel === 'sitemap.xml') t = t.replace(new RegExp(`\\s*<url><loc>[^<]*/(?:${retirees.map(esc).join('|')})</loc>[\\s\\S]*?</url>`, 'g'), '');
  t = remplacer(t);
  if (t !== avant) fs.writeFileSync(f, t);
}

// ─── 4. Noirland Music : hors produit ────────────────────────────────────────
{
  // Retrait du code des fonctions Noirland (blocs « exports.noirland… » de legacy-v2.js)
  const lv = path.join(OUT, 'functions', 'legacy-v2.js');
  const blocs = fs.readFileSync(lv, 'utf8').split(/\n(?=exports\.)/);
  // Un bloc retiré peut contenir des imports partagés (ex. « const { onCall } = require(…) ») : on les garde.
  const garde = (b) => (b.match(/^(?:const|let|var)\s[^\n]*require\([^\n]*$/gm) || []).join('\n');
  fs.writeFileSync(lv, blocs.map((b) => (/^exports\.noirland/.test(b) ? garde(b) : b)).filter(Boolean).join('\n'));
  const idx = path.join(OUT, 'functions', 'index.js');
  fs.appendFileSync(idx, "\n// Kit : les fonctions propres à Noirland Music ne font pas partie du produit.\nfor (const k of Object.keys(exports)) if (/^noirland/i.test(k)) delete exports[k];\n");
  const rulesPath = path.join(OUT, 'firestore.rules');
  let rules = fs.readFileSync(rulesPath, 'utf8');
  rules = rules.replace('allow create: if isAdmin() || validNoirlandCreate();', 'allow create: if isAdmin();');
  fs.writeFileSync(rulesPath, rules);
}

// ─── 5. Fichiers propres au client ───────────────────────────────────────────
fs.writeFileSync(path.join(OUT, 'CNAME'), C.site.domaine + '\n');
fs.writeFileSync(path.join(OUT, '.firebaserc'), JSON.stringify({ projects: { default: C.firebase.projectId } }, null, 2) + '\n');
if (C.tarifs && C.tarifs !== 'tarifs.json') {
  const t = fs.readFileSync(path.resolve(path.dirname(cfgPath), C.tarifs), 'utf8');
  fs.writeFileSync(path.join(OUT, 'tarifs.json'), t);
  fs.writeFileSync(path.join(OUT, 'functions', 'tarifs.json'), t);
}
if (C.integrations?.appCheckSiteKey) {
  const ac = path.join(OUT, 'appcheck-config.js');
  fs.writeFileSync(ac, fs.readFileSync(ac, 'utf8').replace("APP_CHECK_SITE_KEY = ''", `APP_CHECK_SITE_KEY = '${C.integrations.appCheckSiteKey}'`));
}

// ─── 6. Rapport : ce qui reste de Makouez IT et ce qu'il faut personnaliser ─
const restes = { 'Makouez': /Makouez/g, 'makouezit': /makouezit/g, 'Noirland': /[Nn]oirland/g, 'Seine-Saint-Denis / 93': /Seine-Saint-Denis|\(93\)/g,
  'Pierrefitte': /Pierrefitte/g, 'Île-de-France': /Île-de-France/g, 'A-RENSEIGNER': /A-RENSEIGNER/g };
const lignes = [];
for (const f of fichiers) {
  if (!fs.existsSync(f)) continue;
  const rel = path.relative(OUT, f);
  if (!TEXTE.test(path.basename(f)) || rel.startsWith('vendor') || rel.startsWith('functions/node_modules')) continue;
  const t = fs.readFileSync(f, 'utf8');
  const trouves = Object.entries(restes).map(([k, re]) => [k, (t.match(re) || []).length]).filter(([, n]) => n);
  if (trouves.length) lignes.push(`| ${rel} | ${trouves.map(([k, n]) => `${k} ×${n}`).join(', ')} |`);
}
const rapport = `# Rapport de génération — ${C.identite.marque}

Généré le ${new Date().toISOString().slice(0, 10)} depuis makouezit.org (configuration \`${path.basename(cfgPath)}\`).

- Pages retirées : ${retirees.length} (${retirees.join(', ')})
- Remplacements d'identité appliqués : ${R.length} règles
- Fonctions Noirland Music retirées, règle Firestore Noirland désactivée

## Mentions restantes à personnaliser

Les mentions « Makouez », « makouezit » et « Noirland » restantes sont des noms techniques internes (clés de stockage, identifiants) sans effet visible, sauf indication contraire.
Les mentions de zone (Seine-Saint-Denis, Pierrefitte, Île-de-France) sont des textes de l'accueil et des pages services : elles seront paramétrées à l'étape 3 (générateur de pages).

| Fichier | Mentions |
| --- | --- |
${lignes.join('\n') || '| — | aucune |'}
`;
fs.writeFileSync(path.join(OUT, 'RAPPORT-GENERATION.md'), rapport);
console.log(`✓ ${C.identite.marque} généré dans ${path.relative(ROOT, OUT)}/ — ${retirees.length} pages retirées, rapport : RAPPORT-GENERATION.md`);
