'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// booking.js — Réservations côté serveur (lot 3 de l'audit du 20/10/2026).
//
//   createReservation (callable) : seule porte d'entrée publique pour créer
//     une réservation. Vérifie les champs, le jour et le créneau, le quota de
//     5 RDV par jour (transaction), recalcule le prix depuis tarifs.json,
//     n'accorde le code BIENVENUE10 qu'à une première réservation, et limite
//     les envois par adresse IP.
//   syncSlot (trigger) : tient la collection publique `slots` (sans données
//     personnelles) à jour à partir des réservations : création, changement
//     de date, annulation, suppression. L'id du créneau = l'id du RDV.
//   rebuildSlots (callable, admin) : reconstruit `slots` depuis les
//     réservations actives (à lancer une fois après déploiement).
// ─────────────────────────────────────────────────────────────────────────────

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentWritten }  = require('firebase-functions/v2/firestore');
const admin  = require('firebase-admin');
const crypto = require('crypto');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const TARIFS = require('./tarifs.json');

// Passer à true une fois App Check vérifié dans la console (voir TODO-MANUEL.md, S6).
const ENFORCE_APP_CHECK = false;

const REGION            = 'europe-west1';
const MAX_PAR_JOUR      = 5;
const MAX_JOURS_AVANCE  = 90;
const MAX_PAR_IP_JOUR   = 5;
const STATUTS_ACTIFS    = ['pending', 'confirmed', 'done'];

// Plages horaires : mêmes valeurs que makouez-it-rdv.html
const PLAGES = {
  matin:     ['8h00 – 10h00', '10h00 – 12h00'],
  apresmidi: ['13h00 – 15h00', '15h00 – 17h00'],
  soir:      ['17h00 – 19h00', '19h00 – 21h00'],
};

// Libellé du service (data-service de la page) → entrée de tarifs.json
const SERVICES = {
  'Dépannage PC':                      'depannagePc',
  'Installation Windows et logiciels': 'installationWindows',
  'Réseau Wi-Fi':                      'reseauWifi',
  'Récupération de données':           'recuperationDonnees',
  'Sauvegarde et sécurité':            'sauvegardeSecurite',
  'Formation et accompagnement':       'formation',
};

// Codes promo valables uniquement pour une première réservation
const PROMOS = { BIENVENUE10: 0.10 };

// ─── Utilitaires ────────────────────────────────────────────────────────────
const eur = (n) => `${Number.isInteger(n) ? n : n.toFixed(2).replace('.', ',')}€`;

function str(v, max, { required = true } = {}) {
  if (v === undefined || v === null || v === '') {
    if (required) throw new HttpsError('invalid-argument', 'Champ obligatoire manquant.');
    return '';
  }
  if (typeof v !== 'string') throw new HttpsError('invalid-argument', 'Format invalide.');
  const s = v.trim();
  if (required && !s) throw new HttpsError('invalid-argument', 'Champ obligatoire manquant.');
  if (s.length > max) throw new HttpsError('invalid-argument', 'Texte trop long.');
  return s;
}

function parisToday() {
  // AAAA-MM-JJ dans le fuseau Europe/Paris
  return new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

function plagesPourDate(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = dimanche
  const periodes = (dow === 0 || dow === 6) ? ['matin', 'apresmidi', 'soir'] : ['apresmidi', 'soir'];
  return periodes.flatMap((p) => PLAGES[p]);
}

function validerDate(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) throw new HttpsError('invalid-argument', 'Date invalide.');
  const [y, m, d] = dateKey.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    throw new HttpsError('invalid-argument', 'Date invalide.');
  }
  const today = parisToday();
  if (dateKey < today) throw new HttpsError('invalid-argument', 'Cette date est passée.');
  const [ty, tm, td] = today.split('-').map(Number);
  const ecart = (dt - Date.UTC(ty, tm - 1, td)) / 86400000;
  if (ecart > MAX_JOURS_AVANCE) throw new HttpsError('invalid-argument', `Réservation possible jusqu'à ${MAX_JOURS_AVANCE} jours à l'avance.`);
}

// Prix affiché et prix de base à partir de tarifs.json
function prixService(service) {
  const key = SERVICES[service];
  const t = key && TARIFS.services[key];
  if (!t) throw new HttpsError('invalid-argument', 'Service inconnu.');
  let affiche;
  if (t.unite === 'h') affiche = `${eur(t.prix)}/h`;
  else if (t.aPartirDe) affiche = `À partir de ${eur(t.prix)}`;
  else affiche = `${eur(t.prix)}${t.note ? ` (${t.note.toLowerCase()})` : ''}`;
  return { base: t.prix, affiche, aPartirDe: !!t.aPartirDe, unite: t.unite || null };
}

async function limiteIp(ip) {
  const day   = parisToday();
  const ipKey = crypto.createHash('sha256').update(String(ip || 'inconnue')).digest('hex').slice(0, 24);
  const ref   = db.collection('rate_limits').doc(`rdv_${ipKey}_${day}`);
  const expireAt = admin.firestore.Timestamp.fromMillis(Date.now() + 2 * 86400000);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const n = (snap.exists ? snap.data().n : 0) + 1;
    if (n > MAX_PAR_IP_JOUR) return false;
    tx.set(ref, { n, expireAt });
    return true;
  });
}

