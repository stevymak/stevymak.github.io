'use strict';
// ─────────────────────────────────────────────────────────────────────────────
// unsubscribe.js — Désinscription des emails commerciaux (newsletters, offres,
// relances de clients inactifs). Obligatoire : art. L.34-5 du CPCE.
//
//   Lien signé par destinataire : HMAC-SHA256(secret, email). Le secret est
//   généré une seule fois et stocké dans settings/unsubscribe (admin seulement).
//   GET  → page de confirmation (bouton), pour que les antivirus de messagerie
//          qui ouvrent les liens ne désinscrivent personne par erreur.
//   POST → désinscription (bouton de la page ou « un clic » RFC 8058 de Gmail).
//   Les désinscrits sont dans desinscriptions/{sha256(email)}.
// ─────────────────────────────────────────────────────────────────────────────

const { onRequest } = require('firebase-functions/v2/https');
const admin  = require('firebase-admin');
const crypto = require('crypto');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const REGION = 'europe-west1';
const ENDPOINT = 'https://europe-west1-makouez-it.cloudfunctions.net/unsubscribe';

const norm   = (email) => String(email || '').trim().toLowerCase();
const hashId = (email) => crypto.createHash('sha256').update(norm(email)).digest('hex');
const b64u   = (s) => Buffer.from(s, 'utf8').toString('base64url');
const unb64u = (s) => Buffer.from(String(s || ''), 'base64url').toString('utf8');

let secretCache = null;
async function getSecret() {
  if (secretCache) return secretCache;
  const ref = db.collection('settings').doc('unsubscribe');
  secretCache = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (snap.exists && snap.data().secret) return snap.data().secret;
    const secret = crypto.randomBytes(32).toString('hex');
    tx.set(ref, { secret, createdAt: admin.firestore.FieldValue.serverTimestamp() });
    return secret;
  });
  return secretCache;
}

async function token(email) {
  return crypto.createHmac('sha256', await getSecret()).update(norm(email)).digest('hex').slice(0, 32);
}

async function unsubscribeUrl(email) {
  return `${ENDPOINT}?e=${b64u(norm(email))}&t=${await token(email)}`;
}

async function isUnsubscribed(email) {
  const snap = await db.collection('desinscriptions').doc(hashId(email)).get();
  return snap.exists;
}

// Renvoie un Set des emails désinscrits parmi une liste (lecture groupée).
async function unsubscribedAmong(emails) {
  const uniques = [...new Set(emails.map(norm).filter(Boolean))];
  const out = new Set();
  for (let i = 0; i < uniques.length; i += 300) {
    const refs = uniques.slice(i, i + 300).map((e) => db.collection('desinscriptions').doc(hashId(e)));
    const snaps = await db.getAll(...refs);
    snaps.forEach((s, k) => { if (s.exists) out.add(uniques[i + k]); });
  }
  return out;
}

// Pied de page HTML + en-têtes pour Resend
async function unsubscribeParts(email) {
  const url = await unsubscribeUrl(email);
  return {
    url,
    footerHtml: `<p style="margin:24px 0 0;text-align:center;font-size:12px;line-height:1.6;color:#8888aa">Vous recevez cet email car vous êtes client de Makouez IT.<br><a href="${url}" style="color:#8888aa;text-decoration:underline">Se désinscrire des emails d'information et d'offres</a></p>`,
    headers: {
      'List-Unsubscribe': `<${url}>, <mailto:contact@makouezit.org?subject=desinscription>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

// Insère le pied de page avant </body> (ou à la fin)
function withFooter(html, footerHtml) {
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${footerHtml}</body>`) : `${html}${footerHtml}`;
}

const page = (titre, corps) => `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${titre} – Makouez IT</title>
<style>body{font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:3rem auto;padding:0 1rem;color:#111827;line-height:1.6;font-size:18px}button{font-size:18px;padding:.8rem 1.4rem;border-radius:10px;border:none;background:#2563eb;color:#fff;cursor:pointer}a{color:#2563eb}</style></head>
<body><h1 style="font-size:1.5rem">${titre}</h1>${corps}<p style="margin-top:2rem"><a href="https://makouezit.org">← Retour au site Makouez IT</a></p></body></html>`;

const unsubscribe = onRequest({ region: REGION, maxInstances: 3 }, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.set('X-Robots-Tag', 'noindex');
  const email = norm(unb64u(req.query.e));
  const t = String(req.query.t || '');
  const valide = email && /^[a-f0-9]{32}$/.test(t)
    && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(await token(email)));

  if (!valide) {
    return res.status(400).send(page('Lien invalide', '<p>Ce lien de désinscription est incomplet ou expiré. Écrivez à <a href="mailto:contact@makouezit.org?subject=desinscription">contact@makouezit.org</a> et nous vous désinscrirons.</p>'));
  }

  if (req.method === 'POST') {
    await db.collection('desinscriptions').doc(hashId(email)).set({
      email,
      at: admin.firestore.FieldValue.serverTimestamp(),
      via: String(req.body?.['List-Unsubscribe'] || '') === 'One-Click' ? 'one-click' : 'page',
    }, { merge: true });
    return res.status(200).send(page('Vous êtes désinscrit', `<p>L'adresse <strong>${email.replace(/[<>&"']/g, '')}</strong> ne recevra plus nos emails d'information et d'offres.</p><p>Vous continuerez à recevoir les emails liés à vos rendez-vous et à vos factures.</p>`));
  }

  return res.status(200).send(page('Se désinscrire', `<p>Vous ne souhaitez plus recevoir les emails d'information et d'offres de Makouez IT à l'adresse <strong>${email.replace(/[<>&"']/g, '')}</strong> ?</p>
<form method="POST"><button type="submit">Confirmer la désinscription</button></form>`));
});

module.exports = {
  functions: { unsubscribe },
  unsubscribeUrl, isUnsubscribed, unsubscribedAmong, unsubscribeParts, withFooter, hashId,
};
