// Test de kit/install.mjs sans Google Cloud : un faux « gcloud / firebase / npm »
// et une fausse API Identity Toolkit gardent l'état d'un projet en mémoire.
//   node tests/kit-install.test.mjs
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { installer, fonctionsPubliquesV2, lireSdkConfig, domainesAutorises, configAuth, ETAPES } from '../kit/install.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SP = fs.mkdtempSync(path.join(ROOT, 'dist', '.test-install-'));
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'kit/config/demo-garnier-plomberie.json'), 'utf8'));
cfg.slug = 'test-install'; cfg.firebase.projectId = 'test-install-demo';
const cfgPath = path.join(SP, 'client.json');
fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
const OUT = path.join(ROOT, 'dist', 'test-install');

const res = [];
const t = async (nom, fn) => { try { await fn(); res.push(`✓ ${nom}`); } catch (e) { res.push(`✗ ${nom} → ${e.message}`); } };

// ─── Faux projet Google Cloud ───────────────────────────────────────────────
const G = { projets: new Set(), facturation: false, apis: new Set(), firestore: null, ttl: false, apps: [], secrets: {}, deploys: 0,
  echecsDeploy: 1, iam: new Set(), users: [], authConfig: { authorizedDomains: ['localhost', 'ancien.example'] }, idp: false, hosting: 0, cmds: [] };
const run = async (c, args, opts = {}) => {
  const a = args.join(' ');
  G.cmds.push(`${c} ${a}`);
  const fail = (m) => { const e = new Error(m); e.stderr = m; throw e; };
  if (c === 'node' || c === process.execPath) {
    if (args[0]?.endsWith('build.mjs')) return execFileSync(process.execPath, args, { cwd: ROOT }).toString();
    return 'v22.0.0';
  }
  if (c === 'npm') return '';
  if (c === 'gcloud') {
    if (a === '--version' ) return 'Google Cloud SDK 500';
    if (a.startsWith('auth list')) return 'test@example.com\n';
    if (a.startsWith('auth print-access-token')) return 'jeton\n';
    if (a.startsWith('billing projects describe')) return G.facturation ? 'True\n' : 'False\n';
    if (a.startsWith('billing projects link')) { G.facturation = true; return ''; }
    if (a.startsWith('services enable')) { args.slice(2).filter((x) => !x.startsWith('--')).forEach((x) => G.apis.add(x)); return ''; }
    if (a.startsWith('firestore databases describe')) return G.firestore ? `${G.firestore}\n` : fail('NOT_FOUND');
    if (a.startsWith('firestore databases create')) { G.firestore = args.find((x) => x.startsWith('--location=')).split('=')[1]; return ''; }
    if (a.startsWith('firestore fields ttls update')) { G.ttl = true; return ''; }
    if (a.startsWith('secrets describe')) return G.secrets[args[2]] ? `projects/x/secrets/${args[2]}\n` : fail('NOT_FOUND');
    if (a.startsWith('run services get-iam-policy')) return G.iam.has(args[3]) ? '{"bindings":[{"members":["allUsers"],"role":"roles/run.invoker"}]}' : '{}';
    if (a.startsWith('run services add-iam-policy-binding')) { G.iam.add(args[3]); return ''; }
  }
  if (c === 'firebase') {
    if (a === '--version') return '15.0.0';
    if (a.startsWith('login:list')) return JSON.stringify({ status: 'success', result: [{ user: { email: 'test@example.com' } }] });
    if (a.startsWith('projects:list')) return JSON.stringify({ result: [...G.projets].map((projectId) => ({ projectId })) });
    if (a.startsWith('projects:create')) { G.projets.add(args[1]); return ''; }
    if (a.startsWith('apps:list')) return JSON.stringify({ result: G.apps });
    if (a.startsWith('apps:create')) { const app = { appId: '1:123:web:abc', platform: 'WEB' }; G.apps.push(app); return JSON.stringify({ result: app }); }
    if (a.startsWith('apps:sdkconfig')) return JSON.stringify({ status: 'success', result: { fileName: 'firebase-config.json', fileContents: JSON.stringify({ projectId: 'test-install-demo', appId: '1:123:web:abc', apiKey: 'AIzaTEST', messagingSenderId: '123' }) } });
    if (a.startsWith('functions:secrets:set')) { G.secrets[args[1]] = opts.entree; return ''; }
    if (a.startsWith('deploy --only functions')) { if (G.echecsDeploy-- > 0) fail('Permission denied while using the Eventarc Service Agent'); G.deploys++; return ''; }
    if (a.startsWith('deploy --only hosting')) { G.hosting++; return ''; }
  }
  throw new Error(`commande inattendue : ${c} ${a}`);
};
const http = async (url, { method, body }) => {
  const b = body ? JSON.parse(body) : null;
  const rep = (status, d) => ({ ok: status < 300, status, text: async () => JSON.stringify(d) });
  if (url.includes('identityPlatform:initializeAuth')) { if (G.idp) return rep(400, { error: { message: 'INVALID_PROJECT_ID' } }); G.idp = true; G.authConfig.subtype = 'IDENTITY_PLATFORM'; return rep(200, {}); }
  if (url.includes('/admin/v2/') && method === 'GET') return rep(200, G.authConfig);
  if (url.includes('/admin/v2/') && method === 'PATCH') { G.authConfig = { ...G.authConfig, ...b, mask: url.split('updateMask=')[1] }; return rep(200, G.authConfig); }
  if (url.endsWith('/accounts:lookup')) return rep(200, { users: G.users.filter((u) => b.email.includes(u.email)) });
  if (url.endsWith('/accounts')) { const u = { localId: `uid${G.users.length + 1}`, email: b.email, emailVerified: b.emailVerified, password: b.password }; G.users.push(u); return rep(200, u); }
  if (url.endsWith('/accounts:update')) { Object.assign(G.users.find((u) => u.localId === b.localId), { customAttributes: b.customAttributes }); return rep(200, {}); }
  return rep(404, { error: { message: `inattendu ${url}` } });
};
const logs = [];
const opts = { cfgPath, run, http, log: (m) => logs.push(m), attendre: async () => {}, demanderSecret: async () => '' };

