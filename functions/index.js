const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

const REVIEW_LINK = 'https://g.page/r/TON-ID-GOOGLE/review';

exports.requestReviewAfterIntervention = functions.firestore
  .document('reservations/{id}')
  .onUpdate(async (change, context) => {
    const before = change.before.data();
    const after = change.after.data();

    if (!before || !after) return null;

    // Déclenche uniquement quand le statut passe à "completed".
    if (before.status === 'completed' || after.status !== 'completed') {
      return null;
    }

    const email = after.email;
    const firstName = (after.nom || 'client').split(' ')[0];

    if (!email) {
      functions.logger.warn('Reservation completed without email', {
        reservationId: context.params.id,
      });
      return null;
    }

    const reviewRequest = {
      reservationId: context.params.id,
      to: email,
      subject: 'Comment s\'est passée votre intervention ?',
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
      status: 'pending',
      kind: 'google-review-request',
    };

    // TODO:
    // 1. Remplacer REVIEW_LINK par le vrai lien Google Business.
    // 2. Brancher ici votre provider email réel (Brevo, Resend, Mailgun, etc.)
    //    ou consommer cette file depuis un worker séparé.
    // 3. Ajouter une relance différée si besoin via Cloud Scheduler / Cloud Tasks.
    await admin.firestore().collection('email_queue').add(reviewRequest);

    functions.logger.info('Queued review request after completed intervention', {
      reservationId: context.params.id,
      email,
    });

    return null;
  });
