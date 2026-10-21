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
// Métier : « informatique » garde les textes du site source ; un autre métier
// applique le pack kit/packs/<metier>.json (étape 5, voir kit/packs.mjs).
// Aucune dépendance : Node 18+ suffit.
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformeur, DESIGNS_DISPONIBLES } from './themes.mjs';
import { zoneConfig, zoneRemplacements, genererPages, adapterAccueil, adapterReservation, entreesSitemap } from './zone.mjs';
import { regenerer as regenererServices } from './services.mjs';
import { chargerPack, metierVilles, appliquerPack, reglesContrats, TERMES_INFORMATIQUE } from './packs.mjs';

const KIT = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(KIT, '..');
const cfgPath = process.argv[2];
if (!cfgPath) { console.error('Usage : node kit/build.mjs kit/config/<client>.json'); process.exit(1); }

const SRC = JSON.parse(fs.readFileSync(path.join(KIT, 'config', 'source-makouez-it.json'), 'utf8'));
const CFG = JSON.parse(fs.readFileSync(path.resolve(cfgPath), 'utf8'));
// Option --design <nom> : essayer un autre design sans modifier la configuration
const iDesign = process.argv.indexOf('--design');
if (iDesign > 0) { CFG.design = process.argv[iDesign + 1]; CFG.slug = `${CFG.slug}-${CFG.design}`; }
CFG.design = CFG.design || 'clair';
if (!DESIGNS_DISPONIBLES.includes(CFG.design)) { console.error(`design inconnu : ${CFG.design} (${DESIGNS_DISPONIBLES.join(', ')})`); process.exit(1); }
const OUT = path.join(ROOT, 'dist', CFG.slug);

// ─── 0. Vérification de la configuration ────────────────────────────────────
const requis = ['slug', 'identite.marque', 'identite.logo.debut', 'identite.prenom', 'identite.nomComplet', 'identite.siret',
  'identite.adresse.rue', 'identite.adresse.codePostal', 'identite.adresse.ville', 'contact.telephone', 'contact.telephoneIntl',
  'contact.whatsapp', 'contact.email', 'contact.emailAdmin', 'site.domaine', 'firebase.projectId'];
const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
const manquants = requis.filter((p) => !get(CFG, p));
if (manquants.length) { console.error('Configuration incomplète :', manquants.join(', ')); process.exit(1); }
if (!/^[a-z0-9-]+$/.test(CFG.slug)) { console.error('slug : minuscules, chiffres et tirets uniquement'); process.exit(1); }

// Pack métier et grille du client : sa grille (clé « tarifs »), sinon celle du pack, sinon celle de Makouez IT
const PACK = chargerPack(CFG, KIT);
const MODULES = { ...(PACK?.modules || {}), ...(CFG.modules || {}) };
const TARIFS_SOURCE = fs.readFileSync(path.join(ROOT, 'tarifs.json'), 'utf8');
let tarifsTexte = TARIFS_SOURCE;
if (CFG.tarifs && CFG.tarifs !== 'tarifs.json') tarifsTexte = fs.readFileSync(path.resolve(path.dirname(cfgPath), CFG.tarifs), 'utf8');
else if (PACK?.tarifs) tarifsTexte = JSON.stringify(PACK.tarifs, null, 2) + '\n';
const TG = JSON.parse(tarifsTexte);
const M = metierVilles(PACK);

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
const Z = zoneConfig(CFG, M); // null si le client n'a pas renseigné de villes
const garder = new Set([...(CFG.zone?.pagesLocalesAGarder || []), ...(Z ? [Z.hub, ...Z.villes.map((v) => v.fichier)] : [])]);
const retirees = PAGES_LOCALES.filter((p) => !garder.has(p));
if (MODULES.portfolio === false) retirees.push('portfolio.html');
retirees.push('services-a-la-personne.html'); // page de redirection propre à makouezit.org
for (const p of PACK?.pagesRetirees || []) if (!retirees.includes(p)) retirees.push(p);
if (!Object.keys(TG.contrats || {}).length && !Object.keys(TG.maintenanceWeb || {}).length) retirees.push('contrats.html', 'suivi-contrat.html');
if (!TG.pro) { if (!retirees.includes('contrats-pro.html')) retirees.push('contrats-pro.html'); }
for (const p of retirees) fs.rmSync(path.join(OUT, p), { force: true });
if (MODULES.offresWeb === false) fs.rmSync(path.join(OUT, 'offres-web.css'), { force: true });
for (const f of PACK?.fichiersRetires || []) fs.rmSync(path.join(OUT, f), { force: true });
if (MODULES.chatIA === false) fs.rmSync(path.join(OUT, 'chat-widget.js'), { force: true });

