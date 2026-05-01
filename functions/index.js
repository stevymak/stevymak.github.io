'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const { defineSecret } = require('firebase-functions/params');
const { Resend } = require('resend');

admin.initializeApp();

const RESEND_API_KEY = defineSecret('RESEND_API_KEY');

const REVIEW_LINK = 'https://g.page/r/TON-ID-GOOGLE/review';
const SITE_URL    = 'https://makouezit.org';
const FROM_EMAIL  = 'Makouez IT <contact@makouezit.org>';

// ─── Parse start hour from timeLabel (e.g. "10h00 – 12h00" → 10) ─────────────
function parseSlotStartHour(timeLabel) {
  if (!timeLabel) return 9;
  const match = String(timeLabel).match(/(\d{1,2})h(\d*)/);
  return match ? parseInt(match[1], 10) : 9;
}

// ─── Convert dateKey + timeLabel to UTC timestamp (Paris timezone) ────────────
function rdvToTimestamp(dateKey, timeLabel) {
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return null;
  const [y, m, d] = dateKey.split('-').map(Number);
  const hour = parseSlotStartHour(timeLabel);
  // Approximate Paris offset: UTC+2 Apr–Oct, UTC+1 otherwise
  const parisOffset = (m >= 4 && m <= 10) ? 2 : 1;
  return new Date(Date.UTC(y, m - 1, d, hour - parisOffset, 0, 0));
}

