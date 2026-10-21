#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// kit/install.mjs — Installation automatisée du site d'un client (étape 6).
//
//   node kit/install.mjs kit/config/<client>.json [options]
//
// À lancer dans Google Cloud Shell (gcloud, firebase et node y sont installés)
// avec un compte Google qui a le droit de créer des projets.
// Chaque étape vérifie l'état avant d'agir : on peut relancer le script après
// une erreur, il reprend sans refaire ce qui est déjà fait.
//
// Options :
//   --simulation                 affiche les commandes sans rien exécuter
//   --etapes a,b,c               ne lance que ces étapes (voir ETAPES plus bas)
//   --compte-facturation <id>    compte de facturation à rattacher (forfait Blaze)
//   --hebergement firebase|github  Firebase Hosting (par défaut) ou GitHub Pages
//   --mot-de-passe-admin <mdp>   sinon un mot de passe provisoire est généré
//
// Les clés secrètes se donnent par variables d'environnement (jamais dans la
// configuration) : RESEND_API_KEY (obligatoire), PLACES_API_KEY et
// ANTHROPIC_API_KEY (facultatives). Sans variable, le script les demande.
//
// Rien n'est supprimé : le script crée ou complète, il ne détruit jamais.
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const KIT = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(KIT, '..');

export const ETAPES = ['prerequis', 'projet', 'facturation', 'apis', 'firestore', 'appweb', 'generation', 'auth',
  'secrets', 'deploiement', 'invocateurs', 'admin', 'hebergement'];

export const APIS = ['firestore.googleapis.com', 'cloudfunctions.googleapis.com', 'run.googleapis.com', 'cloudbuild.googleapis.com',
  'artifactregistry.googleapis.com', 'eventarc.googleapis.com', 'pubsub.googleapis.com', 'cloudscheduler.googleapis.com',
  'secretmanager.googleapis.com', 'identitytoolkit.googleapis.com', 'firebasehosting.googleapis.com', 'cloudresourcemanager.googleapis.com'];

// Secrets lus par les fonctions : [nom, obligatoire, à quoi il sert]
export const SECRETS = [
  ['RESEND_API_KEY', true, 'envoi des emails (confirmations, rappels, factures) via Resend'],
  ['PLACES_API_KEY', false, 'synchronisation des avis Google'],
  ['ANTHROPIC_API_KEY', false, 'assistant de chat IA'],
];
const VALEUR_NON_CONFIGUREE = 'non-configure';

// ─── Utilitaires purs (testés par tests/kit-install.test.mjs) ───────────────