// ─── createReservation ──────────────────────────────────────────────────────
exports.createReservation = onCall(
  { region: REGION, enforceAppCheck: ENFORCE_APP_CHECK, maxInstances: 5 },
  async (request) => {
    const d = request.data || {};

    if (d.acceptCgv !== true) {
      throw new HttpsError('failed-precondition', "Merci d'accepter les conditions générales de vente.");
    }

    const service     = str(d.service, 120);
    const dateKey     = str(d.dateKey, 10);
    const timeLabel   = str(d.timeLabel, 40);
    const nom         = str(d.nom, 120);
    const telephone   = str(d.telephone, 40);
    const email       = str(d.email, 200).toLowerCase();
    const adresse     = str(d.adresse, 300);
    const description = str(d.description, 3000, { required: false });
    const promoCode   = str(d.promoCode, 40, { required: false }).toUpperCase();

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpsError('invalid-argument', 'Adresse email invalide.');
    if (!/^[+\d][\d\s.()-]{5,}$/.test(telephone)) throw new HttpsError('invalid-argument', 'Numéro de téléphone invalide.');
    validerDate(dateKey);
    if (!plagesPourDate(dateKey).includes(timeLabel)) throw new HttpsError('invalid-argument', 'Créneau indisponible ce jour-là.');

    // Compte client facultatif : l'email doit être celui du compte connecté
    let uid = null;
    if (request.auth) {
      const tokenEmail = String(request.auth.token.email || '').toLowerCase();
      if (tokenEmail && tokenEmail !== email) {
        throw new HttpsError('permission-denied', "L'email doit être celui de votre espace client.");
      }
      uid = request.auth.uid;
    }

    const ip = request.rawRequest?.headers?.['x-forwarded-for']?.toString().split(',')[0].trim() || request.rawRequest?.ip;
    if (!(await limiteIp(ip))) {
      throw new HttpsError('resource-exhausted', 'Trop de demandes aujourd’hui. Appelez le 07 45 10 38 27.');
    }

    const prix = prixService(service);

    // Promo : uniquement pour une première réservation avec cet email
    let promo = null;
    if (promoCode && PROMOS[promoCode] && prix.unite !== 'h') {
      const deja = await db.collection('reservations').where('email', '==', email).limit(1).get();
      if (deja.empty) promo = { code: promoCode, taux: PROMOS[promoCode] };
    }
    const promoDiscount = promo ? Math.round(prix.base * promo.taux * 100) / 100 : null;
    const total         = promo ? Math.round((prix.base - promoDiscount) * 100) / 100 : null;
    const price         = promo ? `${prix.aPartirDe ? 'À partir de ' : ''}${eur(total)} (−10 % ${promo.code})` : prix.affiche;

    const ref = db.collection('reservations').doc();
    await db.runTransaction(async (tx) => {
      const jour = await tx.get(db.collection('reservations').where('dateKey', '==', dateKey));
      const actifs = jour.docs.map((doc) => doc.data())
        .filter((r) => r.source !== 'noirlandmusic.com' && STATUTS_ACTIFS.includes(r.status));
      if (actifs.length >= MAX_PAR_JOUR) {
        throw new HttpsError('resource-exhausted', 'Ce jour est complet. Choisissez une autre date.');
      }
      if (actifs.some((r) => (r.timeLabel || r.time) === timeLabel)) {
        throw new HttpsError('already-exists', "Ce créneau vient d'être pris. Choisissez un autre créneau.");
      }
      const data = {
        service, dateKey, timeLabel, time: timeLabel,
        price, basePrice: prix.base,
        promoCode: promo ? promo.code : null,
        promoDiscount,
        nom, telephone, email, adresse, description,
        status: 'pending',
        cgvAccepteesLe: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: new Date().toISOString(),
        source: 'site',
      };
      if (uid) data.uid = uid;
      tx.create(ref, data);
    });

    return { id: ref.id, price, promoApplique: !!promo };
  },
);

// ─── syncSlot : collection publique `slots` dérivée des réservations ────────
exports.syncSlot = onDocumentWritten(
  { document: 'reservations/{reservationId}', region: REGION },
  async (event) => {
    const after   = event.data.after.exists ? event.data.after.data() : null;
    const slotRef = db.collection('slots').doc(event.params.reservationId);
    if (after && after.source === 'noirlandmusic.com') return null;
    if (!after || !STATUTS_ACTIFS.includes(after.status) || !after.dateKey) {
      await slotRef.delete().catch(() => null);
      return null;
    }
    await slotRef.set({ dateKey: String(after.dateKey).slice(0, 10), timeLabel: String(after.timeLabel || after.time || '').slice(0, 40) });
    return null;
  },
);

// ─── rebuildSlots : reconstruction ponctuelle (admin) ───────────────────────
exports.rebuildSlots = onCall({ region: REGION }, async (request) => {
  if (!request.auth || request.auth.token.admin !== true) {
    throw new HttpsError('permission-denied', 'Accès admin requis.');
  }
  const today = parisToday();
  const [slots, rdvs] = await Promise.all([
    db.collection('slots').get(),
    db.collection('reservations').where('dateKey', '>=', today).get(),
  ]);
  const writer = db.bulkWriter();
  slots.docs.forEach((doc) => writer.delete(doc.ref));
  let recrees = 0;
  rdvs.docs.forEach((doc) => {
    const r = doc.data();
    if (r.source === 'noirlandmusic.com' || !STATUTS_ACTIFS.includes(r.status)) return;
    writer.set(db.collection('slots').doc(doc.id), { dateKey: r.dateKey, timeLabel: r.timeLabel || r.time || '' });
    recrees++;
  });
  await writer.close();
  return { supprimes: slots.size, recrees };
});

// Exposés pour les tests
exports._test = { plagesPourDate, prixService, validerDate, parisToday };
