// Tests des fonctions du lot 3 (réservation serveur, créneaux, désinscription)
// avec une base Firestore en mémoire (l'émulateur n'étant pas disponible partout).
//   cd functions && npm ci && node ../tests/functions-lot3.test.cjs
'use strict';
const path = require('path');
const assert = require('assert');
const FN = path.join(__dirname, '..', 'functions');
const Module = require('module');

// ─── Fausse Firestore minimale ──────────────────────────────────────────────
const store = new Map(); // "col/id" -> data
let autoId = 0;
const SERVER_TS = { __ts: true };
class DocSnap { constructor(ref, data) { this.ref = ref; this.id = ref.id; this._d = data; this.exists = data !== undefined; } data() { return this._d && JSON.parse(JSON.stringify(this._d)); } get(f) { return this._d ? this._d[f] : undefined; } }
class DocRef {
  constructor(col, id) { this.col = col; this.id = id; this.path = `${col}/${id}`; }
  async get() { return new DocSnap(this, store.get(this.path)); }
  async set(d, opt) { store.set(this.path, opt && opt.merge ? { ...(store.get(this.path) || {}), ...d } : { ...d }); }
  async delete() { store.delete(this.path); }
  async update(d) { if (!store.has(this.path)) throw new Error('missing'); store.set(this.path, { ...store.get(this.path), ...d }); }
}
class Query {
  constructor(col, filters = [], lim) { this.col = col; this.filters = filters; this.lim = lim; }
  where(f, op, v) { return new Query(this.col, [...this.filters, [f, op, v]], this.lim); }
  limit(n) { return new Query(this.col, this.filters, n); }
  async get() {
    let docs = [...store.entries()].filter(([k]) => k.startsWith(this.col + '/') && k.split('/').length === 2)
      .map(([k, v]) => new DocSnap(new DocRef(this.col, k.split('/')[1]), v))
      .filter((s) => this.filters.every(([f, op, v]) => op === '==' ? s._d[f] === v : op === '>=' ? s._d[f] >= v : true));
    if (this.lim) docs = docs.slice(0, this.lim);
    return { docs, size: docs.length, empty: docs.length === 0, forEach: (fn) => docs.forEach(fn) };
  }
}
class Col extends Query { constructor(name) { super(name); this.name = name; } doc(id) { return new DocRef(this.name, id || `auto${++autoId}`); } }
const fakeDb = {
  collection: (n) => new Col(n),
  async runTransaction(fn) {
    const writes = [];
    const tx = { get: (r) => r.get(), set: (r, d) => writes.push(() => r.set(d)), create: (r, d) => { if (store.has(r.path)) throw new Error('exists'); writes.push(() => r.set(d)); } };
    const out = await fn(tx); for (const w of writes) await w(); return out;
  },
  batch() { const ops = []; return { update: (r, d) => ops.push(() => r.update(d)), commit: async () => { for (const o of ops) await o(); } }; },
  async getAll(...refs) { return Promise.all(refs.map((r) => r.get())); },
  bulkWriter() { const ops = []; return { delete: (r) => ops.push(() => r.delete()), set: (r, d) => ops.push(() => r.set(d)), close: async () => { for (const o of ops) await o(); } }; },
};
const fakeUsers = {};
const fakeAdmin = {
  apps: [1], initializeApp() {},
  auth: () => ({ getUserByEmail: async (e) => { const u = fakeUsers[e]; if (!u) throw Object.assign(new Error('nf'), { code: 'auth/user-not-found' }); return u; } }),
  firestore: Object.assign(() => fakeDb, { FieldValue: { serverTimestamp: () => SERVER_TS, increment: (n) => n }, Timestamp: { fromMillis: (ms) => ({ ms }) } }),
};
const origResolve = Module._resolveFilename;
const adminPath = require.resolve('firebase-admin', { paths: [FN] });
require.cache[adminPath] = { id: adminPath, filename: adminPath, loaded: true, exports: fakeAdmin };

const booking = require(path.join(FN, 'booking.js'));
const unsub   = require(path.join(FN, 'unsubscribe.js'));
const { parisToday } = booking._test;
const client  = require(path.join(FN, 'client.js'));

