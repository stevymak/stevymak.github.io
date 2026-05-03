'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { defineSecret } = require('firebase-functions/params');
const { Resend } = require('resend');

admin.initializeApp();

const RESEND_API_KEY = defineSecret('RESEND_API_KEY');

const REVIEW_LINK = 'https://g.page/r/TON-ID-GOOGLE/review';
const SITE_URL    = 'https://makouezit.org';
const FROM_EMAIL  = 'Makouez IT <contact@makouezit.org>';

// Relances factures
const FACTURE_FROM           = 'Makouez IT <facturation@makouezit.org>';
const REMINDER_DAYS_BETWEEN  = 7;   // Jours mini entre deux relances auto
const REMINDER_MAX           = 3;   // Nombre max de relances auto par facture

// Newsletter
const NEWSLETTER_FROM        = 'Makouez IT <newsletter@makouezit.org>';
const RESEND_RATE_LIMIT_MS   = 110; // ~9 envois/sec, sous le quota Resend (10/sec)

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

// ═══════════════════════════════════════════════════════════════════════════
// RELANCES FACTURES (Phase 2.3)
// ═══════════════════════════════════════════════════════════════════════════

function buildInvoiceReminderHtml(facture, sendCount) {
  const prenom = String(facture.client?.nom || '').split(' ')[0] || 'Madame, Monsieur';
  const numero = facture.numero || '';
  const ttc    = Number(facture.totalTTC) || 0;
  const ttcStr = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2 }).format(ttc) + ' €';
  const echeanceStr = facture.echeance
    ? new Date(facture.echeance + 'T12:00:00').toLocaleDateString('fr-FR', {
        day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris',
      })
    : '–';

  // Ton progressif selon le nombre de relances déjà envoyées.
  const tone = sendCount >= 2 ? 'urgent' : sendCount >= 1 ? 'firm' : 'soft';
  const intro = {
    soft:   `Sauf erreur de notre part, nous n'avons pas encore reçu le règlement de la facture ${numero}. Nous nous permettons de vous le rappeler.`,
    firm:   `Malgré notre précédent rappel, le règlement de la facture ${numero} ne nous est pas parvenu. Merci d'y procéder dans les meilleurs délais.`,
    urgent: `La facture ${numero} demeure impayée malgré nos relances. À défaut de règlement sous 8 jours, des mesures de recouvrement pourront être engagées.`,
  }[tone];

  return `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><title>Rappel de paiement</title></head>
<body style="margin:0;padding:0;background:#f0f0f8;font-family:'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f0f8;padding:20px 0">
  <tr><td align="center">
  <table width="100%" style="max-width:560px;border-radius:16px;overflow:hidden;border:1px solid #1a1a3a">
    <tr><td style="background:#0a0a18;padding:28px 32px;text-align:center">
      <div style="font-size:23px;font-weight:800;color:#ffffff;letter-spacing:-0.5px">
        Makouez <span style="color:#3b82f6">IT</span>
      </div>
      <div style="color:#6666aa;font-size:12px;margin-top:6px">Facturation</div>
    </td></tr>
    <tr><td style="background:#111128;padding:24px 32px">
      <p style="color:#f0f0ff;font-size:16px;font-weight:600;margin:0 0 8px 0">Bonjour ${prenom},</p>
      <p style="color:#9999bb;font-size:14px;margin:0;line-height:1.5">${intro}</p>
    </td></tr>
    <tr><td style="background:#111128;padding:0 32px 24px">
      <table width="100%" cellpadding="0" cellspacing="0"
        style="background:#0a0a18;border:1px solid #3b82f630;border-radius:12px;margin-top:12px;overflow:hidden">
        <tr><td style="background:#3b82f610;padding:14px 20px;border-bottom:1px solid #3b82f620">
          <div style="color:#3b82f6;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.1em">📋 Facture concernée</div>
          <div style="color:#f0f0ff;font-size:18px;font-weight:700;margin-top:6px">${numero}</div>
        </td></tr>
        <tr><td>
          <table width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td style="padding:14px 20px;border-bottom:1px solid #ffffff08;width:50%;vertical-align:top">
                <div style="color:#555577;font-size:11px;font-weight:700;text-transform:uppercase">💰 Montant TTC</div>
                <div style="color:#22c55e;font-size:16px;font-weight:700;margin-top:4px">${ttcStr}</div>
              </td>
              <td style="padding:14px 20px;border-bottom:1px solid #ffffff08;width:50%;vertical-align:top">
                <div style="color:#555577;font-size:11px;font-weight:700;text-transform:uppercase">📅 Échéance</div>
                <div style="color:#e0e0ff;font-size:13px;margin-top:4px">${echeanceStr}</div>
              </td>
            </tr>
          </table>
        </td></tr>
      </table>
    </td></tr>
    <tr><td style="background:#111128;padding:0 32px 24px">
      <div style="background:#0a0a18;border:1px solid #ffffff10;border-radius:12px;padding:18px 20px">
        <div style="color:#f0f0ff;font-size:14px;font-weight:700;margin-bottom:12px">💳 Modalités de paiement</div>
        <div style="color:#8888aa;font-size:13px;line-height:1.6">
          Virement bancaire, espèces, carte ou chèque acceptés.<br>
          Pour toute question ou justificatif déjà transmis, merci de répondre directement à cet email.
        </div>
      </div>
    </td></tr>
    <tr><td style="background:#111128;padding:0 32px 32px;text-align:center">
      <p style="color:#444466;font-size:12px;margin:20px 0 0 0">
        Merci d'avance, <strong style="color:#6666aa">Stevy</strong> — Makouez IT
      </p>
    </td></tr>
    <tr><td style="background:#08080f;padding:16px 32px;text-align:center">
      <p style="color:#333355;font-size:11px;margin:0;line-height:1.7">
        Makouez IT · Dépannage informatique à domicile · Île-de-France (93)<br>
        <a href="${SITE_URL}" style="color:#3b82f650;text-decoration:none">makouezit.org</a>
      </p>
    </td></tr>
  </table>
  </td></tr>
</table>
</body></html>`;
}