// ─── 2 bis. Pages locales du client (étape 3) ───────────────────────────────
let pagesGenerees = [];
if (Z) {
  const gabarit = fs.readFileSync(path.join(ROOT, 'depannage-informatique-pierrefitte-sur-seine.html'), 'utf8');
  const pages = genererPages(Z, CFG, gabarit, CFG.site.domaine, M, TG);
  for (const [f, contenu] of Object.entries(pages)) fs.writeFileSync(path.join(OUT, f), contenu);
  pagesGenerees = Object.keys(pages);
}

// ─── 2 ter. Grille du client, listes de services, pack métier (étape 5) ─────
fs.writeFileSync(path.join(OUT, 'tarifs.json'), tarifsTexte);
fs.writeFileSync(path.join(OUT, 'functions', 'tarifs.json'), tarifsTexte);
regenererServices(OUT, TG); // cartes de réservation, créneaux, espace client, rappel, admin, cartes de contrats
{
  const rp = path.join(OUT, 'firestore.rules');
  fs.writeFileSync(rp, reglesContrats(fs.readFileSync(rp, 'utf8'), TG));
}
if (MODULES.offresWeb === false && fs.existsSync(path.join(OUT, 'contrats.html'))) {
  const cp = path.join(OUT, 'contrats.html');
  fs.writeFileSync(cp, fs.readFileSync(cp, 'utf8').replace(/<!-- kit:offres-web -->\n[\s\S]*?<!-- \/kit:offres-web -->\n?/, ''));
}
if (MODULES.chatIA === false) {
  const ip = path.join(OUT, 'index.html');
  fs.writeFileSync(ip, fs.readFileSync(ip, 'utf8').replace(/<script src="\/?chat-widget\.js"[^>]*><\/script>\n?/g, ''));
}
// « dès <prix d'un contrat de Makouez IT> » : contrat le moins cher de la grille du client
{
  const ct = Object.entries(TG.contrats || {}).filter(([, v]) => typeof v.prix === 'number').sort((x, y) => x[1].prix - y[1].prix)[0];
  const fmtP = (v) => `${String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}&nbsp;€`;
  if (ct) for (const f of fs.readdirSync(OUT).filter((x) => x.endsWith('.html'))) {
    const p = path.join(OUT, f);
    const t = fs.readFileSync(p, 'utf8');
    const t2 = t.replace(/data-tarif="contrats\.(\w+)\.prix">[^<]*</g, (m, k) => (TG.contrats[k] ? m : `data-tarif="contrats.${ct[0]}.prix">${fmtP(ct[1].prix)}<`));
    if (t2 !== t) fs.writeFileSync(p, t2);
  }
}
let pagesService = [];
if (PACK) {
  const gabarit = fs.readFileSync(path.join(ROOT, 'depannage-informatique-pierrefitte-sur-seine.html'), 'utf8');
  ({ pagesService } = appliquerPack(OUT, PACK, CFG, Z, TG, gabarit));
}

// ─── 3. Table de remplacement (du plus spécifique au plus général) ──────────
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const html = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const S = SRC, C = CFG;
const logoAccent = C.identite.logo.accent || '';
const R = []; // [RegExp|string, remplacement]
const add = (from, to) => { if (from && to != null) R.push([from, String(to)]); };