await t('utilitaires : sdkconfig (nouveau et ancien format), domaines, configuration Auth', () => {
  assert.strictEqual(lireSdkConfig({ result: { sdkConfig: { apiKey: 'k' } } }).apiKey, 'k');
  assert.strictEqual(lireSdkConfig(JSON.stringify({ result: { fileContents: '{"apiKey":"k2","appId":"a"}' } })).apiKey, 'k2');
  assert.strictEqual(lireSdkConfig({ result: { fileContents: 'firebase.initializeApp({\n  "apiKey": "k3",\n  "appId": "a3"\n});' } }).apiKey, 'k3');
  const d = domainesAutorises(['localhost', 'x.example'], 'p1', 'client.fr');
  assert.deepStrictEqual(d, ['localhost', 'x.example', 'p1.firebaseapp.com', 'p1.web.app', 'client.fr', 'www.client.fr']);
  const c = configAuth(d);
  assert.strictEqual(c.signIn.email.passwordRequired, false);
  assert.strictEqual(c.mfa.providerConfigs[0].totpProviderConfig.adjacentIntervals, 5);
  assert.strictEqual(c.notification.defaultLocale, 'fr');
});

await t('refus : projet de makouezit.org, identifiant invalide', async () => {
  for (const pid of ['makouez-it', 'Mauvais_ID']) {
    const c2 = { ...cfg, firebase: { ...cfg.firebase, projectId: pid } };
    const p2 = path.join(SP, `c-${pid}.json`); fs.writeFileSync(p2, JSON.stringify(c2));
    await assert.rejects(installer({ ...opts, cfgPath: p2 }));
  }
});

await t('sans facturation ni clé Resend : arrêt clair à la bonne étape', async () => {
  await assert.rejects(installer(opts), /facturation inactive/);
  assert.ok(G.projets.has('test-install-demo'));
});

