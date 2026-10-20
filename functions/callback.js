'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// callback.js — Demande de rappel depuis l'accueil (lot 4, oct. 2026).
// Avant : le formulaire « Être rappelé » envoyait prénom et téléphone dans
// l'URL de la page de réservation, qui ne les lisait pas : la demande était
// perdue. Désormais : enregistrement dans `rappels` + email immédiat à Stevy.
// ─────────────────────────────────────────────────────────────────────────────

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { defineSecret } = require('firebase-functions/params');
const admin  = require('firebase-admin');
const crypto = require('crypto');
const { Resend } = require('resend');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const RESEND_API_KEY = defineSecret('RESEND_API_KEY');
const ENFORCE_APP_CHECK = false; // à passer à true avec booking.js (TODO-MANUEL.md, S6)
const MAX_PAR_IP_JOUR = 3;
const BESOINS = ['Dépannage PC', 'Réseau Wi-Fi', 'Sauvegarde et sécurité', 'Récupération de données',
  'Installation Windows et logiciels', 'Formation et accompagnement', 'Site web / devis', 'Autre'];

const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

exports.requestCallback = onCall(
  { region: 'europe-west1', secrets: [RESEND_API_KEY], enforceAppCheck: ENFORCE_APP_CHECK, maxInstances: 3 },
  async (request) => {
    const d = request.data || {};
    const prenom    = typeof d.prenom === 'string' ? d.prenom.trim().slice(0, 80) : '';
    const telephone = typeof d.telephone === 'string' ? d.telephone.trim().slice(0, 40) : '';
    const besoin    = BESOINS.includes(d.besoin) ? d.besoin : 'Autre';
    if (!prenom) throw new HttpsError('invalid-argument', 'Merci d’indiquer votre prénom.');
    if (!/^[+\d][\d\s.()-]{5,}$/.test(telephone)) throw new HttpsError('invalid-argument', 'Numéro de téléphone invalide.');
    if (d.consentement !== true) throw new HttpsError('failed-precondition', 'Merci d’accepter d’être rappelé.');

    // Limite par adresse IP (empreinte, conservée 48 h)
    const ip = request.rawRequest?.headers?.['x-forwarded-for']?.toString().split(',')[0].trim() || request.rawRequest?.ip || 'inconnue';
    const jour = new Intl.DateTimeFormat('fr-CA', { timeZone: 'Europe/Paris' }).format(new Date());
    const ipKey = crypto.createHash('sha256').update(String(ip)).digest('hex').slice(0, 24);
    const rl = db.collection('rate_limits').doc(`rappel_${ipKey}_${jour}`);
    const ok = await db.runTransaction(async (tx) => {
      const snap = await tx.get(rl);
      const n = (snap.exists ? snap.data().n : 0) + 1;
      if (n > MAX_PAR_IP_JOUR) return false;
      tx.set(rl, { n, expireAt: admin.firestore.Timestamp.fromMillis(Date.now() + 2 * 86400000) });
      return true;
    });
    if (!ok) throw new HttpsError('resource-exhausted', 'Demande déjà reçue. Vous pouvez aussi appeler le 07 45 10 38 27.');

    const ref = await db.collection('rappels').add({
      prenom, telephone, besoin, statut: 'nouveau',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    try {
      const resend = new Resend(RESEND_API_KEY.value());
      const { error } = await resend.emails.send({
        from: 'Makouez IT <contact@makouezit.org>',
        to: ['contact@makouezit.org'],
        subject: `📞 Rappel demandé – ${prenom} – ${besoin}`,
        html: `<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.6">
          <h2 style="margin:0 0 12px">Demande de rappel</h2>
          <p><strong>${esc(prenom)}</strong> souhaite être rappelé(e).</p>
          <p>📞 <a href="tel:${esc(telephone.replace(/[^\d+]/g, ''))}" style="font-size:20px;font-weight:bold">${esc(telephone)}</a></p>
          <p>Besoin : ${esc(besoin)}</p>
          <p style="color:#666;font-size:13px">Référence : ${esc(ref.id)}</p></div>`,
      });
      if (error) console.error('requestCallback : email non envoyé', error.message);
    } catch (e) {
      console.error('requestCallback : échec email', e.message);
    }
    return { ok: true };
  },
);
