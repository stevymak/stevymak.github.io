// Tests des règles Firestore — rejoue les payloads RÉELS du site.
// Lancer : cd tests && npm install && npm test   (émulateur, aucune donnée de prod touchée)
import { test, before, after, beforeEach } from 'node:test';
import fs from 'node:fs';
import {
  initializeTestEnvironment, assertSucceeds, assertFails,
} from '@firebase/rules-unit-testing';
import {
  collection, addDoc, doc, getDoc, getDocs, updateDoc, setDoc, query, where, serverTimestamp,
} from 'firebase/firestore';

let env;
const now = () => new Date().toISOString();

before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-makouez',
    firestore: { rules: fs.readFileSync('../firestore.rules', 'utf8') },
  });
});
after(async () => { await env.cleanup(); });
beforeEach(async () => { await env.clearFirestore(); });

const anon   = () => env.unauthenticatedContext().firestore();
const client = (uid = 'u1', email = 'client@test.fr', verified = true) =>
  env.authenticatedContext(uid, { email, email_verified: verified }).firestore();
const admin  = () => env.authenticatedContext('adm', { email: 's.makouezi@gmail.com', email_verified: true, admin: true }).firestore();

// Payload identique à makouez-it-rdv.html (ligne ~990)
const resa = (extra = {}) => ({
  service: 'Dépannage PC', dateKey: '2026-11-20', timeLabel: '14:00', time: '14:00',
  price: '55 €', basePrice: '55 €', promoCode: null, promoDiscount: null,
  nom: 'Test Audit', telephone: '0600000000', email: 'client@test.fr',
  adresse: '1 rue Test, 93000 Saint-Denis', description: '',
  status: 'pending', createdAt: now(), ...extra,
});

// 1. Réservation sans compte
test('1a réservation sans compte (anonyme) : OK', async () => {
  await assertSucceeds(addDoc(collection(anon(), 'reservations'), resa()));
});
test('1b réservation anonyme avec description vide / promo : OK', async () => {
  await assertSucceeds(addDoc(collection(anon(), 'reservations'),
    resa({ promoCode: 'BIENVENUE', promoDiscount: 5.5, description: 'PC lent' })));
});
test('1c réservation anonyme ne peut pas se mettre confirmée', async () => {
  await assertFails(addDoc(collection(anon(), 'reservations'), resa({ status: 'confirmed' })));
});
test('1d champ inconnu refusé', async () => {
  await assertFails(addDoc(collection(anon(), 'reservations'), resa({ isAdmin: true })));
});
test('1e anonyme ne peut pas LIRE les réservations', async () => {
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'reservations/r1'), resa({ uid: 'u1' })));
  await assertFails(getDocs(collection(anon(), 'reservations')));
});
test('1f réservation avec compte (uid + email identique au jeton) : OK', async () => {
  await assertSucceeds(addDoc(collection(client(), 'reservations'), resa({ uid: 'u1' })));
});
test('1g email en MAJUSCULES refusé (le site met déjà l’email en minuscules, ligne 940)', async () => {
  await assertFails(addDoc(collection(client(), 'reservations'), resa({ uid: 'u1', email: 'Client@Test.fr' })));
});
test('1h usurpation d’uid refusée', async () => {
  await assertFails(addDoc(collection(client('u1'), 'reservations'), resa({ uid: 'autre' })));
});

// 2. Calendrier (slots)
test('2a calendrier : lecture publique des créneaux par mois', async () => {
  await assertSucceeds(getDocs(query(collection(anon(), 'slots'),
    where('dateKey', '>=', '2026-11-01'), where('dateKey', '<=', '2026-11-31'))));
});
test('2b calendrier : lecture publique des créneaux d’un jour', async () => {
  await assertSucceeds(getDocs(query(collection(anon(), 'slots'), where('dateKey', '==', '2026-11-20'))));
});
test('2c création d’un créneau pris après réservation : OK', async () => {
  await assertSucceeds(addDoc(collection(anon(), 'slots'), { dateKey: '2026-11-20', timeLabel: '14:00' }));
});
test('2d créneau avec données personnelles refusé', async () => {
  await assertFails(addDoc(collection(anon(), 'slots'), { dateKey: '2026-11-20', timeLabel: '14:00', nom: 'X' }));
});
test('2e anonyme ne peut ni modifier ni supprimer un créneau', async () => {
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'slots/s1'), { dateKey: '2026-11-20', timeLabel: '14:00' }));
  await assertFails(updateDoc(doc(anon(), 'slots/s1'), { timeLabel: '15:00' }));
});