// ─── Aides ──────────────────────────────────────────────────────────────────
function addDays(n) { const [y, m, d] = parisToday().split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return t.toISOString().slice(0, 10); }
function nextWeekday(want /* 'semaine'|'weekend' */) { for (let i = 2; i < 12; i++) { const k = addDays(i); const dow = new Date(k + 'T12:00:00Z').getUTCDay(); if ((want === 'weekend') === (dow === 0 || dow === 6)) return k; } }
let ipN = 0;
const call = (data, { ip, auth } = {}) => booking.createReservation.run({ data, auth, rawRequest: { headers: { 'x-forwarded-for': ip || `10.0.0.${++ipN}` } } });
const base = (o = {}) => ({ service: 'Dépannage PC', dateKey: nextWeekday('weekend'), timeLabel: '13h00 – 15h00', nom: 'Jean Test', telephone: '06 12 34 56 78', email: `client${++ipN}@test.fr`, adresse: '1 rue X, 93380', description: '', acceptCgv: true, ...o });
async function expectErr(p, code) { try { await p; } catch (e) { assert.strictEqual(e.code, code, `attendu ${code}, reçu ${e.code} (${e.message})`); return; } assert.fail(`attendu une erreur ${code}`); }
const results = [];
async function t(name, fn) { try { await fn(); results.push(['✓', name]); } catch (e) { results.push(['✗', name + ' → ' + e.message]); } }