async function sendInvoiceReminder(factureId) {
  const db   = admin.firestore();
  const ref  = db.collection('factures').doc(factureId);
  const snap = await ref.get();
  if (!snap.exists) throw new Error(`Facture ${factureId} introuvable`);

  const f = snap.data();
  if (f.paid) {
    functions.logger.info('Relance ignorée – facture déjà payée', { factureId });
    return { skipped: true, reason: 'already_paid' };
  }
  if (!f.client?.email) {
    throw new Error('Pas d\'email client sur cette facture');
  }

  const sendCount = Number(f.reminderSendCount || 0);
  if (sendCount >= REMINDER_MAX) {
    functions.logger.info('Relance ignorée – plafond atteint', { factureId, sendCount });
    return { skipped: true, reason: 'max_reminders_reached', count: sendCount };
  }

  const html = buildInvoiceReminderHtml(f, sendCount);
  const subject = sendCount === 0
    ? `Rappel : facture ${f.numero} en attente de règlement`
    : `${sendCount + 1}ᵉ rappel : facture ${f.numero}`;

  const resend = new Resend(RESEND_API_KEY.value());
  const { error } = await resend.emails.send({
    from:    FACTURE_FROM,
    to:      f.client.email,
    subject,
    html,
  });

  if (error) {
    await ref.update({ reminderLastError: error.message });
    throw new Error(`Erreur Resend : ${error.message}`);
  }

  await ref.update({
    reminderSent:      true,
    reminderSentAt:    admin.firestore.FieldValue.serverTimestamp(),
    reminderSendCount: admin.firestore.FieldValue.increment(1),
    reminderLastError: admin.firestore.FieldValue.delete(),
  });

  functions.logger.info('Relance facture envoyée', { factureId, to: f.client.email, count: sendCount + 1 });
  return { success: true, count: sendCount + 1 };
}

// ─── Callable : relance manuelle depuis admin.html ───────────────────────────
exports.sendInvoiceReminderManual = functions
  .runWith({ secrets: [RESEND_API_KEY] })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Authentification requise.');
    }
    if (!context.auth.token.admin) {
      throw new functions.https.HttpsError('permission-denied', 'Accès admin requis.');
    }
    const { factureId } = data;
    if (!factureId || typeof factureId !== 'string') {
      throw new functions.https.HttpsError('invalid-argument', 'factureId manquant.');
    }
    try {
      return await sendInvoiceReminder(factureId);
    } catch (err) {
      functions.logger.error('sendInvoiceReminderManual – échec', { factureId, err: err.message });
      throw new functions.https.HttpsError('internal', err.message);
    }
  });