// Fonctions v2 appelables depuis le navigateur (onCall / onRequest) : elles doivent
// autoriser « allUsers » à invoquer leur service Cloud Run, sinon le site reçoit 403.
export function fonctionsPubliquesV2(dossierFunctions) {
  const noms = new Set();
  const retirees = new Set();
  for (const f of fs.readdirSync(dossierFunctions).filter((x) => x.endsWith('.js'))) {
    const s = fs.readFileSync(path.join(dossierFunctions, f), 'utf8');
    for (const m of s.matchAll(/exports\.(\w+)\s*=\s*(onCall|onRequest)\s*\(/g)) noms.add(m[1]);
    for (const m of s.matchAll(/(?:const|let)\s+(\w+)\s*=\s*(onCall|onRequest)\s*\(/g)) {
      // déclarée puis exportée sous un autre nom (module.exports = { functions: { unsubscribe } })
      if (new RegExp(`\\b${m[1]}\\b\\s*[,}]`).test(s.slice(s.indexOf('module.exports')))) noms.add(m[1]);
    }
    for (const m of s.matchAll(/delete exports\.(\w+)/g)) retirees.add(m[1]);
    if (/for \(const k of Object\.keys\(exports\)\) if \(\/\^noirland\/i/.test(s)) for (const n of [...noms]) if (/^noirland/i.test(n)) retirees.add(n);
  }
  return [...noms].filter((n) => !retirees.has(n)).sort();
}

// Domaines autorisés pour la connexion (Firebase Auth)
export function domainesAutorises(existants, projectId, domaine) {
  const d = new Set(existants || []);
  for (const x of ['localhost', `${projectId}.firebaseapp.com`, `${projectId}.web.app`, domaine, `www.${domaine}`]) if (x) d.add(x);
  return [...d];
}

// Configuration Auth : email + mot de passe, lien de connexion par email, TOTP (2FA admin), emails en français
export function configAuth(domaines) {
  return {
    signIn: { email: { enabled: true, passwordRequired: false } },
    mfa: { state: 'ENABLED', providerConfigs: [{ state: 'ENABLED', totpProviderConfig: { adjacentIntervals: 5 } }] },
    authorizedDomains: domaines,
    notification: { defaultLocale: 'fr' },
  };
}
export const MASQUE_AUTH = 'signIn.email.enabled,signIn.email.passwordRequired,mfa,authorizedDomains,notification.defaultLocale';

// Configuration web de l'application Firebase, quel que soit le format de la CLI
export function lireSdkConfig(sortieJson) {
  const r = (typeof sortieJson === 'string' ? JSON.parse(sortieJson) : sortieJson).result || {};
  if (r.sdkConfig) return r.sdkConfig;
  if (r.fileContents) {
    try { return JSON.parse(r.fileContents); } catch { /* ancien format : objet JS */ }
    const v = (k) => (r.fileContents.match(new RegExp(`"?${k}"?\\s*:\\s*"([^"]+)"`)) || [])[1];
    return { apiKey: v('apiKey'), appId: v('appId'), messagingSenderId: v('messagingSenderId'), projectId: v('projectId') };
  }
  throw new Error('configuration web illisible dans la sortie de « firebase apps:sdkconfig »');
}

// Hébergement Firebase : le dossier du site, sans les fichiers internes
export function configHosting() {
  return {
    public: '.',
    ignore: ['firebase.json', '.firebaserc', 'firestore.rules', 'functions/**', '**/.*', '**/node_modules/**', '*.md', 'CNAME'],
    cleanUrls: false,
  };
}

export const motDePasseProvisoire = () => crypto.randomBytes(12).toString('base64url') + '!7a';

// ─── Exécution ───────────────────────────────────────────────────────────────

function executeurReel({ cwd }) {
  return (cmd, args, { entree, silencieux, dossier } = {}) => new Promise((resolve, reject) => {
    const p = execFile(cmd, args, { cwd: dossier || (fs.existsSync(cwd) ? cwd : ROOT), maxBuffer: 64 * 1024 * 1024, env: process.env }, (err, stdout, stderr) => {
      if (err) { err.stdout = stdout; err.stderr = stderr; return reject(err); }
      resolve(stdout);
    });
    if (entree != null) { p.stdin.write(entree); p.stdin.end(); }
    if (!silencieux) p.stderr?.on('data', () => {});
  });
}

async function demander(question, { masque = false } = {}) {
  if (!process.stdin.isTTY) return '';
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  if (masque) rl._writeToOutput = (s) => { if (s.includes(question)) process.stdout.write(s); };
  const r = await new Promise((res) => rl.question(question, res));
  rl.close();
  if (masque) process.stdout.write('\n');
  return r.trim();
}

export async function installer({ cfgPath, options = {}, run, http, log = console.log, attendre = (ms) => new Promise((r) => setTimeout(r, ms)), demanderSecret = demander }) {
  const CFG = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const id = CFG.firebase?.projectId;
  if (!id || !/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(id)) throw new Error('firebase.projectId invalide : 6 à 30 caractères, minuscules, chiffres et tirets, commence par une lettre');
  const SRC = JSON.parse(fs.readFileSync(path.join(KIT, 'config', 'source-makouez-it.json'), 'utf8'));
  if (id === SRC.firebase.projectId) throw new Error(`${id} est le projet de makouezit.org : chaque client a son propre projet`);
  const region = CFG.installation?.region || 'europe-west1';
  const hebergement = options.hebergement || CFG.installation?.hebergement || 'firebase';
  const compteFacturation = options.compteFacturation || CFG.installation?.compteFacturation;
  const OUT = path.join(ROOT, 'dist', CFG.slug);
  const simulation = !!options.simulation;
  const etapes = options.etapes ? options.etapes.split(',').map((x) => x.trim()) : ETAPES;
  for (const e of etapes) if (!ETAPES.includes(e)) throw new Error(`étape inconnue : ${e} (${ETAPES.join(', ')})`);

  const journal = []; // [étape, statut, détail]
  const aFaire = []; // actions manuelles restantes
  const note = (etape, statut, detail) => { journal.push([etape, statut, detail]); log(`${statut === 'ok' ? '✓' : statut === 'deja' ? '•' : statut === 'simulation' ? '›' : '!'} ${etape} : ${detail}`); };

  const runner = run || executeurReel({ cwd: OUT });
  const cmd = async (c, args, opts = {}) => {
    if (simulation) {
      // Simulation : rien n'est exécuté ; les lectures d'état répondent « rien trouvé »
      if (opts.lecture) throw new Error('simulation');
      log(`  $ ${c} ${args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(' ')}`);
      return opts.simule ?? '';
    }
    return runner(c, args, opts);
  };
  const essayer = async (c, args, opts) => { try { return { ok: true, sortie: await cmd(c, args, opts) }; } catch (e) { return { ok: false, erreur: e }; } };
  const json = (s) => { try { return JSON.parse(s); } catch { return null; } };
  const fb = (args, opts) => cmd('firebase', [...args, '--project', id, '--non-interactive'], opts);

  let jeton = null;
  const api = async (methode, url, corps) => {
    if (simulation) { log(`  ${methode} ${url}${corps ? ` ${JSON.stringify(corps).replace(/"password":"[^"]*"/, '"password":"••••"').slice(0, 160)}…` : ''}`); return {}; }
    jeton ||= (await runner('gcloud', ['auth', 'print-access-token'])).trim();
    const r = await (http || fetch)(url, { method: methode, headers: { Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json', 'X-Goog-User-Project': id }, body: corps ? JSON.stringify(corps) : undefined });
    const texte = await r.text();
    const donnees = texte ? json(texte) ?? { texte } : {};
    if (!r.ok) { const e = new Error(`${methode} ${url.split('?')[0]} → ${r.status} ${donnees.error?.message || texte.slice(0, 200)}`); e.status = r.status; e.donnees = donnees; throw e; }
    return donnees;
  };

  const etape = async (nom, fn) => {
    if (!etapes.includes(nom)) return;
    log(`\n── ${nom}`);
    await fn();
  };

  // 1. Prérequis
  await etape('prerequis', async () => {
    if (simulation) return note('prerequis', 'simulation', 'vérifications sautées (gcloud, firebase, node, comptes connectés)');
    for (const [c, args, aide] of [['node', ['--version'], 'Node 20 ou plus'], ['gcloud', ['--version'], 'Google Cloud SDK (déjà présent dans Cloud Shell)'], ['firebase', ['--version'], 'npm i -g firebase-tools']]) {
      const r = await essayer(c, args, { lecture: true });
      if (!r.ok) throw new Error(`${c} introuvable : ${aide}`);
      if (c === 'node' && Number(String(r.sortie).replace(/^v/, '').split('.')[0]) < 20) throw new Error('Node 20 ou plus requis');
    }
    const comptes = await essayer('gcloud', ['auth', 'list', '--filter=status:ACTIVE', '--format=value(account)'], { lecture: true });
    if (!comptes.ok || !String(comptes.sortie).trim()) throw new Error('aucun compte gcloud actif : lancer « gcloud auth login »');
    const fbLogin = await essayer('firebase', ['login:list', '--json'], { lecture: true });
    const fbComptes = fbLogin.ok ? (json(fbLogin.sortie)?.result || []) : [];
    if (!fbComptes.length) throw new Error('CLI Firebase non connectée : lancer « firebase login --no-localhost »');
    if (!fs.existsSync(OUT) && !etapes.includes('generation')) throw new Error(`site non généré : node kit/build.mjs ${path.relative(ROOT, cfgPath)}`);
    note('prerequis', 'ok', `gcloud (${String(comptes.sortie).trim().split('\n')[0]}), firebase, node`);
  });

  // 2. Projet Firebase
  await etape('projet', async () => {
    const liste = await essayer('firebase', ['projects:list', '--json'], { lecture: true });
    const existe = liste.ok && (json(liste.sortie)?.result || []).some((p) => p.projectId === id);
    if (existe) return note('projet', 'deja', `${id} existe déjà`);
    await cmd('firebase', ['projects:create', id, '--display-name', CFG.identite.marque.slice(0, 30), '--non-interactive']);
    note('projet', simulation ? 'simulation' : 'ok', `projet ${id} créé`);
  });

  // 3. Forfait Blaze (facturation) : obligatoire pour les Cloud Functions
  await etape('facturation', async () => {
    const r = await essayer('gcloud', ['billing', 'projects', 'describe', id, '--format=value(billingEnabled)'], { lecture: true });
    if (r.ok && String(r.sortie).trim() === 'True') return note('facturation', 'deja', 'facturation active (forfait Blaze)');
    if (!compteFacturation) {
      aFaire.push(`Rattacher un compte de facturation au projet ${id} (Console Firebase → ⚙ → Utilisation et facturation → Blaze), puis relancer : node kit/install.mjs ${path.relative(ROOT, cfgPath)} --etapes facturation,apis,firestore,appweb,generation,auth,secrets,deploiement,invocateurs,admin,hebergement. Ou : gcloud billing accounts list, puis --compte-facturation <ID>.`);
      if (simulation) return note('facturation', 'simulation', 'facturation à rattacher (--compte-facturation)');
      throw new Error('facturation inactive : relancer avec --compte-facturation <ID> (gcloud billing accounts list) ou l’activer dans la console');
    }
    await cmd('gcloud', ['billing', 'projects', 'link', id, `--billing-account=${compteFacturation}`]);
    note('facturation', simulation ? 'simulation' : 'ok', `compte ${compteFacturation} rattaché`);
  });

  // 4. API Google Cloud
  await etape('apis', async () => {
    await cmd('gcloud', ['services', 'enable', ...APIS, `--project=${id}`]);
    note('apis', simulation ? 'simulation' : 'ok', `${APIS.length} API activées`);
  });

  // 5. Base Firestore + durée de vie des limites anti-abus
  await etape('firestore', async () => {
    const r = await essayer('gcloud', ['firestore', 'databases', 'describe', '--database=(default)', `--project=${id}`, '--format=value(locationId)'], { lecture: true });
    if (r.ok && String(r.sortie).trim()) note('firestore', 'deja', `base existante (${String(r.sortie).trim()})`);
    else {
      await cmd('gcloud', ['firestore', 'databases', 'create', `--location=${region}`, '--type=firestore-native', `--project=${id}`]);
      note('firestore', simulation ? 'simulation' : 'ok', `base créée en ${region}`);
    }
    const ttl = await essayer('gcloud', ['firestore', 'fields', 'ttls', 'update', 'expireAt', '--collection-group=rate_limits', '--enable-ttl', '--async', `--project=${id}`]);
    if (!ttl.ok) aFaire.push('Firestore → Durée de vie (TTL) : règle sur la collection rate_limits, champ expireAt (la commande automatique a échoué).');
    else note('firestore', simulation ? 'simulation' : 'ok', 'TTL rate_limits.expireAt (suppression des empreintes après 48 h)');
  });

  // 6. Application web Firebase → clés dans la configuration du client
  await etape('appweb', async () => {
    const liste = await essayer('firebase', ['apps:list', 'WEB', '--project', id, '--json'], { lecture: true });
    let app = liste.ok ? (json(liste.sortie)?.result || [])[0] : null;
    if (!app) {
      const c = await fb(['apps:create', 'WEB', CFG.identite.marque, '--json'], { simule: JSON.stringify({ result: { appId: '1:000000000000:web:simulation' } }) });
      app = json(c)?.result || { appId: '1:000000000000:web:simulation' };
      note('appweb', simulation ? 'simulation' : 'ok', `application web créée (${app.appId})`);
    } else note('appweb', 'deja', `application web existante (${app.appId})`);
    if (simulation) return;
    const conf = lireSdkConfig(await runner('firebase', ['apps:sdkconfig', 'WEB', app.appId, '--project', id, '--json']));
    const avant = JSON.stringify(CFG.firebase);
    CFG.firebase = { ...CFG.firebase, apiKey: conf.apiKey, appId: conf.appId, messagingSenderId: conf.messagingSenderId };
    if (JSON.stringify(CFG.firebase) !== avant) {
      const brut = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
      brut.firebase = CFG.firebase;
      fs.writeFileSync(cfgPath, JSON.stringify(brut, null, 2) + '\n');
      note('appweb', 'ok', `clés web écrites dans ${path.relative(ROOT, cfgPath)}`);
    }
  });

  // 7. (Re)génération du site avec les clés du projet
  await etape('generation', async () => {
    await cmd(process.execPath, [path.join(KIT, 'build.mjs'), cfgPath], { dossier: ROOT });
    note('generation', simulation ? 'simulation' : 'ok', `site généré dans dist/${CFG.slug}/`);
  });

  // 8. Authentification : Identity Platform, email/mot de passe + lien email, TOTP, domaines, français
  await etape('auth', async () => {
    const config = `https://identitytoolkit.googleapis.com/admin/v2/projects/${id}/config`;
    let actuelle = simulation ? {} : await api('GET', config).catch(() => ({}));
    if (actuelle.subtype === 'IDENTITY_PLATFORM') note('auth', 'deja', 'Identity Platform déjà activé');
    else {
      try {
        await api('POST', `https://identitytoolkit.googleapis.com/v2/projects/${id}/identityPlatform:initializeAuth`, {});
        note('auth', simulation ? 'simulation' : 'ok', 'Identity Platform activé (nécessaire pour la 2FA par application)');
      } catch (e) {
        if (/already|ALREADY|exists/i.test(e.message) || e.status === 409) note('auth', 'deja', 'Identity Platform déjà activé');
        else throw e;
      }
      if (!simulation) actuelle = await api('GET', config);
    }
    const domaines = domainesAutorises(actuelle.authorizedDomains, id, CFG.site.domaine);
    await api('PATCH', `${config}?updateMask=${MASQUE_AUTH}`, configAuth(domaines));
    note('auth', simulation ? 'simulation' : 'ok', `email + lien email + TOTP activés, emails en français, domaines : ${domaines.join(', ')}`);
    aFaire.push(`Authentication → Modèles : nom d'expéditeur « ${CFG.identite.marque} » (facultatif, la langue est déjà le français).`);
  });

  // 9. Secrets des fonctions
  await etape('secrets', async () => {
    const chat = CFG.modules?.chatIA !== false && fs.existsSync(path.join(OUT, 'chat-widget.js'));
    for (const [nom, obligatoire, role] of SECRETS) {
      if (nom === 'ANTHROPIC_API_KEY' && !chat) continue;
      const existe = await essayer('gcloud', ['secrets', 'describe', nom, `--project=${id}`, '--format=value(name)'], { lecture: true });
      if (existe.ok && String(existe.sortie).trim() && !process.env[nom]) { note('secrets', 'deja', `${nom} déjà présent`); continue; }
      let valeur = process.env[nom] || '';
      if (!valeur && !simulation) valeur = await demanderSecret(`${nom} (${role})${obligatoire ? '' : ' — Entrée pour plus tard'} : `, { masque: true });
      if (!valeur && obligatoire && !simulation) throw new Error(`${nom} est obligatoire (${role}) : export ${nom}=… puis relancer --etapes secrets,deploiement,invocateurs,admin,hebergement`);
      if (!valeur) {
        valeur = VALEUR_NON_CONFIGUREE;
        aFaire.push(`Secret ${nom} (${role}) : provisoire. Le remplacer : printf '%s' "<clé>" | firebase functions:secrets:set ${nom} --data-file=- --project ${id} --force`);
      }
      await cmd('firebase', ['functions:secrets:set', nom, '--data-file=-', '--project', id, '--non-interactive', '--force'], { entree: valeur, silencieux: true });
      note('secrets', simulation ? 'simulation' : 'ok', `${nom} enregistré${valeur === VALEUR_NON_CONFIGUREE ? ' (provisoire)' : ''}`);
    }
  });

  // 10. Déploiement : dépendances, fonctions, règles Firestore
  await etape('deploiement', async () => {
    if (!simulation && CFG.integrations?.googlePlaceId) fs.writeFileSync(path.join(OUT, 'functions', '.env'), `GOOGLE_PLACE_ID=${CFG.integrations.googlePlaceId}\n`);
    await cmd('npm', ['ci', '--prefix', 'functions', '--no-audit', '--no-fund']);
    // Premier déploiement d'un projet neuf : les droits d'Eventarc mettent quelques minutes à se propager.
    for (let essai = 1; ; essai++) {
      // Sans --force : la CLI refuse de supprimer des fonctions absentes du code (rien n'est détruit).
      const r = await essayer('firebase', ['deploy', '--only', 'functions,firestore:rules', '--project', id, '--non-interactive']);
      if (r.ok) break;
      const msg = `${r.erreur?.stderr || ''}${r.erreur?.stdout || ''}${r.erreur?.message || ''}`;
      // Fonctions déployées, seule la règle de nettoyage des images manque : on la pose et on continue
      if (/successfully deployed but could not set up cleanup policy/i.test(msg)) {
        await cmd('firebase', ['functions:artifacts:setpolicy', '--location', region, '--days', '1', '--project', id, '--non-interactive', '--force']);
        break;
      }
      if (/would be deleted|following functions are found in your project but do not exist/i.test(msg)) throw new Error(`le projet ${id} contient des fonctions absentes du site généré : le déploiement les supprimerait. Vérifier le projet (est-ce bien celui du client ?) avant toute chose.`);
      if (essai >= 3) throw new Error(`déploiement en échec après 3 essais :\n${msg.slice(-1500)}`);
      log(`  essai ${essai} en échec (fréquent au premier déploiement : droits Eventarc en cours de propagation), nouvel essai dans 90 s…`);
      await attendre(90000);
    }
    note('deploiement', simulation ? 'simulation' : 'ok', 'fonctions et règles Firestore déployées');
  });

  // 11. Fonctions appelables depuis le site : invocation publique (sinon erreur 403 côté navigateur)
  await etape('invocateurs', async () => {
    const noms = fonctionsPubliquesV2(path.join(OUT, 'functions'));
    for (const n of noms) {
      const service = n.toLowerCase();
      const pol = await essayer('gcloud', ['run', 'services', 'get-iam-policy', service, `--region=${region}`, `--project=${id}`, '--format=json'], { lecture: true });
      if (pol.ok && /allUsers/.test(pol.sortie) && /roles\/run\.invoker/.test(pol.sortie)) { note('invocateurs', 'deja', `${n} déjà public`); continue; }
      await cmd('gcloud', ['run', 'services', 'add-iam-policy-binding', service, `--region=${region}`, '--member=allUsers', '--role=roles/run.invoker', `--project=${id}`, '--quiet']);
      note('invocateurs', simulation ? 'simulation' : 'ok', `${n} : invocation publique`);
    }
  });

  // 12. Compte administrateur (claim admin) ; la 2FA s'enrôle à la première connexion sur /admin.html
  let motDePasse = null;
  await etape('admin', async () => {
    const email = CFG.contact.emailAdmin;
    const base = `https://identitytoolkit.googleapis.com/v1/projects/${id}`;
    const trouve = simulation ? {} : await api('POST', `${base}/accounts:lookup`, { email: [email] });
    let uid = trouve.users?.[0]?.localId;
    if (!uid) {
      motDePasse = options.motDePasseAdmin || motDePasseProvisoire();
      const cree = await api('POST', `${base}/accounts`, { email, password: motDePasse, emailVerified: true, displayName: CFG.identite.nomComplet });
      uid = cree.localId || 'simulation';
      note('admin', simulation ? 'simulation' : 'ok', `compte ${email} créé`);
    } else note('admin', 'deja', `compte ${email} existant`);
    const attrs = trouve.users?.[0]?.customAttributes ? json(trouve.users[0].customAttributes) || {} : {};
    if (attrs.admin === true) return note('admin', 'deja', 'droit administrateur déjà attribué');
    await api('POST', `${base}/accounts:update`, { localId: uid, customAttributes: JSON.stringify({ ...attrs, admin: true }) });
    note('admin', simulation ? 'simulation' : 'ok', 'droit administrateur attribué');
  });

  // 13. Hébergement
  let urlSite = `https://${CFG.site.domaine}`;
  await etape('hebergement', async () => {
    if (hebergement === 'github') {
      aFaire.push(`GitHub Pages : créer un dépôt, y pousser le contenu de dist/${CFG.slug}/ (le fichier CNAME est prêt), Settings → Pages → branche main, puis DNS du domaine ${CFG.site.domaine} vers GitHub Pages (4 enregistrements A + CNAME www).`);
      return note('hebergement', 'ok', 'GitHub Pages : procédure dans INSTALLATION.md');
    }
    if (!simulation) {
      // Configuration d'hébergement ajoutée au firebase.json du site généré
      const fj = path.join(OUT, 'firebase.json');
      const f = JSON.parse(fs.readFileSync(fj, 'utf8'));
      f.hosting = configHosting();
      fs.writeFileSync(fj, JSON.stringify(f, null, 2) + '\n');
    }
    await cmd('firebase', ['deploy', '--only', 'hosting', '--project', id, '--non-interactive']);
    urlSite = `https://${id}.web.app`;
    note('hebergement', simulation ? 'simulation' : 'ok', `site en ligne sur ${urlSite}`);
    aFaire.push(`Domaine : Console Firebase → Hosting → Ajouter un domaine personnalisé → ${CFG.site.domaine} et www.${CFG.site.domaine}, puis créer chez le registraire les enregistrements DNS affichés (le certificat HTTPS suit en quelques heures).`);
  });

  // Actions qui restent manuelles (comptes tiers, DNS, validation du client)
  aFaire.push(
    `Resend : ajouter et vérifier le domaine ${CFG.site.domaine} (enregistrements DNS SPF/DKIM affichés par Resend), sinon les emails partent en indésirables ou sont refusés.`,
    `Première connexion admin : ${urlSite}/admin.html avec ${CFG.contact.emailAdmin}${motDePasse ? ' et le mot de passe provisoire' : ''}, enrôler la 2FA (QR code), puis changer le mot de passe. Garder la clé de secours.`,
    'App Check (facultatif, recommandé) : clé reCAPTCHA Enterprise pour le domaine, puis integrations.appCheckSiteKey dans la configuration et nouvelle génération.',
    'Google Maps (suggestions d’adresse) : clé restreinte au domaine, integrations.mapsApiKey dans la configuration.',
    'Search Console : ajouter le domaine et envoyer sitemap.xml ; Google Analytics : integrations.ga4.',
    'Faire valider par le client les textes légaux signalés dans RAPPORT-GENERATION.md (CGV, mentions légales, médiateur, TVA).',
    'Test de bout en bout : une réservation, une demande de rappel, une demande de contrat, la connexion à l’espace client.',
  );

  const rapport = `# Installation — ${CFG.identite.marque}

${simulation ? '**Simulation** : aucune commande exécutée.\n\n' : ''}Projet Firebase : \`${id}\` · région ${region} · hébergement ${hebergement === 'github' ? 'GitHub Pages' : `Firebase Hosting (${urlSite})`}
Date : ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC

## Étapes

| Étape | Statut | Détail |
| --- | --- | --- |
${journal.map(([e, s, d]) => `| ${e} | ${{ ok: 'fait', deja: 'déjà fait', simulation: 'simulé' }[s] || s} | ${d.replace(/\|/g, '/')} |`).join('\n')}

## À faire à la main

${aFaire.map((x, i) => `${i + 1}. ${x}`).join('\n')}
`;
  if (fs.existsSync(OUT)) fs.writeFileSync(path.join(OUT, 'INSTALLATION.md'), rapport);
  return { journal, aFaire, motDePasse, rapport };
}

// ─── Ligne de commande ───────────────────────────────────────────────────────
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const a = process.argv.slice(2);
  const cfgPath = a.find((x) => !x.startsWith('--') && !a[a.indexOf(x) - 1]?.match(/^--(etapes|compte-facturation|hebergement|mot-de-passe-admin)$/));
  if (!cfgPath) { console.error('Usage : node kit/install.mjs kit/config/<client>.json [--simulation] [--etapes a,b] [--compte-facturation ID] [--hebergement firebase|github]'); process.exit(1); }
  const opt = (n) => { const i = a.indexOf(`--${n}`); return i >= 0 ? a[i + 1] : undefined; };
  installer({ cfgPath: path.resolve(cfgPath), options: { simulation: a.includes('--simulation'), etapes: opt('etapes'), compteFacturation: opt('compte-facturation'), hebergement: opt('hebergement'), motDePasseAdmin: opt('mot-de-passe-admin') } })
    .then(({ motDePasse, aFaire }) => {
      if (motDePasse) console.log(`\n🔑 Mot de passe provisoire de l'admin (affiché une seule fois) : ${motDePasse}`);
      console.log(`\n✓ Terminé. Reste ${aFaire.length} actions manuelles : voir dist/…/INSTALLATION.md`);
    })
    .catch((e) => { console.error(`\n✗ ${e.message}\n  Corriger puis relancer : les étapes déjà faites seront sautées.`); process.exit(1); });
}