// Textes de zone (« Seine-Saint-Denis », « Île-de-France »… → zone du client)
if (Z) for (const [a, b] of zoneRemplacements(Z)) add(a, b);
// Présentation personnelle (parcours de Stevy → texte du client)
const id = C.identite;
R.push([/Formé au dépannage informatique dès 2014[^<]*/g, id.bio || `${id.prenom} intervient à domicile pour les particuliers et les petites entreprises, avec des explications simples et un prix annoncé avant.`]);
add('Technicien informatique en entreprise depuis 2018.', id.accroche || 'Technicien informatique à domicile.');
add('<span aria-hidden="true">🏆</span> Technicien depuis 2018', `<span aria-hidden="true">🏆</span> ${html(id.badgeExperience || 'Technicien expérimenté')}`);
add("technicien informatique avec 9 ans d'expérience", id.experience || 'technicien informatique');
// Activité principale déclarée (mentions légales) : propre à chaque entreprise
add('Services informatiques (NAF : 6209Z)', id.activitePrincipale || 'A-RENSEIGNER (activité principale et code NAF)');
// Textes propres au métier d'origine (pack : « dépannage informatique » → « plomberie »…)
for (const [a, b] of PACK?.remplacements || []) add(a, b);
// Logos HTML (marque en deux couleurs)
R.push([/Makouez ?<span( style="[^"]*")?>IT<\/span>/g, (m, st) => `${html(C.identite.logo.debut)}${logoAccent ? `${C.identite.logo.colle ? '' : '&nbsp;'}<span${st || ''}>${html(logoAccent)}</span>` : ''}`]);
R.push([/Makouez<span>IT(?!<)/g, `${html(C.identite.logo.debut)}${C.identite.logo.colle ? '' : '&nbsp;'}<span>${html(logoAccent)}`]);
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
  if (Z && rel === 'index.html') t = adapterAccueil(t, Z);
  if (Z && rel === 'makouez-it-rdv.html') t = adapterReservation(t, Z);
  if (Z && rel === 'sitemap.xml') t = t.replace('</urlset>', entreesSitemap(Z, CFG.site.domaine, new Date().toISOString().slice(0, 10)) + '</urlset>');
  if (pagesService.length && rel === 'sitemap.xml') t = t.replace('</urlset>', `  <!-- Pages services (pack ${PACK.metier}) -->\n${pagesService.map((f) => `  <url><loc>https://${S.site.domaine}/${f}</loc><lastmod>${new Date().toISOString().slice(0, 10)}</lastmod><changefreq>monthly</changefreq><priority>0.8</priority></url>`).join('\n')}\n</urlset>`);
  if (rel === 'sitemap.xml') t = t.replace(new RegExp(`\\s*<url><loc>[^<]*/(?:${retirees.map(esc).join('|')})</loc>[\\s\\S]*?</url>`, 'g'), '');
  t = remplacer(t);
  if (t !== avant) fs.writeFileSync(f, t);
}

// ─── 3 bis. Design (étape 4) ─────────────────────────────────────────────────
const T = transformeur(CFG.design);
if (T) {
  const publics = fichiers.filter((f) => {
    const rel = path.relative(OUT, f);
    if (rel.includes(path.sep)) return false; // racine uniquement : pas d'admin/, functions/, vendor/
    return /\.(html|css|js|json)$/.test(rel) && rel !== 'admin.html' && rel !== 'tarifs.json' && rel !== 'appcheck-config.js' && !T.exclus.includes(rel);
  });
  for (const f of publics) {
    if (!fs.existsSync(f)) continue;
    let t = fs.readFileSync(f, 'utf8');
    t = T.appliquer(t);
    if (f.endsWith('.html')) t = t.replace('</head>', '<link rel="stylesheet" href="/theme-design.css">\n</head>');
    fs.writeFileSync(f, t);
  }
  fs.writeFileSync(path.join(OUT, 'theme-design.css'), T.forme);
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
// Prix affichés (data-tarif) absents de la grille du client, et termes informatiques restants (pack métier)
const prixInconnus = [], termesIT = [];
for (const f of fs.readdirSync(OUT).filter((x) => x.endsWith('.html'))) {
  const t = fs.readFileSync(path.join(OUT, f), 'utf8');
  for (const m of t.matchAll(/data-tarif="([^"]+)"/g)) if (get(TG, m[1]) === undefined) prixInconnus.push(`${f} : ${m[1]}`);
  if (PACK && f !== 'admin.html') {
    const visible = t.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, ' ');
    const n = (visible.match(TERMES_INFORMATIQUE) || []);
    if (n.length) termesIT.push(`| ${f} | ${[...new Set(n.map((x) => x.toLowerCase()))].join(', ')} (×${n.length}) |`);
  }
}
if (prixInconnus.length) console.warn(`⚠ ${prixInconnus.length} prix affichés absents de la grille du client (voir le rapport)`);
const rapport = `# Rapport de génération — ${C.identite.marque}

Généré le ${new Date().toISOString().slice(0, 10)} depuis makouezit.org (configuration \`${path.basename(cfgPath)}\`).

- Pages retirées : ${retirees.length} (${retirees.join(', ')})
- Pages locales générées : ${pagesGenerees.length}${pagesGenerees.length ? ` (${pagesGenerees.join(', ')})` : ' (renseigner zone.villes dans la configuration)'}${Z && Z.villes.some((v) => !v.complete) ? `\n- **Pages de ville à compléter** (en noindex et hors sitemap tant qu'il manque un texte propre : \`intro\` + au moins 2 \`sections\`) : ${Z.villes.filter((v) => !v.complete).map((v) => v.nom).join(', ')}` : ''}
- Design : ${CFG.design}
- Métier : ${PACK ? `${PACK.libelle} (pack \`kit/packs/${PACK.metier}.json\`) — ${pagesService.length} pages services générées` : 'informatique (textes du site source)'}
- Grille : ${C.tarifs ? C.tarifs : PACK?.tarifs ? `grille d'exemple du pack (**prix à remplacer par ceux du client**)` : 'celle de Makouez IT'}
- Remplacements d'identité appliqués : ${R.length} règles
- Fonctions Noirland Music retirées, règle Firestore Noirland désactivée

${prixInconnus.length ? `## Prix introuvables dans la grille\n\nCes éléments affichent un prix dont le chemin n'existe pas dans \`tarifs.json\` du client : ils garderont la valeur de Makouez IT.\n\n${prixInconnus.map((x) => `- ${x}`).join('\n')}\n\n` : ''}${PACK ? `## Textes à faire valider par le client\n\n- **CGV** : l'article « Services proposés » et la grille sont générés depuis le pack ; le reste des CGV (rétractation, garanties, médiateur) doit être relu et validé par le client.\n- **Mentions légales** : activité principale et code NAF${C.identite.activitePrincipale ? ' (renseignés dans la configuration)' : ' (**à renseigner** : clé \`identite.activitePrincipale\`)'}, assurance professionnelle (décennale pour le bâtiment) à ajouter si besoin.\n- **Prix** : ${C.tarifs ? 'grille du client' : 'les prix du pack sont des exemples'}.\n- **Statut et TVA** : le site reprend « micro-entrepreneur » et « TVA non applicable (art. 293 B du CGI) » de Makouez IT ; à corriger si le client n'est pas en franchise de TVA.\n\n## Termes de l'informatique restant dans les pages\n\n${termesIT.length ? `| Fichier | Termes |\n| --- | --- |\n${termesIT.join('\n')}` : 'Aucun.'}\n\n` : ''}## Mentions restantes à personnaliser

Les mentions « Makouez », « makouezit » et « Noirland » restantes sont des noms techniques internes (clés de stockage, identifiants) sans effet visible, sauf indication contraire.
Les mentions de zone restantes (Seine-Saint-Denis, Pierrefitte, Île-de-France) se trouvent dans des textes que la configuration ne couvre pas encore : à reprendre à la main.

| Fichier | Mentions |
| --- | --- |
${lignes.join('\n') || '| — | aucune |'}
`;
fs.writeFileSync(path.join(OUT, 'RAPPORT-GENERATION.md'), rapport);
console.log(`✓ ${C.identite.marque} généré dans ${path.relative(ROOT, OUT)}/ — ${retirees.length} pages retirées, rapport : RAPPORT-GENERATION.md`);