// ─── Cron quotidien : relances auto sur factures impayées en retard ──────────
// Tous les jours à 09:00 Europe/Paris :
//   - prend les factures `paid=false` en retard,
//   - relance celles qui n'ont pas été relancées depuis 7+ jours,
//   - cap à REMINDER_MAX relances totales par facture.
exports.scheduleInvoiceReminderCheck = functions
  .runWith({ secrets: [RESEND_API_KEY] })
  .pubsub.schedule('every day 09:00')
  .timeZone('Europe/Paris')
  .onRun(async () => {
    const db          = admin.firestore();
    const now         = Date.now();
    const cooldownMs  = REMINDER_DAYS_BETWEEN * 24 * 60 * 60 * 1000;
    const todayISO    = new Date().toISOString().slice(0, 10);

    const snap = await db.collection('factures').where('paid', '==', false).get();

    const toRemind = [];
    snap.forEach((d) => {
      const f = d.data();
      if (!f.client?.email) return;
      if (!f.echeance || f.echeance >= todayISO) return;
      const lastTs = f.reminderSentAt?.toMillis?.() || 0;
      if (lastTs && (now - lastTs) < cooldownMs) return;
      if (Number(f.reminderSendCount || 0) >= REMINDER_MAX) return;
      toRemind.push(d.id);
    });

    functions.logger.info(`Relances factures à envoyer : ${toRemind.length}`);

    const results = await Promise.allSettled(toRemind.map((id) => sendInvoiceReminder(id)));
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        functions.logger.error('Échec relance facture auto', {
          factureId: toRemind[i],
          err:        r.reason?.message,
        });
      }
    });

    return null;
  });

// ═══════════════════════════════════════════════════════════════════════════
// NEWSLETTER / CAMPAGNES (Phase 3.1)
// ═══════════════════════════════════════════════════════════════════════════

function personalize(html, recipient) {
  const r = recipient || {};
  return String(html || '')
    .replace(/\{\{nom\}\}/g,        r.nom || '')
    .replace(/\{\{firstname\}\}/g,  String(r.nom || '').split(' ')[0] || '')
    .replace(/\{\{email\}\}/g,      r.email || '');
}

function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

// ─── Callable : envoi d'une campagne à une liste de destinataires ────────────
//
// Input :
//   - campagneId  : id du document campagnes/{id}
//   - subject     : sujet (peut contenir {{nom}}, {{firstname}})
//   - html        : corps HTML (idem)
//   - recipients  : [{ email, nom }] — calculés côté admin
//
// L'admin reste l'autorité du segment ; on ne re-vérifie pas server-side.
// Quotas Resend : 100/jour en gratuit. Envoi séquentiel avec délai de 110ms
// pour rester sous 10 emails/seconde.
exports.sendCampaign = functions
  .runWith({ secrets: [RESEND_API_KEY], timeoutSeconds: 540 })
  .https.onCall(async (data, context) => {
    if (!context.auth) {
      throw new functions.https.HttpsError('unauthenticated', 'Authentification requise.');
    }
    if (!context.auth.token.admin) {
      throw new functions.https.HttpsError('permission-denied', 'Accès admin requis.');
    }

    const { campagneId, subject, html, recipients } = data || {};
    if (!campagneId || typeof campagneId !== 'string') {
      throw new functions.https.HttpsError('invalid-argument', 'campagneId manquant.');
    }
    if (!subject || !html) {
      throw new functions.https.HttpsError('invalid-argument', 'subject et html requis.');
    }
    if (!Array.isArray(recipients) || recipients.length === 0) {
      throw new functions.https.HttpsError('invalid-argument', 'recipients vide.');
    }
    if (recipients.length > 1000) {
      throw new functions.https.HttpsError('invalid-argument', 'Max 1000 destinataires par campagne.');
    }

    const resend = new Resend(RESEND_API_KEY.value());
    const db     = admin.firestore();
    const campRef= db.collection('campagnes').doc(campagneId);

    let sent     = 0;
    const errors = [];

    for (const r of recipients) {
      if (!r?.email) { errors.push({ email: '?', error: 'email manquant' }); continue; }
      try {
        const personalSubject = personalize(subject, r);
        const personalHtml    = personalize(html, r);
        const { error } = await resend.emails.send({
          from:    NEWSLETTER_FROM,
          to:      r.email,
          subject: personalSubject,
          html:    personalHtml,
          tags: [
            { name: 'campagne_id', value: campagneId },
            { name: 'kind',        value: 'newsletter' },
          ],
        });
        if (error) {
          errors.push({ email: r.email, error: error.message });
        } else {
          sent++;
        }
      } catch (e) {
        errors.push({ email: r.email, error: e?.message || String(e) });
      }
      await sleep(RESEND_RATE_LIMIT_MS);
    }

    await campRef.set({
      sentAt:         admin.firestore.FieldValue.serverTimestamp(),
      recipientCount: recipients.length,
      'stats.sent':   admin.firestore.FieldValue.increment(sent),
      'stats.errors': admin.firestore.FieldValue.increment(errors.length),
      lastErrors:     errors.slice(0, 10), // garder un échantillon
    }, { merge: true });

    functions.logger.info('Campagne envoyée', { campagneId, sent, errors: errors.length });
    return { sent, errors: errors.length, errorDetails: errors.slice(0, 20) };
  });