// 3 & 4. Contrats
const contrat = (id, extra = {}) => ({
  contrat: id, nom: 'Test Audit', email: 'client@test.fr', telephone: '0600000000',
  adresse: '1 rue Test', note: '', status: 'new', createdAt: serverTimestamp(), ...extra,
});
test('3a contrat Découverte sans compte : OK', async () => {
  await assertSucceeds(addDoc(collection(anon(), 'contrats'), contrat('decouverte')));
});
test('3b contrat Découverte avec compte : OK', async () => {
  await assertSucceeds(addDoc(collection(client(), 'contrats'), contrat('decouverte', { uid: 'u1' })));
});
test('3c contrat avec identifiant inconnu refusé', async () => {
  await assertFails(addDoc(collection(anon(), 'contrats'), contrat('gratuit-a-vie')));
});
test('3d statut déjà « actif » refusé', async () => {
  await assertFails(addDoc(collection(anon(), 'contrats'), contrat('decouverte', { status: 'active' })));
});
test('4a contrat Pro (payload contrats-pro.html) : OK', async () => {
  await assertSucceeds(addDoc(collection(anon(), 'contrats'), {
    contrat: 'pro-essentiel', type: 'pro', societe: 'ACME SARL', nom: 'Jean Test',
    email: 'pro@test.fr', telephone: '0600000000', adresse: '2 av. Test', note: null,
    status: 'new', createdAt: serverTimestamp(),
  }));
});
test('4b toutes les formules du site sont acceptées', async () => {
  for (const id of ['serenite','senior','famille','pro-ponctuel','pro-essentiel','pro-confort','pro-premium',
                    'maintenance-essentielle','maintenance-pro','maintenance-evolution']) {
    await assertSucceeds(addDoc(collection(anon(), 'contrats'), contrat(id)));
  }
});
test('4c un client ne lit pas le contrat d’un autre', async () => {
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'contrats/c1'),
    { ...contrat('decouverte'), createdAt: now(), uid: 'u1', email: 'a@a.fr' }));
  await assertFails(getDoc(doc(client('u2', 'b@b.fr'), 'contrats/c1')));
  await assertSucceeds(getDoc(doc(client('u1', 'a@a.fr'), 'contrats/c1')));
});
test('4d lecture par email NON vérifié refusée', async () => {
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'contrats/c2'),
    { ...contrat('decouverte'), createdAt: now(), email: 'victime@x.fr' }));
  await assertFails(getDoc(doc(client('pirate', 'victime@x.fr', false), 'contrats/c2')));
});

// 5. Devis web
test('5a devis web (payload du site) : OK', async () => {
  await assertSucceeds(addDoc(collection(anon(), 'devis_web'), {
    type: 'Site vitrine', description: 'Besoin d’un site', budget: '–', delai: '–',
    nom: 'Test Audit', email: 'client@test.fr', telephone: '', createdAt: now(),
  }));
});
test('5b devis sans champ obligatoire refusé', async () => {
  await assertFails(addDoc(collection(anon(), 'devis_web'), { type: 'x', nom: 'y' }));
});
test('5c anonyme ne lit pas les devis', async () => {
  await assertFails(getDocs(collection(anon(), 'devis_web')));
});

// 6. Avis
test('6a avis (payload index.html) : OK', async () => {
  await assertSucceeds(addDoc(collection(anon(), 'avis_en_attente'), {
    nom: 'Marie T.', comment: 'Très bien', note: 5, createdAt: serverTimestamp(), statut: 'en_attente',
  }));
});
test('6b avis publié directement refusé', async () => {
  await assertFails(addDoc(collection(anon(), 'avis'), { nom: 'x', comment: 'y', note: 5 }));
});
test('6c note hors bornes refusée', async () => {
  await assertFails(addDoc(collection(anon(), 'avis_en_attente'), {
    nom: 'x', comment: 'y', note: 9, createdAt: serverTimestamp(), statut: 'en_attente' }));
});
test('6d avis approuvés lisibles par tous, modération réservée à l’admin', async () => {
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'avis/a1'), { nom: 'x', comment: 'y', note: 5 }));
  await assertSucceeds(getDoc(doc(anon(), 'avis/a1')));
  await assertSucceeds(setDoc(doc(admin(), 'avis/a2'), { nom: 'x', comment: 'y', note: 5 }));
});

// 7. Annulation
test('7a le client annule sa réservation en attente : OK', async () => {
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'reservations/r1'), resa({ uid: 'u1' })));
  await assertSucceeds(updateDoc(doc(client('u1'), 'reservations/r1'), { status: 'cancelled' }));
});
test('7b le client ne peut pas annuler la réservation d’un autre', async () => {
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'reservations/r1'), resa({ uid: 'u1' })));
  await assertFails(updateDoc(doc(client('u2', 'b@b.fr'), 'reservations/r1'), { status: 'cancelled' }));
});
test('7c le client ne peut pas se confirmer lui-même ni changer le prix', async () => {
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'reservations/r1'), resa({ uid: 'u1' })));
  await assertFails(updateDoc(doc(client('u1'), 'reservations/r1'), { status: 'done' }));
  await assertFails(updateDoc(doc(client('u1'), 'reservations/r1'), { price: '1 €' }));
});
test('7d réservation terminée non modifiable par le client', async () => {
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'reservations/r1'), resa({ uid: 'u1', status: 'done' })));
  await assertFails(updateDoc(doc(client('u1'), 'reservations/r1'), { status: 'cancelled' }));
});

// 8. Admin
test('8a admin lit tout, client ne lit pas les factures', async () => {
  await env.withSecurityRulesDisabled(c => setDoc(doc(c.firestore(), 'factures/f1'), { total: 1 }));
  await assertSucceeds(getDoc(doc(admin(), 'factures/f1')));
  await assertFails(getDoc(doc(client(), 'factures/f1')));
  await assertFails(getDoc(doc(anon(), 'factures/f1')));
});
test('8b compte connecté SANS claim admin n’est pas admin', async () => {
  await assertFails(getDocs(collection(client('u9', 's.makouezi@gmail.com'), 'reservations')));
});
test('8c collection inconnue : refus par défaut', async () => {
  await assertFails(addDoc(collection(anon(), 'nimporte_quoi'), { a: 1 }));
});