(async () => {
  await t('réservation valide : prix recalculé, champs forgés ignorés', async () => {
    const r = await call({ ...base(), price: '1€', status: 'confirmed', basePrice: 1 });
    const d = store.get(`reservations/${r.id}`);
    assert.strictEqual(d.price, 'À partir de 55€'); assert.strictEqual(d.basePrice, 55); assert.strictEqual(d.status, 'pending');
  });
  await t('quota : 6e réservation du même jour refusée', async () => {
    const day = nextWeekday('weekend');
    const plages = ['8h00 – 10h00', '10h00 – 12h00', '13h00 – 15h00', '15h00 – 17h00', '17h00 – 19h00'];
    for (const p of plages) store.set(`reservations/q${p}`, { dateKey: day, timeLabel: p, status: 'confirmed' });
    await expectErr(call(base({ dateKey: day, timeLabel: '19h00 – 21h00' })), 'resource-exhausted');
  });
  await t('réservations annulées et Noirland non comptées dans le quota', async () => {
    const day = addDays(20);
    const wk = nextWeekday('weekend'); // jour quelconque de week-end différent
    const d2 = (() => { for (let i = 30; i < 40; i++) { const k = addDays(i); const w = new Date(k + 'T12:00:00Z').getUTCDay(); if (w === 0 || w === 6) return k; } })();
    for (let i = 0; i < 5; i++) store.set(`reservations/c${i}`, { dateKey: d2, timeLabel: 'x' + i, status: i < 3 ? 'cancelled' : 'pending', source: i === 3 ? 'noirlandmusic.com' : undefined });
    const r = await call(base({ dateKey: d2, timeLabel: '8h00 – 10h00' }));
    assert.ok(r.id);
  });
  await t('créneau déjà pris refusé', async () => {
    const day = (() => { for (let i = 41; i < 50; i++) { const k = addDays(i); const w = new Date(k + 'T12:00:00Z').getUTCDay(); if (w === 0 || w === 6) return k; } })();
    await call(base({ dateKey: day, timeLabel: '15h00 – 17h00' }));
    await expectErr(call(base({ dateKey: day, timeLabel: '15h00 – 17h00' })), 'already-exists');
  });
  await t('matin en semaine refusé', () => expectErr(call(base({ dateKey: nextWeekday('semaine'), timeLabel: '8h00 – 10h00' })), 'invalid-argument'));
  await t('date passée refusée', () => expectErr(call(base({ dateKey: addDays(-1) })), 'invalid-argument'));
  await t('date à plus de 90 jours refusée', () => expectErr(call(base({ dateKey: addDays(120) })), 'invalid-argument'));
  await t('date impossible (31/02) refusée', () => expectErr(call(base({ dateKey: '2027-02-31' })), 'invalid-argument'));
  await t('service inconnu refusé', () => expectErr(call(base({ service: 'Piratage' })), 'invalid-argument'));
  await t('chaque carte de la page de réservation correspond à un service connu du serveur', () => {
    const html = require('fs').readFileSync(path.join(__dirname, '..', 'makouez-it-rdv.html'), 'utf8');
    const cartes = [...html.matchAll(/class="service-card" data-service="([^"]+)" data-price="([^"]+)"/g)];
    assert.ok(cartes.length >= 1, 'aucune carte trouvée');
    for (const [, svc, prix] of cartes) assert.strictEqual(booking._test.prixService(svc).affiche, prix.replace(/&amp;/g, '&'), svc);
  });
  await t('CGV non acceptées refusées', () => expectErr(call(base({ acceptCgv: false })), 'failed-precondition'));
  await t('BIENVENUE10 : 1re réservation seulement', async () => {
    const email = 'promo@test.fr';
    const day = (() => { for (let i = 51; i < 60; i++) { const k = addDays(i); const w = new Date(k + 'T12:00:00Z').getUTCDay(); if (w === 0 || w === 6) return k; } })();
    const r1 = await call(base({ email, promoCode: 'bienvenue10', dateKey: day, timeLabel: '8h00 – 10h00', service: 'Récupération de données' }));
    assert.strictEqual(r1.promoApplique, true); assert.strictEqual(store.get(`reservations/${r1.id}`).promoDiscount, 8.9);
    const r2 = await call(base({ email, promoCode: 'BIENVENUE10', dateKey: day, timeLabel: '10h00 – 12h00' }));
    assert.strictEqual(r2.promoApplique, false);
  });
  await t('formation : 40€/h, pas de promo', async () => {
    const r = await call(base({ service: 'Formation et accompagnement', promoCode: 'BIENVENUE10', dateKey: addDays(91 - 1), timeLabel: '17h00 – 19h00' }));
    assert.strictEqual(store.get(`reservations/${r.id}`).price, '40€/h'); assert.strictEqual(r.promoApplique, false);
  });
  await t('limite de 5 demandes par IP et par jour', async () => {
    const days = []; for (let i = 61; days.length < 6 && i < 90; i++) { const k = addDays(i); const w = new Date(k + 'T12:00:00Z').getUTCDay(); if (w === 0 || w === 6) days.push(k); }
    for (let i = 0; i < 5; i++) await call(base({ dateKey: days[i] }), { ip: '9.9.9.9' });
    await expectErr(call(base({ dateKey: days[5] }), { ip: '9.9.9.9' }), 'resource-exhausted');
  });
  await t("compte connecté : l'email doit être celui du compte", () => expectErr(call(base({ timeLabel: '19h00 – 21h00' }), { auth: { uid: 'u1', token: { email: 'autre@test.fr' } } }), 'permission-denied'));
  await t('syncSlot : création, changement de date, annulation, suppression', async () => {
    const ev = (before, after) => ({ params: { reservationId: 'S1' }, data: { before: { exists: !!before, data: () => before }, after: { exists: !!after, data: () => after } } });
    await booking.syncSlot.run(ev(null, { dateKey: '2030-01-05', timeLabel: '8h00 – 10h00', status: 'pending' }));
    assert.deepStrictEqual(store.get('slots/S1'), { dateKey: '2030-01-05', timeLabel: '8h00 – 10h00' });
    await booking.syncSlot.run(ev({}, { dateKey: '2030-01-06', timeLabel: '13h00 – 15h00', status: 'pending' }));
    assert.strictEqual(store.get('slots/S1').dateKey, '2030-01-06');
    await booking.syncSlot.run(ev({}, { dateKey: '2030-01-06', timeLabel: '13h00 – 15h00', status: 'cancelled' }));
    assert.ok(!store.has('slots/S1'));
    await booking.syncSlot.run(ev({}, { dateKey: '2030-01-06', timeLabel: '13h00 – 15h00', status: 'confirmed' }));
    await booking.syncSlot.run(ev({}, null));
    assert.ok(!store.has('slots/S1'));
  });
  await t('rebuildSlots réservé à l’admin', () => expectErr(booking.rebuildSlots.run({ auth: { uid: 'x', token: {} }, data: {} }), 'permission-denied'));

  // ─── Désinscription ───
  const res = () => { const r = { headers: {}, code: 200, body: '' }; r.set = (k, v) => { r.headers[k] = v; return r; }; r.status = (c) => { r.code = c; return r; }; r.send = (b) => { r.body = b; return r; }; return r; };
  const handler = unsub.functions.unsubscribe;
  await t('désinscription : lien falsifié refusé', async () => {
    const url = new URL(await unsub.unsubscribeUrl('a@test.fr'));
    const r = res(); await handler({ method: 'GET', query: { e: url.searchParams.get('e'), t: '0'.repeat(32) } }, r);
    assert.strictEqual(r.code, 400);
  });
  await t('désinscription : GET affiche une confirmation sans désinscrire', async () => {
    const url = new URL(await unsub.unsubscribeUrl('a@test.fr'));
    const r = res(); await handler({ method: 'GET', query: Object.fromEntries(url.searchParams) }, r);
    assert.strictEqual(r.code, 200); assert.ok(/Confirmer la désinscription/.test(r.body)); assert.strictEqual((await unsub.unsubscribedAmong(['a@test.fr'])).size, 0);
  });
  await t('désinscription : POST (un clic) enregistre, puis exclusion des envois', async () => {
    const url = new URL(await unsub.unsubscribeUrl('A@Test.fr '));
    const r = res(); await handler({ method: 'POST', query: Object.fromEntries(url.searchParams), body: { 'List-Unsubscribe': 'One-Click' } }, r);
    assert.strictEqual(r.code, 200);
    const set = await unsub.unsubscribedAmong(['a@test.fr', 'b@test.fr']);
    assert.ok(set.has('a@test.fr') && !set.has('b@test.fr'));
    const parts = await unsub.unsubscribeParts('b@test.fr');
    assert.ok(parts.headers['List-Unsubscribe-Post'] === 'List-Unsubscribe=One-Click' && /unsubscribe\?e=/.test(parts.footerHtml));
  });

  // ─── Espace client (21/10/2026) ─────────────────────────────────────────
  await t('espace client : rattachement refusé tant que l’email n’est pas confirmé', async () => {
    await expectErr(client.linkMyAccount.run({ data: {}, auth: { uid: 'u9', token: { email: 'x@test.fr', email_verified: false } } }), 'failed-precondition');
    await expectErr(client.linkMyAccount.run({ data: {} }), 'unauthenticated');
  });
  await t('espace client : rattache RDV, contrats et factures de la même adresse, pas ceux d’un autre compte', async () => {
    store.set('reservations/L1', { email: 'jean@link.fr', status: 'pending' });
    store.set('reservations/L2', { email: 'jean@link.fr', status: 'done', uid: 'autre' });
    store.set('contrats/L3', { email: 'jean@link.fr', status: 'new' });
    store.set('factures/L4', { clientEmailLc: 'jean@link.fr', numero: 'F1' });
    store.set('contrats/L5', { email: 'autre@link.fr', status: 'new' });
    const r = await client.linkMyAccount.run({ data: {}, auth: { uid: 'u1', token: { email: 'Jean@Link.fr', email_verified: true } } });
    assert.deepStrictEqual(r.linked, { reservations: 1, contrats: 1, factures: 1 });
    assert.strictEqual(store.get('reservations/L1').uid, 'u1');
    assert.strictEqual(store.get('reservations/L2').uid, 'autre');
    assert.strictEqual(store.get('contrats/L3').uid, 'u1');
    assert.strictEqual(store.get('factures/L4').clientUid, 'u1');
    assert.ok(!store.get('contrats/L5').uid);
  });
  await t('espace client : nouvelle demande reliée automatiquement si un compte confirmé existe', async () => {
    fakeUsers['ok@link.fr'] = { uid: 'u2', emailVerified: true };
    fakeUsers['nonconf@link.fr'] = { uid: 'u3', emailVerified: false };
    store.set('contrats/A1', { email: 'OK@link.fr' }); store.set('contrats/A2', { email: 'nonconf@link.fr' }); store.set('contrats/A3', { email: 'inconnu@link.fr' });
    for (const id of ['A1', 'A2', 'A3']) await client._test.autoLink(await new (fakeDb.collection('contrats').doc(id).constructor)('contrats', id).get(), 'contrats');
    assert.strictEqual(store.get('contrats/A1').uid, 'u2'); assert.ok(!store.get('contrats/A2').uid); assert.ok(!store.get('contrats/A3').uid);
  });
  await t('espace client : préférence emails d’information (désinscription / réinscription)', async () => {
    const auth = { uid: 'u1', token: { email: 'pref@link.fr', email_verified: true } };
    await client.setMarketingPreference.run({ data: { accepte: false }, auth });
    assert.strictEqual((await client.getMarketingPreference.run({ data: {}, auth })).accepte, false);
    assert.ok((await unsub.unsubscribedAmong(['pref@link.fr'])).has('pref@link.fr'));
    await client.setMarketingPreference.run({ data: { accepte: true }, auth });
    assert.strictEqual((await client.getMarketingPreference.run({ data: {}, auth })).accepte, true);
  });

  results.forEach(([s, n]) => console.log(`${s} ${n}`));
  const ko = results.filter(([s]) => s === '✗').length;
  console.log(ko ? `\n${ko} test(s) en échec` : `\n${results.length} tests réussis`);
  process.exit(ko ? 1 : 0);
})();