let premier;
await t('installation complète (compte de facturation fourni, 1er déploiement en échec puis réessayé)', async () => {
  process.env.RESEND_API_KEY = 're_test_123';
  premier = await installer({ ...opts, options: { compteFacturation: '000000-000000-000000' } });
  delete process.env.RESEND_API_KEY;
  assert.ok(G.facturation && G.firestore === 'europe-west1' && G.ttl);
  assert.ok(G.apis.has('identitytoolkit.googleapis.com') && G.apis.has('eventarc.googleapis.com'));
  // clés web reportées dans la configuration, et dans le site régénéré
  const c = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  assert.strictEqual(c.firebase.apiKey, 'AIzaTEST');
  assert.ok(fs.readFileSync(path.join(OUT, 'index.html'), 'utf8').includes('AIzaTEST') || fs.readFileSync(path.join(OUT, 'mon-rdv.html'), 'utf8').includes('AIzaTEST'));
  // Auth
  assert.ok(G.idp);
  assert.ok(G.authConfig.authorizedDomains.includes('ancien.example') && G.authConfig.authorizedDomains.includes('garnier-plomberie.example'));
  assert.strictEqual(G.authConfig.mfa.state, 'ENABLED');
  // secrets : Resend réel, Places provisoire, pas d'Anthropic (chat non souscrit)
  assert.strictEqual(G.secrets.RESEND_API_KEY, 're_test_123');
  assert.strictEqual(G.secrets.PLACES_API_KEY, 'non-configure');
  assert.ok(!('ANTHROPIC_API_KEY' in G.secrets));
  assert.strictEqual(G.deploys, 1);
  assert.ok(!G.cmds.some((x) => x.startsWith('firebase deploy') && x.includes('--force')), 'déploiement sans --force');
  // invocation publique : exactement les fonctions appelables du site généré
  assert.deepStrictEqual([...G.iam].sort(), fonctionsPubliquesV2(path.join(OUT, 'functions')).map((n) => n.toLowerCase()).sort());
  assert.ok(G.iam.has('createreservation') && !G.iam.has('claudeproxy') && ![...G.iam].some((x) => x.startsWith('noirland')));
  // admin : compte vérifié + claim admin, mot de passe provisoire rendu une fois
  assert.strictEqual(G.users.length, 1);
  assert.deepStrictEqual(JSON.parse(G.users[0].customAttributes), { admin: true });
  assert.ok(G.users[0].emailVerified && premier.motDePasse && premier.motDePasse === G.users[0].password);
  assert.strictEqual(G.hosting, 1);
  assert.ok(JSON.parse(fs.readFileSync(path.join(OUT, 'firebase.json'), 'utf8')).hosting.ignore.includes('functions/**'));
  const r = fs.readFileSync(path.join(OUT, 'INSTALLATION.md'), 'utf8');
  assert.ok(r.includes('Resend') && r.includes('PLACES_API_KEY') && !r.includes(premier.motDePasse), 'rapport sans mot de passe');
});

await t('relance : tout est reconnu comme déjà fait, rien n’est recréé', async () => {
  const avant = { users: G.users.length, apps: G.apps.length, iam: G.iam.size };
  G.cmds = [];
  const r = await installer({ ...opts, options: { etapes: ETAPES.filter((e) => !['generation', 'deploiement', 'hebergement'].includes(e)).join(',') } });
  assert.strictEqual(G.users.length, avant.users); assert.strictEqual(G.apps.length, avant.apps); assert.strictEqual(G.iam.size, avant.iam);
  assert.ok(!r.motDePasse);
  assert.ok(!G.cmds.some((x) => /projects:create|billing projects link|databases create|apps:create|secrets:set|add-iam-policy-binding/.test(x)), G.cmds.join('\n'));
  for (const e of ['projet', 'facturation', 'appweb', 'admin', 'invocateurs']) assert.ok(r.journal.some(([n, s]) => n === e && s === 'deja'), `${e} déjà fait`);
});

await t('déploiement : un projet qui contient d’autres fonctions n’est jamais nettoyé', async () => {
  const run2 = async (c, args, o) => { if (c === 'firebase' && args[0] === 'deploy' && args[2].startsWith('functions')) { const e = new Error('x'); e.stderr = 'The following functions are found in your project but do not exist in your local source code: noirlandFoo. Would you like to proceed with deletion? Selecting no will continue the rest of the deployments. Aborting because deletion cannot proceed in non-interactive mode. These functions would be deleted'; throw e; } return run(c, args, o); };
  await assert.rejects(installer({ ...opts, run: run2, options: { etapes: 'deploiement' } }), /absentes du site généré/);
});

fs.rmSync(SP, { recursive: true, force: true });
fs.rmSync(OUT, { recursive: true, force: true });
console.log(res.join('\n'));
const ko = res.filter((x) => x.startsWith('✗')).length;
console.log(ko ? `\n${ko} test(s) en échec` : `\n${res.length} tests réussis`);
process.exit(ko ? 1 : 0);