// ─── HTTP : webhook Resend pour traçabilité opens/clicks/bounces ─────────────
//
// À configurer dans le dashboard Resend → Webhooks → URL de cette fonction.
// On vérifie superficiellement que le payload a la forme attendue ; pour une
// vraie protection, ajouter une vérification de signature svix (TODO).
exports.resendWebhook = functions.https.onRequest(async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const body  = req.body || {};
  const type  = body.type;
  const data  = body.data || {};
  const tags  = Array.isArray(data.tags) ? data.tags : [];

  // Convertit l'array de tags Resend en map {name: value}
  const tagMap = {};
  tags.forEach((t) => { if (t?.name) tagMap[t.name] = t.value; });
  const campagneId = tagMap.campagne_id;

  if (!campagneId || !type) {
    functions.logger.info('Webhook ignoré (pas de campagne_id ou type)', { type, hasTags: tags.length });
    return res.status(200).send('IGNORED');
  }

  const fieldByEvent = {
    'email.sent':           'stats.deliveryAccepted',
    'email.delivered':      'stats.delivered',
    'email.delivery_delayed':'stats.delayed',
    'email.opened':         'stats.opened',
    'email.clicked':        'stats.clicked',
    'email.bounced':        'stats.bounced',
    'email.complained':     'stats.complained',
  };
  const field = fieldByEvent[type];
  if (!field) {
    return res.status(200).send('IGNORED_TYPE');
  }

  try {
    await admin.firestore().collection('campagnes').doc(campagneId).set({
      [field]: admin.firestore.FieldValue.increment(1),
      lastEventAt: admin.firestore.FieldValue.serverTimestamp(),
    }, { merge: true });
    return res.status(200).send('OK');
  } catch (err) {
    functions.logger.error('resendWebhook update failed', { campagneId, type, err: err.message });
    return res.status(500).send('ERROR');
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// AUTOMATIONS (Phase 3.3)
//   - automationWelcomeOnDone : email de bienvenue après le 1er RDV terminé
//   - automationDormantWeekly : relance des clients dormants (>6 mois)
//   - automationMonthlyRecap  : récap mensuel envoyé à l'admin
// ═══════════════════════════════════════════════════════════════════════════

// Doit produire le même id que l'admin front (admin/core/ui.js > clientHash) :
// SHA-256 des octets UTF-8 de `e:<email lowercase>`, tronqué à 16 hex.
function clientHashFromEmail(email) {
  const raw = `e:${String(email).toLowerCase()}`;
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex').slice(0, 16);
}

async function getAutomationSettings() {
  const snap = await admin.firestore().collection('settings').doc('automations').get();
  return snap.exists
    ? snap.data()
    : { welcome_enabled: false, dormant_enabled: false, monthlyRecap_enabled: false, adminEmail: '' };
}

function fmtEUR(n) {
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Math.round(n)) + ' €';
}

// ─── Email de bienvenue après le premier RDV terminé ─────────────────────────
function buildWelcomeHtml(rdv) {
  const prenom = String(rdv.nom || 'client').split(' ')[0];
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f0f0f8;font-family:'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f0f8;padding:20px 0">
  <tr><td align="center"><table width="100%" style="max-width:560px;border-radius:16px;overflow:hidden;border:1px solid #1a1a3a;background:#111128">
    <tr><td style="background:#0a0a18;padding:28px 32px;text-align:center">
      <div style="font-size:23px;font-weight:800;color:#fff">Makouez <span style="color:#3b82f6">IT</span></div>
    </td></tr>
    <tr><td style="padding:24px 32px">
      <p style="color:#f0f0ff;font-size:17px;font-weight:600;margin:0 0 10px 0">Bonjour ${prenom},</p>
      <p style="color:#9999bb;font-size:14px;margin:0;line-height:1.55">
        Merci d'avoir fait appel à <strong style="color:#fff">Makouez IT</strong> pour cette première intervention. J'espère que vous êtes pleinement satisfait du service.
      </p>
      <p style="color:#9999bb;font-size:14px;margin:14px 0 0 0;line-height:1.55">
        Pour rester en contact, n'hésitez pas à m'écrire en cas de besoin (panne, conseil, formation). Je propose aussi des contrats récurrents pour celles et ceux qui souhaitent un suivi régulier.
      </p>
      <p style="color:#9999bb;font-size:14px;margin:14px 0 0 0;line-height:1.55">
        Si vous avez 1 minute, un avis Google fait toute la différence pour me trouver d'autres clients : merci d'avance 🙏
      </p>
    </td></tr>
    <tr><td style="background:#0a0a18;padding:18px 32px;text-align:center">
      <a href="${SITE_URL}" style="color:#3b82f6;text-decoration:none;font-size:13px">makouezit.org</a>
      <p style="color:#444466;font-size:12px;margin:8px 0 0 0">Stevy — Makouez IT</p>
    </td></tr>
  </table></td></tr>
</table></body></html>`;
}

exports.automationWelcomeOnDone = functions
  .runWith({ secrets: [RESEND_API_KEY] })
  .firestore.document('reservations/{id}')
  .onUpdate(async (change, ctx) => {
    const before = change.before.data();
    const after  = change.after.data();
    if (!before || !after) return null;
    if (before.status === 'done' || after.status !== 'done') return null;

    const settings = await getAutomationSettings();
    if (!settings.welcome_enabled) return null;
    if (!after.email) return null;

    // Premier RDV terminé pour ce client ?
    const db = admin.firestore();
    const otherDoneSnap = await db.collection('reservations')
      .where('email', '==', after.email)
      .where('status', '==', 'done')
      .get();

    // Le doc en cours est déjà compté → si > 1 ce n'est pas le premier
    if (otherDoneSnap.size > 1) {
      functions.logger.info('Welcome ignoré – pas le premier RDV done', { email: after.email });
      return null;
    }

    try {
      const resend = new Resend(RESEND_API_KEY.value());
      await resend.emails.send({
        from:    NEWSLETTER_FROM,
        to:      after.email,
        subject: 'Merci pour votre confiance — Makouez IT',
        html:    buildWelcomeHtml(after),
      });
      functions.logger.info('Welcome envoyé', { id: ctx.params.id, email: after.email });
    } catch (err) {
      functions.logger.error('automationWelcomeOnDone — échec', { id: ctx.params.id, err: err.message });
    }
    return null;
  });

// ─── Relance dormants (cron hebdo, lundi 09:00) ──────────────────────────────
function buildDormantHtml(client) {
  const prenom = String(client.nom || '').split(' ')[0] || 'Bonjour';
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f0f0f8;font-family:'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f0f8;padding:20px 0">
  <tr><td align="center"><table width="100%" style="max-width:560px;border-radius:16px;overflow:hidden;border:1px solid #1a1a3a;background:#111128">
    <tr><td style="background:#0a0a18;padding:28px 32px;text-align:center">
      <div style="font-size:23px;font-weight:800;color:#fff">Makouez <span style="color:#3b82f6">IT</span></div>
    </td></tr>
    <tr><td style="padding:24px 32px">
      <p style="color:#f0f0ff;font-size:17px;font-weight:600;margin:0 0 10px 0">Bonjour ${prenom},</p>
      <p style="color:#9999bb;font-size:14px;margin:0;line-height:1.55">
        Cela fait un moment qu'on ne s'est pas vus 👋. J'espère que tout va bien pour vous et votre matériel.
      </p>
      <p style="color:#9999bb;font-size:14px;margin:14px 0 0 0;line-height:1.55">
        Si vous avez besoin d'un coup de main (lenteurs, sauvegarde, sécurité, formation, mise à jour), n'hésitez pas — je reste joignable au 06 19 51 57 56 ou par retour d'email.
      </p>
      <p style="color:#9999bb;font-size:14px;margin:14px 0 0 0">À très vite peut-être 😊</p>
    </td></tr>
    <tr><td style="background:#0a0a18;padding:18px 32px;text-align:center">
      <a href="${SITE_URL}" style="color:#3b82f6;text-decoration:none;font-size:13px">makouezit.org</a>
    </td></tr>
  </table></td></tr>
</table></body></html>`;
}

exports.automationDormantWeekly = functions
  .runWith({ secrets: [RESEND_API_KEY], timeoutSeconds: 540 })
  .pubsub.schedule('every monday 09:00')
  .timeZone('Europe/Paris')
  .onRun(async () => {
    const settings = await getAutomationSettings();
    if (!settings.dormant_enabled) return null;

    const db             = admin.firestore();
    const sixMonthsAgoMs = Date.now() - 180 * 24 * 3600 * 1000;
    const ninetyDaysAgoMs= Date.now() - 90  * 24 * 3600 * 1000;

    // Index clients depuis reservations
    const snap = await db.collection('reservations')
      .where('status', 'in', ['confirmed', 'done'])
      .get();

    const byEmail = new Map();
    snap.forEach((d) => {
      const r = d.data();
      if (!r.email) return;
      const key    = String(r.email).toLowerCase();
      const dateMs = r.dateKey ? new Date(r.dateKey + 'T12:00:00').getTime() : 0;
      const cur    = byEmail.get(key);
      if (!cur || cur.lastMs < dateMs) {
        byEmail.set(key, { email: r.email, nom: r.nom || '', lastMs: dateMs });
      }
    });

    const candidates = [];
    byEmail.forEach((c) => {
      if (c.lastMs && c.lastMs < sixMonthsAgoMs) candidates.push(c);
    });

    // Filtrer : ne pas re-spammer ceux relancés < 90 jours
    const toEmail = [];
    for (const c of candidates) {
      const hash     = clientHashFromEmail(c.email);
      const metaSnap = await db.collection('clients_meta').doc(hash).get();
      const meta     = metaSnap.exists ? metaSnap.data() : {};
      const lastSent = meta.lastDormantEmailMs || 0;
      if (lastSent < ninetyDaysAgoMs) toEmail.push({ ...c, hash });
    }

    functions.logger.info(`Dormants à relancer : ${toEmail.length}`);
    if (toEmail.length === 0) return null;

    const resend = new Resend(RESEND_API_KEY.value());
    let sent = 0, errors = 0;
    for (const c of toEmail) {
      try {
        const { error } = await resend.emails.send({
          from:    NEWSLETTER_FROM,
          to:      c.email,
          subject: 'On ne s\'est pas vus depuis un moment 👋',
          html:    buildDormantHtml(c),
        });
        if (error) { errors++; functions.logger.error('Dormant send error', { email: c.email, err: error.message }); }
        else {
          sent++;
          await db.collection('clients_meta').doc(c.hash).set(
            { lastDormantEmailMs: Date.now() }, { merge: true },
          );
        }
      } catch (err) {
        errors++;
        functions.logger.error('Dormant exception', { email: c.email, err: err.message });
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    functions.logger.info(`Dormants envoyés : ${sent} succès, ${errors} erreurs`);
    return null;
  });

// ─── Récap mensuel admin (cron 1er du mois 08:00) ────────────────────────────
function buildMonthlyRecapHtml({ monthLabel, totalRdv, doneCount, ca, factCount, factCa, contratsActifs, mrr }) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f0f0f8;font-family:'Segoe UI',Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f0f0f8;padding:20px 0">
  <tr><td align="center"><table width="100%" style="max-width:560px;border-radius:16px;overflow:hidden;border:1px solid #1a1a3a;background:#111128">
    <tr><td style="background:#0a0a18;padding:28px 32px;text-align:center">
      <div style="font-size:23px;font-weight:800;color:#fff">Récap ${monthLabel}</div>
      <div style="color:#6666aa;font-size:12px;margin-top:6px">Makouez IT</div>
    </td></tr>
    <tr><td style="padding:24px 32px">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td style="padding:12px;border:1px solid #ffffff10;border-radius:8px;width:48%;vertical-align:top">
            <div style="color:#8888aa;font-size:11px;text-transform:uppercase;font-weight:700">CA estimé</div>
            <div style="color:#22c55e;font-size:22px;font-weight:800;margin-top:4px">${fmtEUR(ca)}</div>
            <div style="color:#666;font-size:11px;margin-top:2px">${doneCount}/${totalRdv} RDV honorés</div>
          </td>
          <td style="width:4%"></td>
          <td style="padding:12px;border:1px solid #ffffff10;border-radius:8px;width:48%;vertical-align:top">
            <div style="color:#8888aa;font-size:11px;text-transform:uppercase;font-weight:700">Factures encaissées</div>
            <div style="color:#3b82f6;font-size:22px;font-weight:800;margin-top:4px">${fmtEUR(factCa)}</div>
            <div style="color:#666;font-size:11px;margin-top:2px">${factCount} facture${factCount > 1 ? 's' : ''}</div>
          </td>
        </tr>
        <tr><td colspan="3" style="height:12px"></td></tr>
        <tr>
          <td colspan="3" style="padding:12px;border:1px solid #a855f730;border-radius:8px;background:#a855f708">
            <div style="color:#a855f7;font-size:11px;text-transform:uppercase;font-weight:700">MRR Contrats récurrents</div>
            <div style="color:#a855f7;font-size:22px;font-weight:800;margin-top:4px">${fmtEUR(mrr)} / mois</div>
            <div style="color:#aaa;font-size:11px;margin-top:2px">${contratsActifs} contrat${contratsActifs > 1 ? 's' : ''} actif${contratsActifs > 1 ? 's' : ''}</div>
          </td>
        </tr>
      </table>
      <p style="color:#9999bb;font-size:13px;margin:18px 0 0 0;line-height:1.5">
        Bonne continuation pour le mois en cours 💪.<br>
        Le détail complet est dans <a href="${SITE_URL}/admin.html" style="color:#3b82f6">l'admin</a>.
      </p>
    </td></tr>
  </table></td></tr>
</table></body></html>`;
}

exports.automationMonthlyRecap = functions
  .runWith({ secrets: [RESEND_API_KEY], timeoutSeconds: 300 })
  .pubsub.schedule('1 8 1 * *')   // 08:01 le 1er de chaque mois
  .timeZone('Europe/Paris')
  .onRun(async () => {
    const settings = await getAutomationSettings();
    if (!settings.monthlyRecap_enabled) return null;
    if (!settings.adminEmail) return null;

    const db    = admin.firestore();
    const now   = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const monthKey = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;
    const monthLabel = start.toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });

    // RDV
    const rdvSnap = await db.collection('reservations').where('monthKey', '==', monthKey).get();
    let totalRdv = 0, doneCount = 0, ca = 0;
    rdvSnap.forEach((d) => {
      const r = d.data();
      totalRdv++;
      if (r.status === 'confirmed' || r.status === 'done') {
        doneCount++;
        ca += (typeof r.prixReel === 'number') ? r.prixReel : 70;
      }
    });

    // Factures payées dans le mois
    const startMs = start.getTime();
    const endMs   = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const factSnap = await db.collection('factures').where('paid', '==', true).get();
    let factCa = 0, factCount = 0;
    factSnap.forEach((d) => {
      const f      = d.data();
      const paidAt = typeof f.paidAt === 'number'
        ? f.paidAt
        : (f.paidAt?.toMillis?.() || 0);
      if (paidAt >= startMs && paidAt < endMs) {
        factCa += Number(f.totalTTC) || 0;
        factCount++;
      }
    });

    // Contrats actifs + MRR
    const tarifs = { serenite: 45, senior: 49, famille: 59 };
    const cSnap  = await db.collection('contrats').where('status', '==', 'active').get();
    let contratsActifs = 0, mrr = 0;
    cSnap.forEach((d) => {
      contratsActifs++;
      mrr += tarifs[d.data().contrat] || 0;
    });

    try {
      const resend = new Resend(RESEND_API_KEY.value());
      await resend.emails.send({
        from:    FROM_EMAIL,
        to:      settings.adminEmail,
        subject: `Récap ${monthLabel} — Makouez IT`,
        html:    buildMonthlyRecapHtml({ monthLabel, totalRdv, doneCount, ca, factCount, factCa, contratsActifs, mrr }),
      });
      functions.logger.info('Récap mensuel envoyé', { monthLabel, to: settings.adminEmail });
    } catch (err) {
      functions.logger.error('automationMonthlyRecap — échec', { err: err.message });
    }
    return null;
  });