// ─── Email HTML template ──────────────────────────────────────────────────────
function buildReminderHtml(rdv, rdvId) {
  const prenom     = (rdv.nom || 'client').split(' ')[0];
  const plage      = rdv.timeLabel || rdv.time || '–';
  const cancelUrl  = `${SITE_URL}/suivi-rdv.html?id=${rdvId}`;
  const dateLabel  = rdv._dateLabel || rdv.dateKey || '–';

  const checklist = [
    'Sauvegardez vos données importantes (photos, documents)',
    'Ayez vos identifiants et mots de passe à portée',
    'Préparez l\'appareil concerné, branché et accessible',
    'Prévoyez une prise électrique disponible à proximité',
    'Notez les problèmes et symptômes rencontrés',
    'Prévoyez un moyen de paiement (espèces, virement ou CB)',
  ];

  const checklistHtml = checklist.map(item => `
    <div style="display:flex;gap:10px;margin-bottom:10px;align-items:flex-start">
      <span style="color:#22c55e;font-weight:700;flex-shrink:0;font-size:14px">✓</span>
      <span style="color:#8888aa;font-size:13px;line-height:1.5">${item}</span>
    </div>`).join('');

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>Rappel RDV – Makouez IT</title>
</head>
<body style="margin:0;padding:0;background:#f0f0f8;font-family:'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f0f8;padding:20px 0">
  <tr><td align="center">
  <table width="100%" style="max-width:560px;margin:0 auto;border-radius:16px;overflow:hidden;border:1px solid #1a1a3a">

    <!-- En-tête -->
    <tr><td style="background:#0a0a18;padding:28px 32px;text-align:center">
      <div style="font-size:23px;font-weight:800;color:#ffffff;letter-spacing:-0.5px">
        Makouez <span style="color:#3b82f6">IT</span>
      </div>
      <div style="color:#6666aa;font-size:12px;margin-top:6px">Dépannage informatique à domicile · Seine-Saint-Denis (93)</div>
    </td></tr>

    <!-- Accroche -->
    <tr><td style="background:#111128;padding:24px 32px;border-bottom:1px solid #ffffff10">
      <p style="color:#f0f0ff;font-size:17px;font-weight:600;margin:0 0 6px 0">Bonjour ${prenom} 👋</p>
      <p style="color:#9999bb;font-size:14px;margin:0">Votre rendez-vous a lieu <strong style="color:#3b82f6">demain</strong>. Voici toutes les informations.</p>
    </td></tr>

    <!-- Récap RDV -->
    <tr><td style="background:#111128;padding:0 32px 24px">
      <table width="100%" cellpadding="0" cellspacing="0"
        style="background:#0a0a18;border:1px solid #3b82f630;border-radius:12px;margin-top:20px;overflow:hidden">
        <tr><td style="background:#3b82f610;padding:14px 20px;border-bottom:1px solid #3b82f620">
          <div style="color:#3b82f6;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em">📋 Prestation réservée</div>
          <div style="color:#f0f0ff;font-size:16px;font-weight:700;margin-top:4px">${rdv.service || '–'}</div>
        </td></tr>
        <tr><td>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:14px 20px;border-bottom:1px solid #ffffff08;border-right:1px solid #ffffff08;width:50%;vertical-align:top">
                <div style="color:#555577;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em">📅 Date</div>
                <div style="color:#e0e0ff;font-size:13px;margin-top:4px">${dateLabel}</div>
              </td>
              <td style="padding:14px 20px;border-bottom:1px solid #ffffff08;width:50%;vertical-align:top">
                <div style="color:#555577;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em">🕐 Plage horaire</div>
                <div style="color:#e0e0ff;font-size:13px;margin-top:4px">${plage}</div>
              </td>
            </tr>
            <tr><td colspan="2" style="padding:14px 20px">
              <div style="color:#555577;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.08em">📍 Adresse</div>
              <div style="color:#e0e0ff;font-size:13px;margin-top:4px">${rdv.adresse || '–'}</div>
            </td></tr>
          </table>
        </td></tr>
      </table>
    </td></tr>

    <!-- Checklist préparation -->
    <tr><td style="background:#111128;padding:0 32px 24px">
      <div style="background:#0a0a18;border:1px solid #ffffff10;border-radius:12px;padding:20px">
        <div style="color:#f0f0ff;font-size:14px;font-weight:700;margin-bottom:14px">✅ Comment préparer votre rendez-vous</div>
        ${checklistHtml}
      </div>
    </td></tr>

    <!-- Coordonnées -->
    <tr><td style="background:#111128;padding:0 32px 24px">
      <div style="background:#0a0a18;border:1px solid #ffffff10;border-radius:12px;padding:18px 20px">
        <div style="color:#f0f0ff;font-size:14px;font-weight:700;margin-bottom:12px">📞 Un imprévu ? Contactez-moi</div>
        <div style="color:#8888aa;font-size:13px;margin-bottom:8px">
          📱 <a href="tel:+33XXXXXXXXX" style="color:#3b82f6;text-decoration:none;font-weight:500">06 XX XX XX XX</a>
        </div>
        <div style="color:#8888aa;font-size:13px">
          ✉️ <a href="mailto:contact@makouezit.org" style="color:#3b82f6;text-decoration:none;font-weight:500">contact@makouezit.org</a>
        </div>
      </div>
    </td></tr>

    <!-- Bouton reporter/annuler -->
    <tr><td style="background:#111128;padding:0 32px 32px;text-align:center">
      <a href="${cancelUrl}"
        style="display:inline-block;color:#8888aa;font-size:13px;border:1px solid #3b82f630;border-radius:8px;padding:12px 28px;text-decoration:none;background:#0a0a18">
        Reporter ou annuler le rendez-vous
      </a>
      <p style="color:#444466;font-size:12px;margin:20px 0 0 0">
        À demain, <strong style="color:#6666aa">Stevy</strong> — Makouez IT
      </p>
    </td></tr>

    <!-- Pied de page -->
    <tr><td style="background:#08080f;padding:16px 32px;text-align:center">
      <p style="color:#333355;font-size:11px;margin:0;line-height:1.7">
        Makouez IT · Dépannage informatique à domicile · Île-de-France (93)<br>
        <a href="${SITE_URL}" style="color:#3b82f650;text-decoration:none">makouezit.org</a> ·
        <a href="${SITE_URL}/mentions-legales.html" style="color:#3b82f650;text-decoration:none">Mentions légales</a> ·
        <a href="${SITE_URL}/confidentialite.html" style="color:#3b82f650;text-decoration:none">Confidentialité</a>
      </p>
    </td></tr>

  </table>
  </td></tr>
</table>
</body>
</html>`;
}

// ─── Utilitaire principal : envoyer l'email de rappel ─────────────────────────
async function sendReminderEmail(rdvId) {
  const db     = admin.firestore();
  const rdvRef = db.collection('reservations').doc(rdvId);
  const snap   = await rdvRef.get();

  if (!snap.exists) throw new Error(`RDV ${rdvId} introuvable`);

  const rdv = snap.data();

  if (rdv.status === 'cancelled') {
    functions.logger.info('Rappel ignoré – RDV annulé', { rdvId });
    return { skipped: true, reason: 'cancelled' };
  }

  if (!rdv.email) throw new Error('Pas d\'adresse email sur ce RDV');

  const dateLabel = rdv.dateKey
    ? new Date(rdv.dateKey + 'T12:00:00').toLocaleDateString('fr-FR', {
        weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
        timeZone: 'Europe/Paris',
      })
    : '–';

  rdv._dateLabel = dateLabel;
  const html = buildReminderHtml(rdv, rdvId);

  const resend = new Resend(RESEND_API_KEY.value());
  const { error } = await resend.emails.send({
    from:    FROM_EMAIL,
    to:      rdv.email,
    subject: 'Rappel : votre rendez-vous Makouez IT demain',
    html,
  });

  if (error) {
    await rdvRef.update({ reminderLastError: error.message });
    throw new Error(`Erreur Resend : ${error.message}`);
  }

  await rdvRef.update({
    reminderSent:      true,
    reminderSentAt:    admin.firestore.FieldValue.serverTimestamp(),
    reminderSendCount: admin.firestore.FieldValue.increment(1),
    reminderLastError: admin.firestore.FieldValue.delete(),
  });

  functions.logger.info('Rappel RDV envoyé', { rdvId, to: rdv.email });
  return { success: true };
}

// ─── Trigger : demande d'avis après intervention terminée ─────────────────────
exports.requestReviewAfterIntervention = functions.firestore
  .document('reservations/{id}')
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after  = change.after.data();

    if (!before || !after) return null;

    if (before.status === 'completed' || after.status !== 'completed') return null;

    const email     = after.email;
    const firstName = (after.nom || 'client').split(' ')[0];

    if (!email) {
      functions.logger.warn('Réservation terminée sans email', { id: context.params.id });
      return null;
    }

    const reviewRequest = {
      reservationId: context.params.id,
      to:            email,
      subject:       'Comment s\'est passée votre intervention ?',
      html: `
        <p>Bonjour ${firstName},</p>
        <p>Merci de m'avoir fait confiance pour votre intervention.</p>
        <p>Si tout s'est bien passé, je serais reconnaissant que vous laissiez un avis Google. Cela aide énormément les autres particuliers à me trouver.</p>
        <p>
          <a href="${REVIEW_LINK}" style="background:#00e5a0;color:#0a0e14;padding:12px 24px;text-decoration:none;border-radius:8px;font-weight:700;display:inline-block;">
            ⭐ Laisser un avis (1 min)
          </a>
        </p>
        <p>Merci infiniment,<br>Stevy</p>
      `,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      status:    'pending',
      kind:      'google-review-request',
    };

    // TODO: brancher le vrai lien Google Business dans REVIEW_LINK
    // et connecter un worker pour consommer email_queue.
    await admin.firestore().collection('email_queue').add(reviewRequest);

    functions.logger.info('Demande d\'avis mise en file', {
      id: context.params.id,
      email,
    });

    return null;
  });

// ─── Trigger : marquer reminderSkip si le RDV est annulé ─────────────────────
exports.handleRdvUpdate = functions.firestore
  .document('reservations/{id}')
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after  = change.after.data();

    if (!before || !after) return null;

    // Si le RDV passe en annulé et que le rappel n'a pas encore été envoyé,
    // on marque reminderSkip pour que le cron l'ignore.
    if (before.status !== 'cancelled' && after.status === 'cancelled' && !after.reminderSent) {
      await change.after.ref.update({ reminderSkip: true });
      functions.logger.info('Rappel annulé – RDV cancelled', { id: context.params.id });
    }

    return null;
  });

// ─── Cron Option B : vérification toutes les 30 min ──────────────────────────
// Envoie les rappels pour les RDV dont le créneau tombe dans [now+23h45 ; now+24h15].
// Utilise reminderSent et reminderSkip pour n'envoyer qu'une seule fois en auto.
exports.scheduleReminderCheck = functions
  .runWith({ secrets: [RESEND_API_KEY] })
  .pubsub.schedule('every 30 minutes')
  .timeZone('Europe/Paris')
  .onRun(async () => {
    const db          = admin.firestore();
    const now         = Date.now();
    const windowStart = now + (23 * 60 + 45) * 60000; // now + 23h45
    const windowEnd   = now + (24 * 60 + 15) * 60000; // now + 24h15

    functions.logger.info('Vérification rappels RDV', {
      windowStart: new Date(windowStart).toISOString(),
      windowEnd:   new Date(windowEnd).toISOString(),
    });

    const snap = await db.collection('reservations')
      .where('status', 'in', ['pending', 'confirmed'])
      .get();

    const toSend = [];
    snap.forEach(doc => {
      const d = doc.data();
      if (d.reminderSent === true)  return;
      if (d.reminderSkip === true)  return;
      const ts = rdvToTimestamp(d.dateKey, d.timeLabel || d.time);
      if (!ts) return;
      const ms = ts.getTime();
      if (ms >= windowStart && ms <= windowEnd) toSend.push(doc.id);
    });

    functions.logger.info(`${toSend.length} rappel(s) à envoyer`);

    const results = await Promise.allSettled(toSend.map(id => sendReminderEmail(id)));
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        functions.logger.error('Échec envoi rappel auto', {
          rdvId: toSend[i],
          err:   r.reason?.message,
        });
      }
    });

    return null;
  });

// ─── Callable : envoi manuel depuis admin.html ────────────────────────────────
// Protégée : nécessite d'être authentifié avec le custom claim admin:true.
exports.sendReminderManual = functions
  .runWith({ secrets: [RESEND_API_KEY] })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Authentification requise.');
    }
    if (!context.auth.token.admin) {
      throw new functions.https.HttpsError('permission-denied', 'Accès réservé aux administrateurs.');
    }

    const { rdvId } = data;
    if (!rdvId || typeof rdvId !== 'string') {
      throw new functions.https.HttpsError('invalid-argument', 'rdvId manquant ou invalide.');
    }

    try {
      const result = await sendReminderEmail(rdvId);
      return result;
    } catch (err) {
      functions.logger.error('sendReminderManual – échec', { rdvId, err: err.message });
      throw new functions.https.HttpsError('internal', err.message);
    }
  });
