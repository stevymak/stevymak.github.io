'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// client.js — Espace client (21/10/2026).
//
//   linkMyAccount (callable) : rattache au compte connecté toutes les demandes
//     faites avec la même adresse email (réservations, contrats, factures),
//     y compris celles envoyées sans compte ou avant la création du compte.
//     Exige une adresse email VÉRIFIÉE : sinon n'importe qui pourrait créer un
//     compte avec l'adresse d'un tiers et récupérer ses données.
//   autoLinkReservation / autoLinkContrat (triggers) : à la création d'une
//     demande sans compte, la rattache tout de suite si un compte vérifié
//     existe déjà avec cette adresse.
//   setMarketingPreference (callable) : le client choisit depuis son profil de
//     recevoir ou non les emails d'information et d'offres (même registre que
//     le lien de désinscription des emails).
// ─────────────────────────────────────────────────────────────────────────────

const { onCall, HttpsError }  = require('firebase-functions/v2/https');
const { onDocumentCreated }   = require('firebase-functions/v2/firestore');
const { defineSecret }        = require('firebase-functions/params');
const { Resend }              = require('resend');
const admin = require('firebase-admin');
const { hashId } = require('./unsubscribe');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const REGION = 'europe-west1';
const RESEND_API_KEY = defineSecret('RESEND_API_KEY');
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (e) => String(e || '').trim().toLowerCase();

function verifiedEmail(request) {
  if (!request.auth) throw new HttpsError('unauthenticated', 'Connectez-vous à votre espace client.');
  const t = request.auth.token || {};
  if (!t.email || t.email_verified !== true) {
    throw new HttpsError('failed-precondition', 'Confirmez d’abord votre adresse email (lien reçu par email).');
  }
  return norm(t.email);
}

// Rattache les documents d'une collection dont le champ email correspond.
async function linkCollection(collection, field, email, uid, uidField) {
  const variantes = [...new Set([email, email.toLowerCase()])];
  let n = 0;
  for (const v of variantes) {
    const snap = await db.collection(collection).where(field, '==', v).get();
    let batch = db.batch(); let k = 0;
    for (const d of snap.docs) {
      const cur = d.get(uidField);
      if (cur === uid) continue;
      if (cur && cur !== uid) continue; // déjà rattaché à un autre compte : on ne touche pas
      batch.update(d.ref, { [uidField]: uid, linkedAt: admin.firestore.FieldValue.serverTimestamp() });
      n++; k++;
      if (k === 400) { await batch.commit(); batch = db.batch(); k = 0; }
    }
    if (k) await batch.commit();
  }
  return n;
}

async function linkAll(email, uid) {
  const [reservations, contrats, factures] = await Promise.all([
    linkCollection('reservations', 'email', email, uid, 'uid'),
    linkCollection('contrats', 'email', email, uid, 'uid'),
    linkCollection('factures', 'clientEmailLc', email, uid, 'clientUid'),
  ]);
  return { reservations, contrats, factures };
}

exports.linkMyAccount = onCall({ region: REGION, maxInstances: 5 }, async (request) => {
  const email = verifiedEmail(request);
  const linked = await linkAll(email, request.auth.uid);
  return { ok: true, linked };
});

async function autoLink(snap, collection) {
  const d = snap?.data();
  if (!d || d.uid || !d.email || d.source === 'noirlandmusic.com') return;
  try {
    const user = await admin.auth().getUserByEmail(norm(d.email));
    if (user && user.emailVerified) {
      await snap.ref.update({ uid: user.uid, linkedAt: admin.firestore.FieldValue.serverTimestamp() });
    }
  } catch (e) {
    if (e.code !== 'auth/user-not-found') console.error(`autoLink ${collection}`, e.message);
  }
}

exports.autoLinkReservation = onDocumentCreated({ document: 'reservations/{id}', region: REGION },
  (event) => autoLink(event.data, 'reservations'));
exports.autoLinkContrat = onDocumentCreated({ document: 'contrats/{id}', region: REGION },
  (event) => autoLink(event.data, 'contrats'));

exports.setMarketingPreference = onCall({ region: REGION, maxInstances: 5 }, async (request) => {
  const email = verifiedEmail(request);
  const accepte = request.data?.accepte === true;
  const ref = db.collection('desinscriptions').doc(hashId(email));
  if (accepte) await ref.delete();
  else await ref.set({ email, at: admin.firestore.FieldValue.serverTimestamp(), via: 'espace-client' }, { merge: true });
  return { ok: true, accepte };
});

exports.getMarketingPreference = onCall({ region: REGION, maxInstances: 5 }, async (request) => {
  const email = verifiedEmail(request);
  const snap = await db.collection('desinscriptions').doc(hashId(email)).get();
  return { accepte: !snap.exists };
});

// Message envoyé depuis l'espace client : prévenir Stevy par email (avant, rien ne le signalait).
const SUJETS = {
  'question-rdv': 'Question sur un rendez-vous', 'question-contrat': 'Question sur un contrat',
  modification: 'Demande de modification', resiliation: 'Demande de résiliation', urgence: '⚠️ Problème urgent',
  'suppression-compte': 'Suppression de compte (RGPD)', autre: 'Message',
};
exports.notifyClientMessage = onDocumentCreated(
  { document: 'messages_clients/{id}', region: REGION, secrets: [RESEND_API_KEY] },
  async (event) => {
    const m = event.data?.data();
    if (!m) return;
    const sujet = SUJETS[m.sujet] || m.sujet || 'Message';
    try {
      const resend = new Resend(RESEND_API_KEY.value());
      const { error } = await resend.emails.send({
        from: 'Makouez IT <contact@makouezit.org>',
        to: ['contact@makouezit.org'],
        replyTo: m.email || undefined,
        subject: `✉️ Espace client – ${sujet} – ${m.email || ''}`,
        html: `<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.6;max-width:560px">
          <h2 style="margin:0 0 12px">${esc(sujet)}</h2>
          <p><strong>De :</strong> ${esc(m.email || '–')}</p>
          ${m.contratId ? `<p><strong>Contrat :</strong> ${esc(m.contratId)}</p>` : ''}
          <div style="background:#f4f7fb;border-radius:10px;padding:14px 16px;white-space:pre-line">${esc(m.texte || '')}</div>
          <p style="margin-top:16px"><a href="https://makouezit.org/admin.html#messages">Ouvrir la boîte de réception de l'admin</a> · Répondez directement à cet email pour écrire au client.</p></div>`,
      });
      if (error) console.error('notifyClientMessage', error.message);
    } catch (e) { console.error('notifyClientMessage', e.message); }
  });

exports._test = { linkAll, autoLink, norm };
