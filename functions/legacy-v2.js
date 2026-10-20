const { onDocumentCreated, onDocumentUpdated } = require("firebase-functions/v2/firestore");
const { onRequest } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const admin      = require("firebase-admin");
const nodemailer = require("nodemailer");
const { Resend } = require("resend");
const crypto     = require("crypto");

// ─── Déclaration des secrets Firebase v2 ─────────────────────────────────────
const RESEND_API_KEY_SECRET      = defineSecret("RESEND_API_KEY");
const RESEND_NOIRLAND_KEY_SECRET = defineSecret("RESEND_NOIRLAND_KEY");
const ANTHROPIC_API_KEY_SECRET   = defineSecret("ANTHROPIC_API_KEY");

// ─── Initialisation Firebase (une seule fois) ─────────────────────────────────
admin.initializeApp();
const db = admin.firestore();

const SITE_URL      = "https://makouezit.org";

// ─── Email « intervention terminée » : avis Google + coordonnées ──────────────
const GOOGLE_REVIEW_URL = "https://g.page/r/Cc_MkTWnr_xGEAE/review"; // lien « Laisser un avis » de la fiche Google Makouez IT
const PRO_PHONE         = "07 45 10 38 27";
const PRO_PHONE_TEL     = "+33745103827";
const PRO_EMAIL         = "contact@makouezit.org";
const escHtml = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));

// ─── Resend : lève une erreur si la clé manque ou si l'API refuse l'envoi ─────
// (le SDK Resend RENVOIE { error } au lieu de lever une exception)
function mkResend(key) {
  if (!key) throw new Error("RESEND_API_KEY manquante : secret non branché sur cette fonction");
  const r = new Resend(key);
  const send = r.emails.send.bind(r.emails);
  r.emails.send = async (...args) => {
    const res = await send(...args);
    if (res && res.error) {
      throw new Error("Resend: " + (res.error.message || JSON.stringify(res.error)));
    }
    return res;
  };
  return r;
}

// ─── Transporter nodemailer — lazy pour éviter l'erreur au chargement ─────────
function getTransporter() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });
}

// ─── Tarifs et labels contrats ────────────────────────────────────────────────
// ─── Grille tarifaire : copie de /tarifs.json (copiée au déploiement, voir firebase.json) ───
const TARIFS = (() => {
  try { return require("./tarifs.json"); }
  catch (e) { console.error("tarifs.json introuvable dans functions/ :", e.message); return null; }
})();
const eur = (v) => (v === null || v === undefined ? "sur devis" : `${v} €`);

const CONTRAT_SOURCES = {
  serenite:                  TARIFS?.contrats?.serenite,
  senior:                    TARIFS?.contrats?.senior,
  famille:                   TARIFS?.contrats?.famille,
  "maintenance-essentielle": TARIFS?.maintenanceWeb?.essentielle,
  "maintenance-pro":         TARIFS?.maintenanceWeb?.pro,
  "maintenance-evolution":   TARIFS?.maintenanceWeb?.evolution,
  "pro-essentiel":           TARIFS?.pro?.essentiel,
  "pro-confort":             TARIFS?.pro?.confort,
  "pro-premium":             TARIFS?.pro?.premium,
};
const CONTRAT_LABELS = Object.fromEntries(Object.entries(CONTRAT_SOURCES).filter(([, v]) => v).map(([k, v]) => [k, v.nom]));
const CONTRAT_TARIFS = Object.fromEntries(Object.entries(CONTRAT_SOURCES).filter(([, v]) => v)
  .map(([k, v]) => [k, typeof v.prix === "number" ? `${v.prix}€/mois` : "Sur devis"]));
// Avantages repris à l'identique des cartes de contrats.html
const CONTRAT_FEATURES = {
  serenite: ["2 interventions/mois incluses à domicile", "Priorité de passage (sous 24h)", "Support téléphonique inclus", "Bilan informatique annuel", "Sans engagement"],
  senior:   ["Visites régulières à domicile", "Formation progressive à votre rythme", "Hotline dédiée (lun-sam)", "Protection anti-arnaques", "Sans engagement"],
  famille:  ["3 appareils couverts", "3 interventions/mois incluses", "Contrôle parental inclus", "Support pour tous les membres", "Sans engagement"],
};

// Bloc « tarifs » du prompt du chat, généré depuis la grille pour ne jamais diverger du site.
function tarifsPrompt(t) {
  if (!t) return "TARIFS : indisponibles, inviter le visiteur à consulter la page Tarifs du site ou à appeler le 07 45 10 38 27.";
  const d = t.depannage, sv = t.services, c = t.contrats, w = t.web, m = t.maintenanceWeb, p = t.pro;
  const ap = (x) => `${x.aPartirDe ? "à partir de " : ""}${eur(x.prix)}`;
  return `FORFAITS D'INTERVENTION À DOMICILE (déplacement inclus, paiement après l'intervention) :
- ${d.diagExpress.nom} : ${eur(d.diagExpress.prix)} (${d.diagExpress.duree}) — ${d.diagExpress.detail}
- ${d.standard.nom} : ${eur(d.standard.prix)} (${d.standard.duree}) — ${d.standard.detail}
- ${d.longFormat.nom} : ${eur(d.longFormat.prix)} (${d.longFormat.duree}) — ${d.longFormat.detail}
- Heure supplémentaire : ${eur(d.heureSup.prix)}
- Si le problème ne peut pas être résolu : seul le déplacement est facturé, ${eur(d.deplacementSansSolution.prix)}

PAR SERVICE :
- ${sv.depannagePc.nom} : ${ap(sv.depannagePc)}
- ${sv.installationWindows.nom} : ${ap(sv.installationWindows)} (${sv.installationWindows.note})
- ${sv.reseauWifi.nom} : ${ap(sv.reseauWifi)}
- ${sv.recuperationDonnees.nom} : ${ap(sv.recuperationDonnees)} (${sv.recuperationDonnees.note})
- ${sv.sauvegardeSecurite.nom} : ${ap(sv.sauvegardeSecurite)}
- ${sv.formation.nom} : ${eur(sv.formation.prix)} de l'heure
- Création de site : ${w.essentiel.nom} ${ap(w.essentiel)}, ${w.pro.nom} ${ap(w.pro)}, ${w.applicationWeb.nom} ${ap(w.applicationWeb)} (devis gratuit)

CONTRATS MENSUELS PARTICULIERS (${t.resiliation}) :
- ${c.serenite.nom} : ${eur(c.serenite.prix)}/mois — 2 interventions/mois incluses, priorité 24h, support téléphonique
- ${c.senior.nom} : ${eur(c.senior.prix)}/mois — visites régulières, formation progressive, hotline dédiée
- ${c.famille.nom} : ${eur(c.famille.prix)}/mois — 3 appareils couverts, 3 interventions/mois, contrôle parental

MAINTENANCE DE SITE WEB : ${m.essentielle.nom} ${eur(m.essentielle.prix)}/mois, ${m.pro.nom} ${eur(m.pro.prix)}/mois, ${m.evolution.nom} ${eur(m.evolution.prix)}/mois.

PROFESSIONNELS (HT) : intervention ${eur(p.interventionHeure.prix)}/h, ${p.installationPoste.nom} ${eur(p.installationPoste.prix)}, ${p.auditSecurite.nom} ${eur(p.auditSecurite.prix)}, ${p.essentiel.nom} ${eur(p.essentiel.prix)}/mois, ${p.confort.nom} ${eur(p.confort.prix)}/mois, ${p.premium.nom} ${eur(p.premium.prix)}.

PAIEMENT : ${t.paiement.moyens.join(", ")}. ${t.paiement.moment}.
Aucun crédit d'impôt n'est applicable : ne jamais en promettre.`;
}

// ─── HELPER : formater une date depuis un dateKey ─────────────────────────────
function formatDate(dateKey) {
  const parts = dateKey ? dateKey.split("-") : [];
  return parts.length === 3
    ? new Date(parts[0], parts[1] - 1, parts[2])
        .toLocaleDateString("fr-FR", {
          weekday: "long", day: "numeric", month: "long", year: "numeric"
        })
    : dateKey || "–";
}


// ═══════════════════════════════════════════════════════════════════════════════
// 1. PROXY CLAUDE IA
// ═══════════════════════════════════════════════════════════════════════════════
// ─── Garde-fous anti-abus du chatbot (audit oct. 2026) ───────────────────────
const CHAT_ALLOWED_ORIGINS = ["https://makouezit.org", "https://www.makouezit.org"];
const CHAT_MAX_MESSAGES    = 10;     // messages gardés dans l'historique
const CHAT_MAX_CHARS       = 1000;   // caractères par message
const CHAT_IP_LIMIT        = 20;     // requêtes par IP et par fenêtre de 10 min
const CHAT_DAILY_LIMIT     = 1500;   // requêtes par jour pour tout le site

// Compte une requête dans Firestore (transaction) ; renvoie false si la limite est dépassée.
async function chatRateOk(ip) {
  const now   = new Date();
  const day   = now.toISOString().slice(0, 10);
  const win   = Math.floor(now.getTime() / 600000);            // fenêtre de 10 min
  const ipKey = crypto.createHash("sha256").update(String(ip)).digest("hex").slice(0, 24);
  const refIp  = db.collection("rate_limits").doc(`chat_${ipKey}_${win}`);
  const refDay = db.collection("rate_limits").doc(`chat_day_${day}`);
  const expireAt = admin.firestore.Timestamp.fromMillis(now.getTime() + 2 * 86400000);
  return db.runTransaction(async (tx) => {
    const [a, b] = await Promise.all([tx.get(refIp), tx.get(refDay)]);
    const nIp  = (a.exists ? a.data().n : 0) + 1;
    const nDay = (b.exists ? b.data().n : 0) + 1;
    if (nIp > CHAT_IP_LIMIT || nDay > CHAT_DAILY_LIMIT) return false;
    tx.set(refIp,  { n: nIp,  expireAt });
    tx.set(refDay, { n: nDay, expireAt });
    return true;
  });
}

// Ne garde que des messages user/assistant en texte, bornés en nombre et en taille.
function cleanChatMessages(input) {
  if (!Array.isArray(input) || input.length === 0) return null;
  const out = input.slice(-CHAT_MAX_MESSAGES)
    .filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
    .map((m) => ({ role: m.role, content: m.content.slice(0, CHAT_MAX_CHARS) }))
    .filter((m) => m.content.trim().length > 0);
  while (out.length && out[0].role !== "user") out.shift();   // l'API exige de commencer par « user »
  return out.length ? out : null;
}

exports.claudeProxy = onRequest(
  {
    region: "europe-west1",
    cors: CHAT_ALLOWED_ORIGINS,
    secrets: [ANTHROPIC_API_KEY_SECRET],
    maxInstances: 5,          // plafonne la montée en charge (et donc le coût)
    timeoutSeconds: 30,
  },
  async (req, res) => {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }
    if (!CHAT_ALLOWED_ORIGINS.includes(req.headers.origin || "")) {
      return res.status(403).json({ error: "Origin not allowed" });
    }
    try {
      const messages = cleanChatMessages(req.body && req.body.messages);
      if (!messages) {
        return res.status(400).json({ error: "messages array required" });
      }
      const ip = (req.headers["x-forwarded-for"] || req.ip || "").toString().split(",")[0].trim();
      let allowed = true;
      try { allowed = await chatRateOk(ip); }
      catch (e) { console.error("chatRateOk indisponible (requête laissée passer):", e.message); }
      if (!allowed) {
        return res.status(429).json({ error: "Trop de requêtes, réessayez dans quelques minutes." });
      }
      const SYSTEM_PROMPT = `Tu es l'assistant virtuel de Makouez IT, une entreprise de dépannage informatique à domicile en Île-de-France, fondée par Stevy, technicien informatique avec 9 ans d'expérience.

Ton rôle : répondre aux questions des visiteurs sur les services, tarifs, disponibilités et orienter vers la prise de rendez-vous.

${tarifsPrompt(TARIFS)}

INFOS PRATIQUES :
- Zone : Île-de-France, principalement 93 (Seine-Saint-Denis) — Pierrefitte-sur-Seine, Saint-Denis, Stains, Saint-Ouen et environs
- Délai d'intervention : sous 24h à 48h en général
- Devis gratuit avant de commencer
- Contact : 07 45 10 38 27 | contact@makouezit.org | WhatsApp disponible
- Prise de RDV en ligne sur le site

CONSIGNES :
- Réponds TOUJOURS en français
- Sois chaleureux, clair et concis (3-4 phrases max)
- Si on te demande les tarifs, donne-les clairement et directement
- Si la question concerne un problème technique, donne un conseil rapide puis propose un RDV
- Pour les prix, précise que le tarif exact est confirmé après diagnostic sur place
- Si tu ne sais pas quelque chose, oriente vers le contact direct : 07 45 10 38 27
- Ne promets jamais de disponibilités précises sans confirmation de Stevy`;

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": process.env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01"
        },
        body: JSON.stringify({
          model: "claude-haiku-4-5-20251001",
          max_tokens: 350,
          system: SYSTEM_PROMPT,
          messages: messages
        })
      });

      if (!response.ok) {
        const err = await response.text();
        console.error("Anthropic API error:", response.status, err);
        return res.status(502).json({ error: "Anthropic API error", status: response.status });
      }

      const data  = await response.json();
      const reply = data.content?.[0]?.text || "";
      return res.status(200).json({ reply });

    } catch (err) {
      console.error("claudeProxy error:", err);
      return res.status(500).json({ error: "Internal server error" });
    }
  }
);


// ═══════════════════════════════════════════════════════════════════════════════
// 2. EMAIL À LA CRÉATION D'UNE RÉSERVATION
// ═══════════════════════════════════════════════════════════════════════════════
exports.sendConfirmationEmail = onDocumentCreated(
  { document: "reservations/{reservationId}", region: "europe-west1", secrets: [RESEND_API_KEY_SECRET] },
  async (event) => {
    const data   = event.data.data();
    // Ignorer les réservations Noirland — gérées par noirlandSendConfirmation
    if (data.source === "noirlandmusic.com") return null;
    const resend = mkResend(process.env.RESEND_API_KEY);
    const rdvId  = event.params.reservationId;
    const dateFormatted = formatDate(data.dateKey || data.date);
    const timeLabel     = data.timeLabel || data.time || "–";
    const suiviUrl      = `${SITE_URL}/suivi-rdv.html?id=${rdvId}`;

    // ── Email CLIENT ─────────────────────────────────────────────────────────
    try {
      await resend.emails.send({
        from: "Makouez IT <contact@makouezit.org>",
        to: [data.email],
        subject: `⏳ Votre demande est en attente – Makouez IT (${new Date().toLocaleDateString("fr-FR")})`,
        html: `<!DOCTYPE html><html lang="fr"> <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head> <body style="margin:0;padding:0;background:#09090f;font-family:'Segoe UI',Arial,sans-serif;color:#f0f0ff"> <table width="100%" cellpadding="0" cellspacing="0" style="background:#09090f;padding:40px 20px"> <tr><td align="center"> <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#111120;border:1px solid #ffffff14;border-radius:16px;overflow:hidden"> <tr><td style="background:#16162a;padding:24px 32px;border-bottom:1px solid #ffffff14"> <span style="font-size:20px;font-weight:800;color:#f0f0ff">Makouez <span style="color:#3b82f6">IT</span></span> </td></tr> <tr><td align="center" style="padding:36px 32px 20px"> <div style="font-size:48px">⏳</div> <h1 style="margin:20px 0 8px;font-size:22px;font-weight:700;color:#f0f0ff">Demande bien reçue !</h1> <p style="margin:0;color:#8888aa;font-size:15px"> Bonjour <strong style="color:#f0f0ff">${escHtml(data.nom || data.name)}</strong>, votre demande est bien enregistrée.<br> Elle est <strong style="color:#f59e0b">en attente de confirmation</strong>.<br><br> Stevy reviendra vers vous rapidement. </p> <div style="display:inline-block;margin-top:16px;padding:8px 20px;background:#f59e0b20;border:1px solid #f59e0b40;border-radius:99px;color:#f59e0b;font-size:14px;font-weight:600">⏳ En attente de confirmation</div> </td></tr> <tr><td style="padding:0 32px 32px"> <table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff08;border:1px solid #ffffff14;border-radius:12px;overflow:hidden"> <tr><td style="padding:16px 20px;border-bottom:1px solid #ffffff10"> <span style="color:#8888aa;font-size:13px">🔧 Service</span><br> <span style="color:#f0f0ff;font-size:15px;font-weight:500">${escHtml(data.service)}</span> </td></tr> <tr><td style="padding:16px 20px;border-bottom:1px solid #ffffff10"> <span style="color:#8888aa;font-size:13px">📅 Date</span><br> <span style="color:#f0f0ff;font-size:15px;font-weight:500">${escHtml(dateFormatted)}</span> </td></tr> <tr><td style="padding:16px 20px;border-bottom:1px solid #ffffff10"> <span style="color:#8888aa;font-size:13px">🕐 Plage horaire</span><br> <span style="color:#f0f0ff;font-size:15px;font-weight:500">${escHtml(timeLabel)}</span> </td></tr> <tr><td style="padding:16px 20px;border-bottom:1px solid #ffffff10"> <span style="color:#8888aa;font-size:13px">📍 Adresse</span><br> <span style="color:#f0f0ff;font-size:15px;font-weight:500">${escHtml(data.adresse || "—")}</span> </td></tr> <tr><td style="padding:16px 20px"> <span style="color:#8888aa;font-size:13px">💰 Tarif indicatif</span><br> <span style="color:#3b82f6;font-size:15px;font-weight:600">${escHtml(data.price)}</span> </td></tr> </table> <div style="text-align:center;margin-top:24px"> <a href="${escHtml(suiviUrl)}" style="display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:15px;font-weight:500">→ Suivre ma réservation en temps réel</a> </div> <p style="margin:24px 0 0;text-align:center;color:#8888aa;font-size:12px;line-height:1.6"> Une question ? Répondez à cet email ou contactez directement Stevy.<br> <span style="color:#ffffff30">Makouez IT – Intervention à domicile en Île-de-France</span> </p> </td></tr> </table> </td></tr> </table> </body></html>`
      });
      console.log("✅ Email client envoyé à " + data.email);
    } catch (err) {
      console.error("❌ Erreur email client :", err);
    }

    // ── Notification ADMIN ───────────────────────────────────────────────────
    try {
      await resend.emails.send({
        from: "Makouez IT <contact@makouezit.org>",
        to: [data.adminEmail || "contact@makouezit.org"],
        subject: "🔔 Nouveau RDV – " + (data.nom || data.name) + " – " + dateFormatted,
        html: `<div style="font-family:Arial,sans-serif;max-width:500px;padding:20px"> <h2 style="color:#3b82f6">Nouvelle réservation reçue</h2> <table style="border-collapse:collapse;width:100%"> <tr><td style="padding:8px;color:#666;width:130px">Nom</td><td style="padding:8px;font-weight:bold">${escHtml(data.nom || data.name)}</td></tr> <tr style="background:#f9f9f9"><td style="padding:8px;color:#666">Email</td><td style="padding:8px">${escHtml(data.email)}</td></tr> <tr><td style="padding:8px;color:#666">Téléphone</td><td style="padding:8px">${escHtml(data.telephone || data.phone || "—")}</td></tr> <tr style="background:#f9f9f9"><td style="padding:8px;color:#666">Service</td><td style="padding:8px">${escHtml(data.service)}</td></tr> <tr><td style="padding:8px;color:#666">Date</td><td style="padding:8px">${escHtml(dateFormatted)}</td></tr> <tr style="background:#f9f9f9"><td style="padding:8px;color:#666">Plage horaire</td><td style="padding:8px">${escHtml(timeLabel)}</td></tr> <tr><td style="padding:8px;color:#666">Adresse</td><td style="padding:8px">${escHtml(data.adresse || "—")}</td></tr> <tr style="background:#f9f9f9"><td style="padding:8px;color:#666">Description</td><td style="padding:8px">${escHtml(data.description || "–")}</td></tr> <tr><td style="padding:8px;color:#666">Tarif</td><td style="padding:8px;color:#3b82f6;font-weight:bold">${escHtml(data.price)}</td></tr> </table> <div style="margin-top:16px;text-align:center"> <a href="${SITE_URL}/admin.html" style="display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:500">→ Ouvrir l'espace admin</a> </div> </div>`
      });
      console.log("✅ Notification admin envoyée");
    } catch (err) {
      console.error("❌ Erreur email admin :", err);
    }
  }
);


// ═══════════════════════════════════════════════════════════════════════════════
// 3. EMAIL MISE À JOUR STATUT + DEMANDE D'AVIS
// ═══════════════════════════════════════════════════════════════════════════════
exports.sendStatusUpdateEmail = onDocumentUpdated(
  { document: "reservations/{reservationId}", region: "europe-west1", secrets: [RESEND_API_KEY_SECRET] },
  async (event) => {
    const before = event.data.before.data();
    const after  = event.data.after.data();
    // Ignorer les réservations Noirland — gérées par noirlandSendStatusUpdate
    if (after.source === "noirlandmusic.com") return null;
    const rdvId  = event.params.reservationId;

    if (before.status === after.status && before.modificationNote === after.modificationNote) return null;

    const resend        = mkResend(process.env.RESEND_API_KEY);
    const dateFormatted = formatDate(after.dateKey);
    const timeLabel     = after.timeLabel || after.time || "–";
    const suiviUrl      = `${SITE_URL}/suivi-rdv.html?id=${rdvId}`;
    const avisUrl       = `${SITE_URL}/index.html#avis`;

    // ── Notification admin si modification demandée ───────────────────────
    if (after.modificationNote && before.modificationNote !== after.modificationNote) {
      try {
        await resend.emails.send({
          from: "Makouez IT <contact@makouezit.org>",
          to: ["contact@makouezit.org"],
          subject: `✏️ Modification demandée – ${after.nom} – ${dateFormatted}`,
          html: `<div style="font-family:Arial,sans-serif;max-width:500px;padding:20px"> <h2 style="color:#f59e0b">✏️ Demande de modification de RDV</h2> <table style="border-collapse:collapse;width:100%"> <tr><td style="padding:8px;color:#666;width:130px">Client</td><td style="padding:8px;font-weight:bold">${escHtml(after.nom)}</td></tr> <tr style="background:#f9f9f9"><td style="padding:8px;color:#666">Email</td><td style="padding:8px">${escHtml(after.email)}</td></tr> <tr><td style="padding:8px;color:#666">Téléphone</td><td style="padding:8px">${escHtml(after.telephone)}</td></tr> <tr style="background:#f9f9f9"><td style="padding:8px;color:#666">Service</td><td style="padding:8px">${escHtml(after.service)}</td></tr> <tr><td style="padding:8px;color:#666">Date</td><td style="padding:8px">${escHtml(dateFormatted)}</td></tr> <tr style="background:#fff3cd"><td style="padding:8px;color:#666">Message client</td><td style="padding:8px;font-style:italic;color:#856404">${escHtml(after.modificationNote)}</td></tr> </table> <div style="margin-top:16px;text-align:center"> <a href="${SITE_URL}/admin.html" style="display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-size:14px;font-weight:500">→ Ouvrir l'espace admin</a> </div> </div>`
        });
      } catch (err) {
        console.error("❌ Erreur notification modification :", err);
      }
    }

    if (before.status === after.status) return null;

    // ── Email CLIENT selon statut ─────────────────────────────────────────
    const statusConfig = {
      confirmed: {
        emoji: "🎉", titre: "Rendez-vous confirmé !",
        message: "Bonne nouvelle ! Stevy a confirmé votre intervention.",
        badge: { bg: "#22c55e20", border: "#22c55e40", color: "#22c55e", label: "✓ Confirmé" },
        subject: "🎉 Votre RDV est confirmé – Makouez IT",
      },
      cancelled: {
        emoji: "❌", titre: "Rendez-vous annulé",
        message: "Votre rendez-vous a été annulé. N'hésitez pas à en reprendre un.",
        badge: { bg: "#ef444420", border: "#ef444440", color: "#ef4444", label: "✗ Annulé" },
        subject: "❌ Votre RDV a été annulé – Makouez IT",
      },
      pending: {
        emoji: "⏳", titre: "Rendez-vous en attente",
        message: "Votre rendez-vous est repassé en attente de confirmation.",
        badge: { bg: "#f59e0b20", border: "#f59e0b40", color: "#f59e0b", label: "⏳ En attente" },
        subject: "⏳ Mise à jour de votre RDV – Makouez IT",
      },
      done: {
        emoji: "✅", titre: "Intervention terminée",
        message: "Merci pour votre confiance ! Nous espérons que tout s'est bien passé.",
        badge: { bg: "#22c55e20", border: "#22c55e40", color: "#22c55e", label: "✓ Terminé" },
        subject: "✅ Intervention terminée – Makouez IT",
      },
    };

    const cfg = statusConfig[after.status];
    if (!cfg || !after.email) return null;

    const isDone   = after.status === "done";

    // ── Email « Merci » spécifique au passage en Terminé (envoyé 1 seule fois) ──
    if (isDone) {
      if (after.doneEmailSentAt) {
        console.log("ℹ️ Email « terminé » déjà envoyé pour " + rdvId + ", ignoré");
        return null;
      }
      const prenom      = (after.nom || after.name || "").trim().split(" ")[0];
      const montant     = typeof after.prixReel === "number"
        ? new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(after.prixReel)
        : null;
      const reviewUrl   = GOOGLE_REVIEW_URL || avisUrl;
      const reviewLabel = GOOGLE_REVIEW_URL ? "⭐ Laisser un avis sur Google" : "⭐ Laisser un avis";
      const recapRows   = [
        ["🔧 Intervention", after.service],
        ["📅 Date",         dateFormatted],
        ["🕐 Créneau",      timeLabel],
        ["📍 Lieu",         after.adresse],
        ["💰 Montant",      montant],
      ].filter((r) => r[1] && r[1] !== "–")
       .map((r, i, a) => `<tr><td style="padding:14px 20px;${i < a.length - 1 ? "border-bottom:1px solid #ffffff10" : ""}"><span style="color:#8888aa;font-size:13px">${r[0]}</span><br><span style="color:#f0f0ff;font-size:15px;font-weight:500">${escHtml(r[1])}</span></td></tr>`)
       .join("");

      const doneHtml = `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body style="margin:0;padding:0;background:#09090f;font-family:'Segoe UI',Arial,sans-serif;color:#f0f0ff"><table width="100%" cellpadding="0" cellspacing="0" style="background:#09090f;padding:40px 20px"><tr><td align="center"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#111120;border:1px solid #ffffff14;border-radius:16px;overflow:hidden">
<tr><td style="background:#16162a;padding:24px 32px;border-bottom:1px solid #ffffff14"><span style="font-size:20px;font-weight:800;color:#f0f0ff">Makouez <span style="color:#3b82f6">IT</span></span></td></tr>
<tr><td align="center" style="padding:36px 32px 12px"><div style="font-size:48px">🙏</div><h1 style="margin:18px 0 8px;font-size:22px;font-weight:700;color:#f0f0ff">Merci pour votre confiance${prenom ? ", " + escHtml(prenom) : ""} !</h1>
<p style="margin:0;color:#c8c8d8;font-size:15px;line-height:1.7">Merci de m'avoir contacté et de m'avoir ouvert votre porte. J'espère que tout fonctionne à votre entière satisfaction.</p></td></tr>
<tr><td style="padding:16px 32px 8px"><p style="margin:0 0 10px;color:#8888aa;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Récapitulatif de l'intervention</p>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff08;border:1px solid #ffffff14;border-radius:12px;overflow:hidden">${recapRows}</table></td></tr>
<tr><td style="padding:20px 32px 8px"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f59e0b10;border:1px solid #f59e0b30;border-radius:12px"><tr><td align="center" style="padding:22px 20px">
<p style="margin:0 0 8px;color:#f59e0b;font-size:15px;font-weight:700">⭐ Votre avis compte beaucoup</p>
<p style="margin:0 0 16px;color:#c8c8d8;font-size:14px;line-height:1.6">Si vous êtes satisfait, un avis sur ma fiche Google prend 1 minute et m'aide énormément à me faire connaître.</p>
<a href="${escHtml(reviewUrl)}" style="display:inline-block;background:#f59e0b;color:#111;text-decoration:none;padding:12px 26px;border-radius:10px;font-size:15px;font-weight:700">${reviewLabel}</a></td></tr></table></td></tr>
<tr><td style="padding:12px 32px 8px"><table width="100%" cellpadding="0" cellspacing="0" style="background:#3b82f610;border:1px solid #3b82f640;border-radius:12px"><tr><td style="padding:18px 20px">
<p style="margin:0 0 6px;color:#f0f0ff;font-size:15px;font-weight:700">Un besoin, une question ?</p>
<p style="margin:0 0 10px;color:#c8c8d8;font-size:14px;line-height:1.6">Si quelque chose ne fonctionne plus ou si vous avez un nouveau besoin, n'hésitez pas à me rappeler, je reste disponible.</p>
<p style="margin:0;font-size:14px;line-height:1.9">📞 <a href="tel:${PRO_PHONE_TEL}" style="color:#3b82f6;text-decoration:none">${PRO_PHONE}</a><br>💬 <a href="https://wa.me/${PRO_PHONE_TEL.replace("+", "")}" style="color:#3b82f6;text-decoration:none">WhatsApp</a><br>✉️ <a href="mailto:${PRO_EMAIL}" style="color:#3b82f6;text-decoration:none">${PRO_EMAIL}</a></p></td></tr></table></td></tr>
<tr><td style="padding:12px 32px 28px"><p style="margin:0;color:#c8c8d8;font-size:14px;line-height:1.7">Et si mon travail vous a plu, n'hésitez pas à me recommander autour de vous, à vos proches, voisins ou collègues : le bouche-à-oreille est ma meilleure publicité. Merci d'avance !</p>
<p style="margin:20px 0 0;color:#f0f0ff;font-size:15px;line-height:1.6">À bientôt,<br><strong>Stevy — Makouez IT</strong><br><span style="color:#8888aa;font-size:12px">Intervention informatique à domicile en Île-de-France</span></p></td></tr>
</table></td></tr></table></body></html>`;

      try {
        await resend.emails.send({
          from: "Makouez IT <contact@makouezit.org>",
          to: [after.email],
          subject: "🙏 Merci pour votre confiance – Makouez IT",
          html: doneHtml,
        });
        console.log(`✅ Email « merci / avis » envoyé à ${after.email}`);
        await event.data.after.ref.update({
          doneEmailSentAt: admin.firestore.FieldValue.serverTimestamp(),
        });
      } catch (err) {
        console.error("❌ Erreur email terminé :", err);
      }
      return null;
    }
    const avisBlock = isDone ? `<div style="margin-top:24px;background:#f59e0b10;border:1px solid #f59e0b30;border-radius:12px;padding:20px;text-align:center"> <p style="margin:0 0 12px;color:#f59e0b;font-size:14px;font-weight:600">⭐ Votre avis compte !</p> <p style="margin:0 0 16px;color:#8888aa;font-size:13px">Partagez votre expérience pour aider d'autres clients.</p> <a href="${escHtml(avisUrl)}" style="display:inline-block;background:#f59e0b;color:#fff;text-decoration:none;padding:10px 24px;border-radius:8px;font-size:14px;font-weight:500">Laisser un avis →</a> </div>` : "";

    try {
      await resend.emails.send({
        from: "Makouez IT <contact@makouezit.org>",
        to: [after.email],
        subject: cfg.subject,
        html: `<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head><body style="margin:0;padding:0;background:#09090f;font-family:'Segoe UI',Arial,sans-serif;color:#f0f0ff"><table width="100%" cellpadding="0" cellspacing="0" style="background:#09090f;padding:40px 20px"><tr><td align="center"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#111120;border:1px solid #ffffff14;border-radius:16px;overflow:hidden"><tr><td style="background:#16162a;padding:24px 32px;border-bottom:1px solid #ffffff14"><span style="font-size:20px;font-weight:800;color:#f0f0ff">Makouez <span style="color:#3b82f6">IT</span></span></td></tr><tr><td align="center" style="padding:36px 32px 20px"><div style="font-size:48px">${cfg.emoji}</div><h1 style="margin:20px 0 8px;font-size:22px;font-weight:700;color:#f0f0ff">${cfg.titre}</h1><p style="margin:0;color:#8888aa;font-size:15px">${cfg.message}</p><div style="display:inline-block;margin-top:16px;padding:8px 20px;background:${cfg.badge.bg};border:1px solid ${cfg.badge.border};border-radius:99px;color:${cfg.badge.color};font-size:14px;font-weight:600">${cfg.badge.label}</div></td></tr><tr><td style="padding:0 32px 32px"><table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff08;border:1px solid #ffffff14;border-radius:12px;overflow:hidden"><tr><td style="padding:16px 20px;border-bottom:1px solid #ffffff10"><span style="color:#8888aa;font-size:13px">🔧 Service</span><br><span style="color:#f0f0ff;font-size:15px;font-weight:500">${escHtml(after.service)}</span></td></tr><tr><td style="padding:16px 20px;border-bottom:1px solid #ffffff10"><span style="color:#8888aa;font-size:13px">📅 Date</span><br><span style="color:#f0f0ff;font-size:15px;font-weight:500">${escHtml(dateFormatted)}</span></td></tr><tr><td style="padding:16px 20px"><span style="color:#8888aa;font-size:13px">🕐 Plage horaire</span><br><span style="color:#f0f0ff;font-size:15px;font-weight:500">${escHtml(timeLabel)}</span></td></tr></table><div style="text-align:center;margin-top:24px"><a href="${escHtml(suiviUrl)}" style="display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:15px;font-weight:500">→ Suivre ma réservation</a></div>${avisBlock}</td></tr></table></td></tr></table></body></html>`
      });
      console.log(`✅ Email statut "${after.status}" envoyé à ${after.email}`);
    } catch (err) {
      console.error("❌ Erreur email statut :", err);
    }

    return null;
  }
);


// ═══════════════════════════════════════════════════════════════════════════════
// 4. RENVOI DU LIEN DE SUIVI RDV PAR EMAIL
// ═══════════════════════════════════════════════════════════════════════════════
exports.resendSuiviLink = onRequest(
  { region: "europe-west1", cors: ["https://makouezit.org", "https://www.makouezit.org"], secrets: [RESEND_API_KEY_SECRET] },
  async (req, res) => {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const { email } = req.body;
    if (!email) return res.status(400).json({ error: "Email manquant" });

    try {
      const resend = mkResend(process.env.RESEND_API_KEY);

      const snap = await db.collection("reservations")
        .where("email", "==", email)
        .limit(10)
        .get();

      if (snap.empty) {
        return res.status(404).json({ error: "Aucune reservation trouvee pour cet email" });
      }

      const reservations = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));

      const secret = "makouez-it-suivi-2025";
      const token  = crypto.createHash("sha256")
        .update(email.toLowerCase().trim() + ":" + secret)
        .digest("hex")
        .substring(0, 32);

      const mesDemandesUrl = `${SITE_URL}/mes-demandes.html?email=${encodeURIComponent(email)}&token=${token}`;
      const count          = reservations.length;
      const latest         = reservations[0];
      const dateFormatted  = formatDate(latest.dateKey);
      const timeLabel      = latest.timeLabel || latest.time || "–";

      await resend.emails.send({
        from: "Makouez IT <contact@makouezit.org>",
        to: [email],
        subject: `Vos demandes Makouez IT – ${new Date().toLocaleDateString("fr-FR")}`,
        html: `<!DOCTYPE html><html lang="fr"> <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head> <body style="margin:0;padding:0;background:#09090f;font-family:'Segoe UI',Arial,sans-serif;color:#f0f0ff"> <table width="100%" cellpadding="0" cellspacing="0" style="background:#09090f;padding:40px 20px"> <tr><td align="center"> <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#111120;border:1px solid #ffffff14;border-radius:16px;overflow:hidden"> <tr><td style="background:#16162a;padding:24px 32px;border-bottom:1px solid #ffffff14"> <span style="font-size:20px;font-weight:800;color:#f0f0ff">Makouez <span style="color:#3b82f6">IT</span></span> </td></tr> <tr><td align="center" style="padding:36px 32px 20px"> <div style="font-size:48px">📋</div> <h1 style="margin:20px 0 8px;font-size:22px;font-weight:700;color:#f0f0ff">Vos demandes</h1> <p style="margin:0;color:#8888aa;font-size:15px"> Nous avons trouvé <strong style="color:#f0f0ff">${count} demande${count > 1 ? "s" : ""}</strong> associée${count > 1 ? "s" : ""} à votre email. </p> </td></tr> <tr><td style="padding:0 32px 16px"> <table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff08;border:1px solid #ffffff14;border-radius:12px;overflow:hidden"> <tr><td style="padding:16px 20px;border-bottom:1px solid #ffffff10"> <span style="color:#8888aa;font-size:13px">Dernière demande — Service</span><br> <span style="color:#f0f0ff;font-size:15px;font-weight:500">${escHtml(latest.service || "–")}</span> </td></tr> <tr><td style="padding:16px 20px;border-bottom:1px solid #ffffff10"> <span style="color:#8888aa;font-size:13px">Date</span><br> <span style="color:#f0f0ff;font-size:15px;font-weight:500">${escHtml(dateFormatted)}</span> </td></tr> <tr><td style="padding:16px 20px"> <span style="color:#8888aa;font-size:13px">Plage horaire</span><br> <span style="color:#f0f0ff;font-size:15px;font-weight:500">${escHtml(timeLabel)}</span> </td></tr> </table> </td></tr> <tr><td style="padding:8px 32px 36px;text-align:center"> <a href="${escHtml(mesDemandesUrl)}" style="display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:15px;font-weight:500"> Voir mes ${count} demande${count > 1 ? "s" : ""} → </a> <p style="margin:16px 0 0;color:#8888aa;font-size:12px">Ce lien est personnel. Ne le partagez pas.</p> </td></tr> </table> </td></tr> </table> </body></html>`
      });

      console.log(`Email mes-demandes envoyé à ${email} — ${count} réservation(s)`);
      return res.status(200).json({ success: true, count: reservations.length });

    } catch (e) {
      console.error("resendSuiviLink error:", e);
      return res.status(500).json({ error: e.message });
    }
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// 5. EMAIL CONFIRMATION SOUSCRIPTION CONTRAT — via Resend (comme les RDV)
// ═══════════════════════════════════════════════════════════════════════════════
exports.sendContratConfirmation = onDocumentCreated(
  { document: "contrats/{contratId}", region: "europe-west1", secrets: [RESEND_API_KEY_SECRET] },
  async (event) => {
    const data      = event.data.data();
    const contratId = event.params.contratId;

    const nom      = data.nom     || "Client";
    const email    = data.email   || null;
    const contrat  = data.contrat || "serenite";
    const prenom   = nom.split(" ")[0];

    const label    = CONTRAT_LABELS[contrat]   || contrat;
    const tarif    = CONTRAT_TARIFS[contrat]   || "–";
    const features = CONTRAT_FEATURES[contrat] || [];
    const lienSuivi = `https://makouezit.org/suivi-contrat.html?id=${contratId}`;

    if (!email) {
      console.log("Pas d'email pour le contrat", contratId);
      return null;
    }

    // Utilise Resend comme les autres fonctions du projet
    const resend = mkResend(process.env.RESEND_API_KEY);

    const htmlClient = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#09090f;font-family:'DM Sans',Arial,sans-serif;color:#f0f0ff">
<div style="max-width:560px;margin:0 auto;padding:2rem 1rem">
  <div style="text-align:center;padding:2rem;background:#111120;border:1px solid #ffffff14;border-radius:16px;margin-bottom:1.5rem">
    <div style="font-size:1.4rem;font-weight:800;margin-bottom:0.5rem">Makouez <span style="color:#3b82f6">IT</span></div>
    <div style="color:#8888aa;font-size:0.85rem">Technicien informatique à domicile · Île-de-France</div>
  </div>
  <div style="background:#111120;border:1px solid #ffffff14;border-radius:16px;padding:2rem;margin-bottom:1.5rem">
    <div style="font-size:2rem;margin-bottom:1rem;text-align:center">✅</div>
    <h1 style="font-size:1.3rem;font-weight:700;margin:0 0 0.75rem;text-align:center">Demande bien reçue, ${escHtml(prenom)} !</h1>
    <p style="color:#8888aa;font-size:0.9rem;line-height:1.6;margin:0 0 1.5rem;text-align:center">
      Stevy a bien reçu votre demande de souscription au <strong style="color:#f0f0ff">${escHtml(label)}</strong>.<br>
      Il vous contactera sous <strong style="color:#3b82f6">24h</strong> pour finaliser votre contrat.
    </p>
    <div style="background:#16162a;border:1px solid #ffffff14;border-radius:12px;padding:1.25rem;margin-bottom:1.5rem">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:1rem;flex-wrap:wrap;gap:0.5rem">
        <div style="font-weight:700">${escHtml(label)}</div>
        <div style="color:#3b82f6;font-weight:700;font-size:1.1rem">${escHtml(tarif)}</div>
      </div>
      ${features.map(f => `<div style="font-size:0.88rem;color:#8888aa;margin-bottom:0.35rem">✓ ${f}</div>`).join("")}
    </div>
    <div style="text-align:center;margin-bottom:1rem">
      <p style="color:#8888aa;font-size:0.85rem;margin-bottom:1rem">Suivez l'état de votre demande en temps réel :</p>
      <a href="${escHtml(lienSuivi)}" style="display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;padding:0.85rem 2rem;border-radius:10px;font-weight:500;font-size:0.95rem">Suivre ma demande →</a>
    </div>
    <p style="color:#8888aa;font-size:0.78rem;text-align:center;margin:0">
      Conservez ce lien pour suivre l'évolution de votre contrat.<br>
      Vous pouvez aussi créer un espace client sur <a href="https://makouezit.org/mon-rdv.html" style="color:#60a5fa">makouezit.org</a>
    </p>
  </div>
  <div style="background:#111120;border:1px solid #ffffff14;border-radius:12px;padding:1.25rem;margin-bottom:1.5rem;text-align:center">
    <p style="color:#8888aa;font-size:0.85rem;margin:0 0 0.75rem">Une question urgente ?</p>
    <div style="display:flex;gap:0.75rem;justify-content:center;flex-wrap:wrap">
      <a href="tel:+336745103827" style="color:#f0f0ff;text-decoration:none;font-size:0.85rem;font-weight:500">📞 07 45 10 38 27</a>
      <a href="https://wa.me/33745103827" style="color:#f0f0ff;text-decoration:none;font-size:0.85rem;font-weight:500">💬 WhatsApp</a>
    </div>
  </div>
  <div style="text-align:center;color:#8888aa;font-size:0.75rem;padding:1rem 0">
    <div>Makouez IT · Stevy · Pierrefitte-sur-Seine (93)</div>
    <div style="margin-top:0.3rem">SIRET : 83955229600023</div>
    <div style="margin-top:0.5rem"><a href="https://makouezit.org" style="color:#60a5fa;text-decoration:none">makouezit.org</a></div>
  </div>
</div>
</body>
</html>`;

    const htmlAdmin = `
<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#09090f;font-family:Arial,sans-serif;color:#f0f0ff">
<div style="max-width:500px;margin:0 auto;padding:1.5rem">
  <div style="background:#a855f718;border:1px solid #a855f740;border-radius:12px;padding:1.5rem;margin-bottom:1rem">
    <h2 style="margin:0 0 1rem;color:#a855f7;font-size:1.1rem">🆕 Nouvelle demande de contrat</h2>
    <table style="width:100%;font-size:0.88rem;border-collapse:collapse">
      <tr><td style="color:#8888aa;padding:0.3rem 0;width:40%">Contrat</td><td style="font-weight:700;color:#a855f7">${escHtml(label)} — ${escHtml(tarif)}</td></tr>
      <tr><td style="color:#8888aa;padding:0.3rem 0">Nom</td><td>${escHtml(data.nom || "–")}</td></tr>
      <tr><td style="color:#8888aa;padding:0.3rem 0">Email</td><td><a href="mailto:${escHtml(email)}" style="color:#60a5fa">${escHtml(email)}</a></td></tr>
      <tr><td style="color:#8888aa;padding:0.3rem 0">Téléphone</td><td><a href="tel:${escHtml(data.telephone || data.phone || "—")}" style="color:#60a5fa">${escHtml(data.telephone || "–")}</a></td></tr>
      <tr><td style="color:#8888aa;padding:0.3rem 0">Adresse</td><td>${escHtml(data.adresse || "–")}</td></tr>
      ${data.note ? `<tr><td style="color:#8888aa;padding:0.3rem 0">Message</td><td style="font-style:italic">${escHtml(data.note)}</td></tr>` : ""}
    </table>
  </div>
  <div style="text-align:center">
    <a href="https://makouezit.org/admin.html" style="display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;padding:0.75rem 1.5rem;border-radius:10px;font-size:0.9rem;font-weight:500">Gérer dans l'admin →</a>
  </div>
</div>
</body>
</html>`;

    // ── Email CLIENT via Resend ──
    try {
      await resend.emails.send({
        from: "Makouez IT <contact@makouezit.org>",
        to: [email],
        subject: `✅ Votre demande de ${label} a bien été reçue – Makouez IT`,
        html: htmlClient,
      });
      console.log(`✅ Email client contrat envoyé à ${email}`);
    } catch (err) {
      console.error("❌ Erreur email client contrat :", err);
    }

    // ── Notification ADMIN via Resend ──
    try {
      await resend.emails.send({
        from: "Makouez IT <contact@makouezit.org>",
        to: ["contact@makouezit.org"],
        subject: `🆕 Nouvelle souscription : ${label} – ${nom}`,
        html: htmlAdmin,
      });
      console.log(`✅ Email admin contrat envoyé`);
    } catch (err) {
      console.error("❌ Erreur email admin contrat :", err);
    }

    console.log(`✅ Traitement contrat ${contratId} (${label}) terminé`);
    return null;
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// 6. RENVOI DU LIEN DE SUIVI CONTRAT
// ═══════════════════════════════════════════════════════════════════════════════
exports.resendContratLink = onRequest(
  { region: "europe-west1", cors: ["https://makouezit.org", "https://www.makouezit.org"] },
  async (req, res) => {
    if (req.method !== "POST") { res.status(405).json({ error: "Méthode non autorisée" }); return; }

    const { email } = req.body;
    if (!email) { res.status(400).json({ error: "Email requis" }); return; }

    const snap = await db.collection("contrats")
      .where("email", "==", email.toLowerCase().trim())
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();

    if (snap.empty) { res.status(404).json({ error: "Aucun contrat trouvé" }); return; }

    const docSnap = snap.docs[0];
    const data    = docSnap.data();
    const lien    = `https://makouezit.org/suivi-contrat.html?id=${docSnap.id}`;
    const label   = CONTRAT_LABELS[data.contrat] || data.contrat;

    const transporter = getTransporter();
    await transporter.sendMail({
      from:    `"Makouez IT" <${process.env.EMAIL_USER}>`,
      to:      email,
      subject: `🔍 Votre lien de suivi – ${label} – Makouez IT`,
      html: `
        <div style="font-family:Arial,sans-serif;max-width:500px;margin:0 auto;padding:2rem;background:#09090f;color:#f0f0ff;border-radius:12px">
          <h2 style="color:#3b82f6">Makouez IT</h2>
          <p>Voici votre lien de suivi pour votre <strong>${escHtml(label)}</strong> :</p>
          <div style="text-align:center;margin:1.5rem 0">
            <a href="${escHtml(lien)}" style="background:#3b82f6;color:#fff;padding:0.85rem 2rem;border-radius:10px;text-decoration:none;font-weight:500">Suivre ma demande →</a>
          </div>
          <p style="color:#8888aa;font-size:0.82rem">Si vous n'avez pas demandé ce lien, ignorez cet email.</p>
        </div>`,
    });

    res.json({ success: true });
  }
);


// ═══════════════════════════════════════════════════════════════════════════════
// NOIRLAND MUSIC — RÉSERVATIONS STUDIO
// ═══════════════════════════════════════════════════════════════════════════════

const NOIRLAND_URL = "https://www.noirlandmusic.com";

// 7. EMAIL CONFIRMATION RÉSERVATION NOIRLAND
exports.noirlandSendConfirmation = onDocumentCreated(
  { document: "reservations/{reservationId}", region: "europe-west1", database: "(default)", secrets: [RESEND_NOIRLAND_KEY_SECRET] },
  async (event) => {
    const data = event.data.data();
    if (data.source !== "noirlandmusic.com") return null;

    const keyVal = RESEND_NOIRLAND_KEY_SECRET.value();
    if (!keyVal) { console.error("❌ Secret RESEND_NOIRLAND_KEY manquant !"); return null; }
    const resend  = new Resend(keyVal);
    const rdvId   = event.params.reservationId;
    const service = data.service || "–";
    const date    = data.date || "–";
    const time    = data.time || "–";
    const name    = data.name || data.nom || "Artiste";
    const email   = data.email || null;
    const confirmUrl = `${NOIRLAND_URL}/confirmation.html?id=${rdvId}`;

    if (!email) {
      console.log("Noirland: pas d'email pour", rdvId);
      return null;
    }

    // ── Email CLIENT ──────────────────────────────────────────────────────────
    try {
      await resend.emails.send({
        from: "Noirland Music <noreply@noirlandmusic.com>",
        to: [email],
        subject: `[Noirland Music] Demande de session reçue`,
        html: `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:#080808;font-family:'DM Sans',Arial,sans-serif;color:#f5f5f0">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#080808;padding:40px 20px">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">

  <!-- HEADER -->
  <tr><td style="background:#0e0e0c;border:1px solid #1c1c1a;border-bottom:none;padding:24px 32px;display:flex;align-items:center;gap:12px">
    <div style="display:inline-block;width:36px;height:36px;background:#f5f5f0;text-align:center;line-height:36px;font-family:'Bebas Neue',Arial,sans-serif;font-size:1rem;color:#080808;letter-spacing:0.05em;vertical-align:middle">NL</div>
    <span style="font-family:'Bebas Neue',Arial,sans-serif;font-size:1.1rem;letter-spacing:0.12em;color:#f5f5f0;vertical-align:middle;margin-left:10px">NOIRLAND <span style="color:#888882">MUSIC</span></span>
  </td></tr>

  <!-- BODY -->
  <tr><td style="background:#111110;border:1px solid #1c1c1a;border-top:none;padding:36px 32px">

    <p style="font-family:'Bebas Neue',Arial,sans-serif;font-size:2.5rem;letter-spacing:0.05em;color:#f5f5f0;margin:0 0 8px;line-height:1">DEMANDE REÇUE</p>
    <p style="font-family:monospace;font-size:0.72rem;color:#888882;letter-spacing:0.15em;text-transform:uppercase;margin:0 0 28px">Session · CCRecords Studio</p>

    <p style="font-size:0.95rem;color:#c8c8c0;line-height:1.7;margin:0 0 28px">
      Yo <strong style="color:#f5f5f0">${escHtml(name)}</strong>, ta demande est bien enregistrée.<br>
      On te confirme le créneau sous <strong style="color:#f5f5f0">24h</strong>.
    </p>

    <!-- DETAILS -->
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #1c1c1a;margin-bottom:28px">
      <tr><td style="background:#0e0e0c;padding:12px 20px;border-bottom:1px solid #1c1c1a">
        <span style="font-family:monospace;font-size:0.65rem;color:#888882;letter-spacing:0.15em;text-transform:uppercase">Service</span><br>
        <span style="font-size:0.9rem;color:#f5f5f0;margin-top:4px;display:block">${escHtml(service)}</span>
      </td></tr>
      <tr><td style="background:#080808;padding:12px 20px;border-bottom:1px solid #1c1c1a">
        <span style="font-family:monospace;font-size:0.65rem;color:#888882;letter-spacing:0.15em;text-transform:uppercase">Date</span><br>
        <span style="font-size:0.9rem;color:#f5f5f0;margin-top:4px;display:block">${escHtml(date)}</span>
      </td></tr>
      <tr><td style="background:#0e0e0c;padding:12px 20px;border-bottom:1px solid #1c1c1a">
        <span style="font-family:monospace;font-size:0.65rem;color:#888882;letter-spacing:0.15em;text-transform:uppercase">Créneau</span><br>
        <span style="font-size:0.9rem;color:#f5f5f0;margin-top:4px;display:block">${escHtml(time)}</span>
      </td></tr>
      <tr><td style="background:#080808;padding:12px 20px">
        <span style="font-family:monospace;font-size:0.65rem;color:#888882;letter-spacing:0.15em;text-transform:uppercase">Durée</span><br>
        <span style="font-size:0.9rem;color:#f5f5f0;margin-top:4px;display:block">${escHtml(data.duration || '–')}</span>
      </td></tr>
    </table>

    <!-- CTA -->
    <div style="text-align:center;margin-bottom:28px">
      <a href="${escHtml(confirmUrl)}" style="display:inline-block;background:#f5f5f0;color:#080808;text-decoration:none;padding:14px 32px;font-family:monospace;font-size:0.72rem;letter-spacing:0.15em;text-transform:uppercase;font-weight:bold">
        SUIVRE MA SESSION →
      </a>
    </div>

    <p style="font-family:monospace;font-size:0.65rem;color:#444440;text-align:center;letter-spacing:0.1em;text-transform:uppercase;margin:0">
      Noirland Music · CCRecords Studio · Paris
    </p>

  </td></tr>

</table>
</td></tr>
</table>
</body></html>`
      });
      console.log("✅ Noirland: email client envoyé à " + email);
    } catch (err) {
      console.error("❌ Noirland: erreur email client:", err);
    }

    // ── Notification ADMIN ────────────────────────────────────────────────────
    try {
      await resend.emails.send({
        from: "Noirland Music <noreply@noirlandmusic.com>",
        to: ["noirlandmusic@gmail.com"],
        subject: `[Noirland] Nouvelle session — ${name} — ${date}`,
        html: `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#080808;font-family:'DM Sans',Arial,sans-serif;color:#f5f5f0">
<div style="max-width:520px;margin:0 auto;padding:32px 20px">

  <div style="background:#0e0e0c;border:1px solid #1c1c1a;padding:20px 24px;margin-bottom:1px;display:flex;align-items:center;gap:10px">
    <div style="width:30px;height:30px;background:#f5f5f0;text-align:center;line-height:30px;font-size:0.8rem;color:#080808;font-weight:bold">NL</div>
    <span style="font-size:0.85rem;letter-spacing:0.1em;color:#f5f5f0;margin-left:8px">NOIRLAND MUSIC · NOUVELLE SESSION</span>
  </div>

  <div style="background:#111110;border:1px solid #1c1c1a;border-top:none;padding:24px">

    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:0.85rem;border-collapse:collapse">
      <tr><td style="color:#888882;padding:8px 0;width:110px;font-family:monospace;font-size:0.65rem;letter-spacing:0.1em;text-transform:uppercase;border-bottom:1px solid #1c1c1a">Nom</td><td style="padding:8px 0;font-weight:bold;color:#f5f5f0;border-bottom:1px solid #1c1c1a">${escHtml(name)}</td></tr>
      <tr><td style="color:#888882;padding:8px 0;font-family:monospace;font-size:0.65rem;letter-spacing:0.1em;text-transform:uppercase;border-bottom:1px solid #1c1c1a">Email</td><td style="padding:8px 0;color:#f5f5f0;border-bottom:1px solid #1c1c1a">${escHtml(email)}</td></tr>
      <tr><td style="color:#888882;padding:8px 0;font-family:monospace;font-size:0.65rem;letter-spacing:0.1em;text-transform:uppercase;border-bottom:1px solid #1c1c1a">Téléphone</td><td style="padding:8px 0;color:#f5f5f0;border-bottom:1px solid #1c1c1a">${escHtml(data.phone || '–')}</td></tr>
      <tr><td style="color:#888882;padding:8px 0;font-family:monospace;font-size:0.65rem;letter-spacing:0.1em;text-transform:uppercase;border-bottom:1px solid #1c1c1a">Service</td><td style="padding:8px 0;color:#f5f5f0;border-bottom:1px solid #1c1c1a">${escHtml(service)}</td></tr>
      <tr><td style="color:#888882;padding:8px 0;font-family:monospace;font-size:0.65rem;letter-spacing:0.1em;text-transform:uppercase;border-bottom:1px solid #1c1c1a">Date</td><td style="padding:8px 0;color:#f5f5f0;border-bottom:1px solid #1c1c1a">${escHtml(date)}</td></tr>
      <tr><td style="color:#888882;padding:8px 0;font-family:monospace;font-size:0.65rem;letter-spacing:0.1em;text-transform:uppercase;border-bottom:1px solid #1c1c1a">Créneau</td><td style="padding:8px 0;color:#f5f5f0;border-bottom:1px solid #1c1c1a">${escHtml(time)}</td></tr>
      <tr><td style="color:#888882;padding:8px 0;font-family:monospace;font-size:0.65rem;letter-spacing:0.1em;text-transform:uppercase;border-bottom:1px solid #1c1c1a">Durée</td><td style="padding:8px 0;color:#f5f5f0;border-bottom:1px solid #1c1c1a">${escHtml(data.duration || '–')}</td></tr>
      <tr><td style="color:#888882;padding:8px 0;font-family:monospace;font-size:0.65rem;letter-spacing:0.1em;text-transform:uppercase;border-bottom:1px solid #1c1c1a">Artistes</td><td style="padding:8px 0;color:#f5f5f0;border-bottom:1px solid #1c1c1a">${escHtml(data.artists || '–')}</td></tr>
      <tr><td style="color:#888882;padding:8px 0;font-family:monospace;font-size:0.65rem;letter-spacing:0.1em;text-transform:uppercase">Projet</td><td style="padding:8px 0;color:#f5f5f0">${escHtml(data.project || '–')}</td></tr>
    </table>

    <div style="text-align:center;margin-top:24px">
      <a href="${NOIRLAND_URL}/admin.html" style="display:inline-block;background:#f5f5f0;color:#080808;text-decoration:none;padding:12px 28px;font-family:monospace;font-size:0.68rem;letter-spacing:0.15em;text-transform:uppercase;font-weight:bold">
        OUVRIR L'ADMIN →
      </a>
    </div>

  </div>

  <p style="font-family:monospace;font-size:0.6rem;color:#444440;text-align:center;letter-spacing:0.08em;margin-top:16px;text-transform:uppercase">
    Noirland Music · Notification automatique
  </p>
</div>
</body></html>`
      });
      console.log("✅ Noirland: notif admin envoyée");
    } catch (err) {
      console.error("❌ Noirland: erreur email admin:", err);
    }

    return null;
  }
);

// 8. EMAIL MISE À JOUR STATUT RÉSERVATION NOIRLAND
exports.noirlandSendStatusUpdate = onDocumentUpdated(
  { document: "reservations/{reservationId}", region: "europe-west1", secrets: [RESEND_NOIRLAND_KEY_SECRET] },
  async (event) => {
    const before = event.data.before.data();
    const after  = event.data.after.data();

    if (after.source !== "noirlandmusic.com") return null;
    if (before.status === after.status) return null;

    const resend = new Resend(RESEND_NOIRLAND_KEY_SECRET.value());
    const email  = after.email;
    if (!email) return null;

    const name    = after.name || after.nom || "Artiste";
    const service = after.service || "–";
    const date    = after.date || "–";
    const time    = after.time || "–";
    const rdvId   = event.params.reservationId;
    const confirmUrl = `${NOIRLAND_URL}/confirmation.html?id=${rdvId}`;

    const statusLabels = {
      confirmed: { subject: "✅ Session confirmée – Noirland Music × CCRecords Studio" },
      cancelled: { subject: "Session annulée – Noirland Music" },
      pending:   { subject: "Session en attente – Noirland Music" },
      done:      { subject: "Session terminée – Noirland Music" },
    };
    const cfg = statusLabels[after.status];
    if (!cfg) return null;

    const isConfirmed = after.status === "confirmed";
    const isCancelled = after.status === "cancelled";
    const isDone      = after.status === "done";

    const dateDisplay = (() => {
      if (!date || date === "–") return date;
      try {
        const parts = date.split("-");
        return new Date(parseInt(parts[0]), parseInt(parts[1])-1, parseInt(parts[2]))
          .toLocaleDateString("fr-FR", { weekday:"long", day:"numeric", month:"long", year:"numeric" });
      } catch(e) { return date; }
    })();

    const htmlConfirmed = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:#080808;font-family:'DM Sans',Arial,sans-serif;color:#f5f5f0">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#080808;padding:32px 16px">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px">
  <tr><td style="background:#0e0e0c;border:1px solid #1c1c1a;border-bottom:none;padding:18px 28px">
    <div style="display:inline-block;width:32px;height:32px;background:#f5f5f0;text-align:center;line-height:32px;font-family:'Bebas Neue',Arial,sans-serif;font-size:0.85rem;color:#080808;vertical-align:middle">NL</div>
    <span style="font-family:'Bebas Neue',Arial,sans-serif;font-size:1rem;letter-spacing:0.12em;color:#f5f5f0;vertical-align:middle;margin-left:10px">NOIRLAND MUSIC</span>
    <span style="font-family:monospace;font-size:0.6rem;color:#444440;letter-spacing:0.1em;margin-left:8px;vertical-align:middle">× CCRECORDS STUDIO</span>
  </td></tr>
  <tr><td style="background:#111110;border:1px solid #1c1c1a;border-top:none;border-bottom:none;padding:36px 28px 20px;text-align:center">
    <div style="font-size:2.8rem;margin-bottom:10px">🎙️</div>
    <p style="font-family:'Bebas Neue',Arial,sans-serif;font-size:2.2rem;letter-spacing:0.08em;color:#4ade80;margin:0 0 6px;line-height:1">SESSION CONFIRMÉE ✓</p>
    <p style="font-family:monospace;font-size:0.68rem;color:#888882;letter-spacing:0.15em;text-transform:uppercase;margin:0">On t'attend au studio !</p>
  </td></tr>
  <tr><td style="background:#111110;border-left:1px solid #1c1c1a;border-right:1px solid #1c1c1a;padding:0 28px 20px">
    <p style="font-size:0.95rem;color:#c8c8c0;line-height:1.75;margin:0">
      Yo <strong style="color:#f5f5f0">${escHtml(name)}</strong> 🏴<br><br>
      Ta session est <strong style="color:#4ade80">officiellement confirmée</strong>. Voici tout ce qu'il te faut pour préparer ta venue au studio.
    </p>
  </td></tr>
  <tr><td style="background:#111110;border-left:1px solid #1c1c1a;border-right:1px solid #1c1c1a;padding:0 28px 20px">
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #1c1c1a">
      <tr><td style="background:#0e0e0c;padding:12px 18px;border-bottom:1px solid #1c1c1a">
        <span style="font-family:monospace;font-size:0.6rem;color:#888882;letter-spacing:0.15em;text-transform:uppercase">🎵 Service</span><br>
        <span style="font-size:0.95rem;color:#f5f5f0;margin-top:4px;display:block;font-weight:500">${escHtml(service)}</span>
      </td></tr>
      <tr><td style="background:#080808;padding:12px 18px;border-bottom:1px solid #1c1c1a">
        <span style="font-family:monospace;font-size:0.6rem;color:#888882;letter-spacing:0.15em;text-transform:uppercase">📅 Date</span><br>
        <span style="font-size:0.95rem;color:#f5f5f0;margin-top:4px;display:block;font-weight:600">${escHtml(dateDisplay)}</span>
      </td></tr>
      <tr><td style="background:#0e0e0c;padding:12px 18px;border-bottom:1px solid #1c1c1a">
        <span style="font-family:monospace;font-size:0.6rem;color:#888882;letter-spacing:0.15em;text-transform:uppercase">🕐 Heure de début</span><br>
        <span style="font-size:1rem;color:#4ade80;margin-top:4px;display:block;font-weight:700">${escHtml(time)}</span>
      </td></tr>
      <tr><td style="background:#080808;padding:12px 18px">
        <span style="font-family:monospace;font-size:0.6rem;color:#888882;letter-spacing:0.15em;text-transform:uppercase">⏱ Durée</span><br>
        <span style="font-size:0.95rem;color:#f5f5f0;margin-top:4px;display:block">${escHtml(after.duration || "–")} heure(s)</span>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="background:#111110;border-left:1px solid #1c1c1a;border-right:1px solid #1c1c1a;padding:0 28px 20px">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#071207;border:1px solid #1a381a">
      <tr><td style="padding:16px 18px;border-bottom:1px solid #1a381a">
        <p style="font-family:monospace;font-size:0.6rem;color:#4ade80;letter-spacing:0.15em;text-transform:uppercase;margin:0 0 12px">📍 ADRESSE DU STUDIO</p>
        <p style="font-size:1rem;font-weight:700;color:#f5f5f0;margin:0 0 4px">CCRecords Studio</p>
        <p style="font-size:0.9rem;color:#c8c8c0;margin:0 0 14px;line-height:1.5">76 rue du Ruisseau<br><strong>75018 Paris</strong></p>
        <a href="https://maps.google.com/?q=76+rue+du+Ruisseau+75018+Paris" target="_blank"
           style="display:inline-block;background:#4ade80;color:#080808;text-decoration:none;padding:8px 18px;font-family:monospace;font-size:0.62rem;letter-spacing:0.1em;text-transform:uppercase;font-weight:700">
          Ouvrir dans Google Maps →
        </a>
      </td></tr>
      <tr><td style="padding:16px 18px;border-bottom:1px solid #1a381a">
        <p style="font-family:monospace;font-size:0.6rem;color:#4ade80;letter-spacing:0.15em;text-transform:uppercase;margin:0 0 12px">🚇 TRANSPORTS EN COMMUN</p>
        <table cellpadding="0" cellspacing="0" style="width:100%">
          <tr>
            <td style="padding:4px 0;vertical-align:middle;width:90px">
              <span style="display:inline-block;background:#003e9c;color:#fff;font-size:0.62rem;font-weight:700;padding:3px 8px;border-radius:10px;font-family:monospace">M 13</span>
            </td>
            <td style="padding:4px 0">
              <span style="font-size:0.85rem;color:#c8c8c0"><strong style="color:#f5f5f0">Guy Môquet</strong> — 4 min à pied</span>
            </td>
          </tr>
          <tr>
            <td style="padding:4px 0;vertical-align:middle">
              <span style="display:inline-block;background:#003e9c;color:#fff;font-size:0.62rem;font-weight:700;padding:3px 8px;border-radius:10px;font-family:monospace">M 13</span>
            </td>
            <td style="padding:4px 0">
              <span style="font-size:0.85rem;color:#c8c8c0"><strong style="color:#f5f5f0">La Fourche</strong> — 6 min à pied</span>
            </td>
          </tr>
          <tr>
            <td style="padding:4px 0;vertical-align:middle">
              <span style="display:inline-block;background:#003e9c;color:#fff;font-size:0.62rem;font-weight:700;padding:3px 8px;border-radius:10px;font-family:monospace">M 2</span>
            </td>
            <td style="padding:4px 0">
              <span style="font-size:0.85rem;color:#c8c8c0"><strong style="color:#f5f5f0">Place de Clichy</strong> — 10 min à pied</span>
            </td>
          </tr>
          <tr>
            <td style="padding:4px 0;vertical-align:middle">
              <span style="display:inline-block;background:#f5a623;color:#080808;font-size:0.62rem;font-weight:700;padding:3px 8px;border-radius:10px;font-family:monospace">Bus 95</span>
            </td>
            <td style="padding:4px 0">
              <span style="font-size:0.85rem;color:#c8c8c0"><strong style="color:#f5f5f0">Arrêt Ruisseau</strong> — devant le studio</span>
            </td>
          </tr>
        </table>
      </td></tr>
      <tr><td style="padding:16px 18px">
        <p style="font-family:monospace;font-size:0.6rem;color:#4ade80;letter-spacing:0.15em;text-transform:uppercase;margin:0 0 8px">🚗 EN VOITURE</p>
        <p style="font-size:0.85rem;color:#c8c8c0;line-height:1.65;margin:0">
          Stationnement possible <strong style="color:#f5f5f0">rue du Ruisseau</strong> et rues adjacentes.<br>
          <span style="color:#666660;font-size:0.78rem">Vérifier les horaires de stationnement.</span>
        </p>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="background:#111110;border-left:1px solid #1c1c1a;border-right:1px solid #1c1c1a;padding:0 28px 20px">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#0e0e0c;border:1px solid #1c1c1a">
      <tr><td style="padding:16px 18px">
        <p style="font-family:monospace;font-size:0.6rem;color:#888882;letter-spacing:0.15em;text-transform:uppercase;margin:0 0 12px">💡 PRÉPARE TA SESSION</p>
        <table cellpadding="0" cellspacing="0">
          <tr><td style="padding:3px 0;vertical-align:top;color:#4ade80;font-size:0.9rem;padding-right:10px">›</td><td style="padding:3px 0;font-size:0.85rem;color:#c8c8c0">Arrive <strong style="color:#f5f5f0">5 à 10 min avant</strong> l'heure de début</td></tr>
          <tr><td style="padding:3px 0;vertical-align:top;color:#4ade80;font-size:0.9rem;padding-right:10px">›</td><td style="padding:3px 0;font-size:0.85rem;color:#c8c8c0">Tes instrus sur <strong style="color:#f5f5f0">clé USB, SoundCloud ou Google Drive</strong></td></tr>
          <tr><td style="padding:3px 0;vertical-align:top;color:#4ade80;font-size:0.9rem;padding-right:10px">›</td><td style="padding:3px 0;font-size:0.85rem;color:#c8c8c0">Textes et paroles <strong style="color:#f5f5f0">bien mémorisés</strong></td></tr>
          <tr><td style="padding:3px 0;vertical-align:top;color:#4ade80;font-size:0.9rem;padding-right:10px">›</td><td style="padding:3px 0;font-size:0.85rem;color:#c8c8c0">Bien hydraté, évite les boissons sucrées avant</td></tr>
          <tr><td style="padding:3px 0;vertical-align:top;color:#4ade80;font-size:0.9rem;padding-right:10px">›</td><td style="padding:3px 0;font-size:0.85rem;color:#c8c8c0">Paiement <strong style="color:#f5f5f0">à l'arrivée au studio</strong></td></tr>
        </table>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="background:#111110;border-left:1px solid #1c1c1a;border-right:1px solid #1c1c1a;padding:0 28px 32px;text-align:center">
    <a href="${escHtml(confirmUrl)}" style="display:inline-block;background:#f5f5f0;color:#080808;text-decoration:none;padding:14px 36px;font-family:monospace;font-size:0.7rem;letter-spacing:0.15em;text-transform:uppercase;font-weight:700;margin-bottom:16px">
      VOIR MA RÉSERVATION →
    </a>
    <p style="font-family:monospace;font-size:0.6rem;color:#444440;margin:0;letter-spacing:0.08em">
      Une question ? DM @noirlandmusic ou réponds à cet email
    </p>
  </td></tr>
  <tr><td style="background:#0e0e0c;border:1px solid #1c1c1a;border-top:none;padding:14px 28px;text-align:center">
    <p style="font-family:monospace;font-size:0.56rem;color:#333330;letter-spacing:0.1em;text-transform:uppercase;margin:0">
      Noirland Music · CCRecords Studio · 76 rue du Ruisseau · 75018 Paris
    </p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;

    const statusMeta = {
      cancelled: { emoji: "❌", color: "#f87171", label: "SESSION ANNULÉE",    msg: "Ta session a été annulée. Contacte-nous pour la reprogrammer." },
      pending:   { emoji: "⏳", color: "#fbbf24", label: "EN ATTENTE",         msg: "Ta session est repassée en attente. On revient vers toi rapidement." },
      done:      { emoji: "✅", color: "#4ade80", label: "SESSION TERMINÉE ✓", msg: "Merci pour ta confiance ! N'hésite pas à nous laisser un avis sur noirlandmusic.com." },
    };
    const sm = statusMeta[after.status] || {};

    const htmlSimple = `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#080808;font-family:Arial,sans-serif;color:#f5f5f0">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#080808;padding:32px 16px">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#111110;border:1px solid #1c1c1a">
  <tr><td style="background:#0e0e0c;padding:18px 28px;border-bottom:1px solid #1c1c1a">
    <div style="display:inline-block;width:28px;height:28px;background:#f5f5f0;text-align:center;line-height:28px;font-size:0.78rem;color:#080808;font-weight:bold;vertical-align:middle">NL</div>
    <span style="font-size:0.95rem;letter-spacing:0.1em;color:#f5f5f0;vertical-align:middle;margin-left:8px">NOIRLAND MUSIC</span>
  </td></tr>
  <tr><td style="padding:32px 28px;text-align:center">
    <div style="font-size:2.5rem;margin-bottom:12px">${sm.emoji || "📋"}</div>
    <p style="font-family:monospace;font-size:0.65rem;color:#888882;letter-spacing:0.15em;text-transform:uppercase;margin:0 0 8px">Statut de ta session</p>
    <p style="font-size:1.4rem;font-weight:700;color:${sm.color || "#f5f5f0"};margin:0 0 20px">${sm.label || after.status}</p>
    <p style="font-size:0.9rem;color:#c8c8c0;margin:0 0 24px;line-height:1.7">${sm.msg || ""}</p>
  </td></tr>
  <tr><td style="padding:0 28px 28px">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#0e0e0c;border:1px solid #1c1c1a;margin-bottom:24px">
      <tr><td style="padding:12px 16px;border-bottom:1px solid #1c1c1a">
        <span style="font-family:monospace;font-size:0.6rem;color:#888882;letter-spacing:.12em;text-transform:uppercase">Service</span><br>
        <span style="font-size:0.88rem;color:#f5f5f0;margin-top:3px;display:block">${escHtml(service)}</span>
      </td></tr>
      <tr><td style="padding:12px 16px;border-bottom:1px solid #1c1c1a">
        <span style="font-family:monospace;font-size:0.6rem;color:#888882;letter-spacing:.12em;text-transform:uppercase">Date</span><br>
        <span style="font-size:0.88rem;color:#f5f5f0;margin-top:3px;display:block">${escHtml(dateDisplay)}</span>
      </td></tr>
      <tr><td style="padding:12px 16px">
        <span style="font-family:monospace;font-size:0.6rem;color:#888882;letter-spacing:.12em;text-transform:uppercase">Créneau</span><br>
        <span style="font-size:0.88rem;color:#f5f5f0;margin-top:3px;display:block">${escHtml(time)}</span>
      </td></tr>
    </table>
    <div style="text-align:center">
      <a href="${escHtml(confirmUrl)}" style="display:inline-block;background:#f5f5f0;color:#080808;text-decoration:none;padding:12px 28px;font-family:monospace;font-size:0.68rem;letter-spacing:0.12em;text-transform:uppercase;font-weight:700">
        VOIR MA RÉSERVATION →
      </a>
    </div>
    <p style="font-family:monospace;font-size:0.56rem;color:#333330;text-align:center;margin:14px 0 0">
      Noirland Music · CCRecords Studio · 76 rue du Ruisseau · 75018 Paris
    </p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;

    const htmlToSend = isConfirmed ? htmlConfirmed : htmlSimple;

    try {
      await resend.emails.send({
        from: "Noirland Music <noreply@noirlandmusic.com>",
        to: [email],
        subject: cfg.subject,
        html: htmlToSend,
      });
      console.log(`✅ Noirland: email statut "${after.status}" envoyé à ${email}`);
    } catch (err) {
      console.error("❌ Noirland: erreur email statut:", err);
    }

    return null;
  }
);


// ═══════════════════════════════════════════════════════════════════════════════
// 9. RENVOI DU MAIL DE CONFIRMATION NOIRLAND
// ═══════════════════════════════════════════════════════════════════════════════
exports.noirlandResendConfirmation = onRequest(
  {
    region: "europe-west1",
    cors: ["https://www.noirlandmusic.com", "https://noirlandmusic.com"],
    secrets: [RESEND_NOIRLAND_KEY_SECRET],
  },
  async (req, res) => {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const { reservationId } = req.body;
    if (!reservationId) return res.status(400).json({ error: "reservationId manquant" });

    try {
      const snap = await db.collection("reservations").doc(reservationId).get();
      if (!snap.exists) return res.status(404).json({ error: "Réservation introuvable" });

      const data = snap.data();
      if (data.source !== "noirlandmusic.com") return res.status(403).json({ error: "Non autorisé" });

      const email = data.email;
      if (!email) return res.status(400).json({ error: "Pas d'email" });

      const keyVal = RESEND_NOIRLAND_KEY_SECRET.value();
      if (!keyVal) return res.status(500).json({ error: "Clé Resend manquante" });

      const resend   = new Resend(keyVal);
      const name     = data.name || data.nom || "Artiste";
      const service  = data.service || "–";
      const date     = data.date || "–";
      const time     = data.time || "–";
      const status   = data.status || "pending";
      const confirmUrl = `https://www.noirlandmusic.com/suivi-session.html?id=${reservationId}`;

      const dateDisplay = (() => {
        if (!date || date === "–") return date;
        try {
          const p = date.split("-");
          return new Date(parseInt(p[0]), parseInt(p[1])-1, parseInt(p[2]))
            .toLocaleDateString("fr-FR", { weekday:"long", day:"numeric", month:"long", year:"numeric" });
        } catch(e) { return date; }
      })();

      const subjects = {
        confirmed: "✅ Rappel – Ta session est confirmée – Noirland Music",
        pending:   "⏳ Rappel – Ta demande de session – Noirland Music",
        cancelled: "Session annulée – Noirland Music",
        done:      "Session terminée – Noirland Music",
      };

      const isConfirmed = status === "confirmed";

      const htmlResend = isConfirmed ? `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:#080808;font-family:'DM Sans',Arial,sans-serif;color:#f5f5f0">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#080808;padding:32px 16px">
<tr><td align="center"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px">
  <tr><td style="background:#0e0e0c;border:1px solid #1c1c1a;border-bottom:none;padding:18px 28px">
    <div style="display:inline-block;width:32px;height:32px;background:#f5f5f0;text-align:center;line-height:32px;font-family:'Bebas Neue',Arial,sans-serif;font-size:0.85rem;color:#080808;vertical-align:middle">NL</div>
    <span style="font-family:'Bebas Neue',Arial,sans-serif;font-size:1rem;letter-spacing:0.12em;color:#f5f5f0;vertical-align:middle;margin-left:10px">NOIRLAND MUSIC</span>
  </td></tr>
  <tr><td style="background:#111110;border:1px solid #1c1c1a;border-top:none;border-bottom:none;padding:28px 28px 16px;text-align:center">
    <p style="font-family:'Bebas Neue',Arial,sans-serif;font-size:2rem;color:#4ade80;margin:0 0 4px">SESSION CONFIRMÉE ✓</p>
    <p style="font-family:monospace;font-size:0.62rem;color:#888882;margin:0">Rappel · CCRecords Studio</p>
  </td></tr>
  <tr><td style="background:#111110;border-left:1px solid #1c1c1a;border-right:1px solid #1c1c1a;padding:0 28px 16px">
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #1c1c1a">
      <tr><td style="background:#0e0e0c;padding:10px 16px;border-bottom:1px solid #1c1c1a">
        <span style="font-family:monospace;font-size:0.58rem;color:#888882;text-transform:uppercase;letter-spacing:0.12em">🎵 Service</span><br>
        <span style="font-size:0.9rem;color:#f5f5f0">${escHtml(service)}</span>
      </td></tr>
      <tr><td style="background:#080808;padding:10px 16px;border-bottom:1px solid #1c1c1a">
        <span style="font-family:monospace;font-size:0.58rem;color:#888882;text-transform:uppercase;letter-spacing:0.12em">📅 Date</span><br>
        <span style="font-size:0.9rem;color:#f5f5f0;font-weight:600">${escHtml(dateDisplay)}</span>
      </td></tr>
      <tr><td style="background:#0e0e0c;padding:10px 16px;border-bottom:1px solid #1c1c1a">
        <span style="font-family:monospace;font-size:0.58rem;color:#888882;text-transform:uppercase;letter-spacing:0.12em">🕐 Heure</span><br>
        <span style="font-size:1rem;color:#4ade80;font-weight:700">${escHtml(time)}</span>
      </td></tr>
      <tr><td style="background:#080808;padding:10px 16px">
        <span style="font-family:monospace;font-size:0.58rem;color:#888882;text-transform:uppercase;letter-spacing:0.12em">⏱ Durée</span><br>
        <span style="font-size:0.9rem;color:#f5f5f0">${escHtml(data.duration || "–")}h</span>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="background:#111110;border-left:1px solid #1c1c1a;border-right:1px solid #1c1c1a;padding:0 28px 16px">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#071207;border:1px solid #1a381a">
      <tr><td style="padding:14px 16px;border-bottom:1px solid #1a381a">
        <p style="font-family:monospace;font-size:0.58rem;color:#4ade80;letter-spacing:0.15em;text-transform:uppercase;margin:0 0 8px">📍 ADRESSE</p>
        <p style="font-size:0.95rem;font-weight:700;color:#f5f5f0;margin:0 0 3px">CCRecords Studio</p>
        <p style="font-size:0.85rem;color:#c8c8c0;margin:0 0 10px">76 rue du Ruisseau · <strong>75018 Paris</strong></p>
        <a href="https://maps.google.com/?q=76+rue+du+Ruisseau+75018+Paris" style="display:inline-block;background:#4ade80;color:#080808;text-decoration:none;padding:7px 14px;font-family:monospace;font-size:0.6rem;letter-spacing:0.1em;text-transform:uppercase;font-weight:700">Google Maps →</a>
      </td></tr>
      <tr><td style="padding:14px 16px">
        <p style="font-family:monospace;font-size:0.58rem;color:#4ade80;letter-spacing:0.15em;text-transform:uppercase;margin:0 0 8px">🚇 TRANSPORTS</p>
        <p style="font-size:0.82rem;color:#c8c8c0;line-height:1.7;margin:0">
          <strong style="color:#f5f5f0">M13</strong> Guy Môquet (4 min) · <strong style="color:#f5f5f0">M13</strong> La Fourche (6 min)<br>
          <strong style="color:#f5f5f0">M2</strong> Place de Clichy (10 min) · <strong style="color:#f5f5f0">Bus 95</strong> Arrêt Ruisseau (direct)
        </p>
      </td></tr>
    </table>
  </td></tr>
  <tr><td style="background:#111110;border-left:1px solid #1c1c1a;border-right:1px solid #1c1c1a;padding:0 28px 28px;text-align:center">
    <a href="${escHtml(confirmUrl)}" style="display:inline-block;background:#f5f5f0;color:#080808;text-decoration:none;padding:12px 28px;font-family:monospace;font-size:0.68rem;letter-spacing:0.12em;text-transform:uppercase;font-weight:700">
      VOIR MA RÉSERVATION →
    </a>
    <p style="font-family:monospace;font-size:0.56rem;color:#444440;margin:12px 0 0">@noirlandmusic · noirlandmusic.com</p>
  </td></tr>
  <tr><td style="background:#0e0e0c;border:1px solid #1c1c1a;border-top:none;padding:12px 28px;text-align:center">
    <p style="font-family:monospace;font-size:0.54rem;color:#333330;letter-spacing:0.1em;text-transform:uppercase;margin:0">Noirland Music · CCRecords Studio · 76 rue du Ruisseau · 75018 Paris</p>
  </td></tr>
</table></td></tr></table>
</body></html>` : `<!DOCTYPE html>
<html lang="fr"><head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#080808;font-family:Arial,sans-serif;color:#f5f5f0">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#080808;padding:32px 16px">
<tr><td align="center"><table width="100%" cellpadding="0" cellspacing="0" style="max-width:540px;background:#111110;border:1px solid #1c1c1a">
  <tr><td style="background:#0e0e0c;padding:16px 24px;border-bottom:1px solid #1c1c1a">
    <span style="font-size:0.95rem;letter-spacing:0.1em;color:#f5f5f0">NOIRLAND MUSIC</span>
  </td></tr>
  <tr><td style="padding:28px 24px;text-align:center">
    <div style="font-size:2rem;margin-bottom:10px">⏳</div>
    <p style="font-size:1rem;font-weight:600;color:#fbbf24;margin:0 0 14px">DEMANDE EN ATTENTE</p>
    <p style="font-size:0.88rem;color:#c8c8c0;line-height:1.7;margin:0 0 20px">
      Yo <strong style="color:#f5f5f0">${escHtml(name)}</strong>, ta demande est bien enregistrée.<br>
      On revient vers toi sous <strong style="color:#f5f5f0">24h</strong> pour confirmer ton créneau.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#0e0e0c;border:1px solid #1c1c1a;margin-bottom:20px;text-align:left">
      <tr><td style="padding:10px 14px;border-bottom:1px solid #1c1c1a">
        <span style="font-family:monospace;font-size:0.58rem;color:#888882;text-transform:uppercase;letter-spacing:.1em">Service</span><br>
        <span style="font-size:0.88rem;color:#f5f5f0">${escHtml(service)}</span>
      </td></tr>
      <tr><td style="padding:10px 14px;border-bottom:1px solid #1c1c1a">
        <span style="font-family:monospace;font-size:0.58rem;color:#888882;text-transform:uppercase;letter-spacing:.1em">Date demandée</span><br>
        <span style="font-size:0.88rem;color:#f5f5f0">${escHtml(dateDisplay)}</span>
      </td></tr>
      <tr><td style="padding:10px 14px">
        <span style="font-family:monospace;font-size:0.58rem;color:#888882;text-transform:uppercase;letter-spacing:.1em">Créneau</span><br>
        <span style="font-size:0.88rem;color:#f5f5f0">${escHtml(time)}</span>
      </td></tr>
    </table>
    <a href="${escHtml(confirmUrl)}" style="display:inline-block;background:#f5f5f0;color:#080808;text-decoration:none;padding:11px 24px;font-family:monospace;font-size:0.65rem;letter-spacing:0.12em;text-transform:uppercase;font-weight:700">
      SUIVRE MA DEMANDE →
    </a>
    <p style="font-family:monospace;font-size:0.54rem;color:#333330;margin:12px 0 0">Noirland Music · noirlandmusic.com</p>
  </td></tr>
</table></td></tr></table>
</body></html>`;

      await resend.emails.send({
        from:    "Noirland Music <noreply@noirlandmusic.com>",
        to:      [email],
        subject: subjects[status] || "Rappel – Ta session Noirland Music",
        html:    htmlResend,
      });

      console.log(`✅ noirlandResendConfirmation: envoyé à ${email} (${status})`);
      return res.status(200).json({ success: true, email });

    } catch (err) {
      console.error("❌ noirlandResendConfirmation:", err);
      return res.status(500).json({ error: err.message });
    }
  }
);


// ═══════════════════════════════════════════════════════════════════════════════
// 10. DEMANDE DE CONSULTING NOIRLAND — Emails client + admin
// ═══════════════════════════════════════════════════════════════════════════════
exports.noirlandConsultingRequest = onDocumentCreated(
  {
    document: "consulting_requests/{requestId}",
    region: "europe-west1",
    secrets: [RESEND_NOIRLAND_KEY_SECRET],
  },
  async (event) => {
    const data      = event.data.data();
    const requestId = event.params.requestId;

    if (data.source !== "noirlandmusic.com") return null;

    const keyVal = RESEND_NOIRLAND_KEY_SECRET.value();
    if (!keyVal) { console.error("❌ RESEND_NOIRLAND_KEY manquant"); return null; }

    const resend  = new Resend(keyVal);
    const name    = data.name    || "Artiste";
    const email   = data.email   || null;
    const type    = data.type    || "Non précisé";
    const message = data.message || "–";
    const phone   = data.phone   || "–";
    const links   = data.links   || "–";
    const date    = new Date(data.createdAt || Date.now())
                      .toLocaleDateString("fr-FR", { weekday:"long", day:"numeric", month:"long", year:"numeric" });

    if (!email) { console.log("Consulting: pas d'email pour", requestId); return null; }

    // ══════════════════════════════════════════════════════════════════════════
    // EMAIL CLIENT — Confirmation + récapitulatif
    // ══════════════════════════════════════════════════════════════════════════
    const htmlClient = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:#080808;font-family:'DM Sans',Arial,sans-serif;color:#f5f5f0">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#080808;padding:32px 16px">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px">

  <!-- HEADER -->
  <tr><td style="background:#0e0e0c;border:1px solid #1c1c1a;border-bottom:none;padding:18px 28px">
    <div style="display:inline-block;width:32px;height:32px;background:#f5f5f0;text-align:center;line-height:32px;font-family:'Bebas Neue',Arial,sans-serif;font-size:0.85rem;color:#080808;vertical-align:middle">NL</div>
    <span style="font-family:'Bebas Neue',Arial,sans-serif;font-size:1rem;letter-spacing:0.12em;color:#f5f5f0;vertical-align:middle;margin-left:10px">NOIRLAND MUSIC</span>
    <span style="font-family:monospace;font-size:0.6rem;color:#444440;letter-spacing:0.1em;margin-left:8px;vertical-align:middle">CONSULTING</span>
  </td></tr>

  <!-- HERO -->
  <tr><td style="background:#111110;border:1px solid #1c1c1a;border-top:none;border-bottom:none;padding:36px 28px 20px;text-align:center">
    <div style="font-size:2.8rem;margin-bottom:10px">🏴</div>
    <p style="font-family:'Bebas Neue',Arial,sans-serif;font-size:2.2rem;letter-spacing:0.08em;color:#f5f5f0;margin:0 0 6px;line-height:1">DEMANDE REÇUE</p>
    <p style="font-family:monospace;font-size:0.68rem;color:#888882;letter-spacing:0.15em;text-transform:uppercase;margin:0">Consulting Artistique · Noirland Music</p>
  </td></tr>

  <!-- MESSAGE PERSO -->
  <tr><td style="background:#111110;border-left:1px solid #1c1c1a;border-right:1px solid #1c1c1a;padding:0 28px 20px">
    <p style="font-size:0.95rem;color:#c8c8c0;line-height:1.75;margin:0">
      Yo <strong style="color:#f5f5f0">${escHtml(name)}</strong> 🏴<br><br>
      Ta demande de consulting est bien enregistrée. On a tout lu et on revient vers toi sous <strong style="color:#f5f5f0">48h</strong>. Voici le récap de ce que tu nous as envoyé.
    </p>
  </td></tr>

  <!-- RÉCAPITULATIF -->
  <tr><td style="background:#111110;border-left:1px solid #1c1c1a;border-right:1px solid #1c1c1a;padding:0 28px 20px">
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #1c1c1a">
      <tr><td style="background:#0e0e0c;padding:12px 18px;border-bottom:1px solid #1c1c1a">
        <span style="font-family:monospace;font-size:0.6rem;color:#888882;letter-spacing:0.15em;text-transform:uppercase">Type de consulting</span><br>
        <span style="font-size:0.95rem;color:#f5f5f0;margin-top:4px;display:block;font-weight:500">${escHtml(type)}</span>
      </td></tr>
      <tr><td style="background:#080808;padding:12px 18px;border-bottom:1px solid #1c1c1a">
        <span style="font-family:monospace;font-size:0.6rem;color:#888882;letter-spacing:0.15em;text-transform:uppercase">Ton message</span><br>
        <span style="font-size:0.88rem;color:#c8c8c0;margin-top:6px;display:block;line-height:1.65;white-space:pre-line">${escHtml(message)}</span>
      </td></tr>
      ${links && links !== "–" ? `<tr><td style="background:#0e0e0c;padding:12px 18px;border-bottom:1px solid #1c1c1a">
        <span style="font-family:monospace;font-size:0.6rem;color:#888882;letter-spacing:0.15em;text-transform:uppercase">Liens partagés</span><br>
        <span style="font-size:0.85rem;color:#c8c8c0;margin-top:4px;display:block;word-break:break-all">${escHtml(links)}</span>
      </td></tr>` : ""}
      <tr><td style="background:#080808;padding:12px 18px">
        <span style="font-family:monospace;font-size:0.6rem;color:#888882;letter-spacing:0.15em;text-transform:uppercase">📅 Date de la demande</span><br>
        <span style="font-size:0.88rem;color:#f5f5f0;margin-top:4px;display:block">${escHtml(date)}</span>
      </td></tr>
    </table>
  </td></tr>

  <!-- CE QUI VA SE PASSER -->
  <tr><td style="background:#111110;border-left:1px solid #1c1c1a;border-right:1px solid #1c1c1a;padding:0 28px 20px">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#0e0e0c;border:1px solid #1c1c1a">
      <tr><td style="padding:16px 18px">
        <p style="font-family:monospace;font-size:0.6rem;color:#888882;letter-spacing:0.15em;text-transform:uppercase;margin:0 0 12px">🔜 LA SUITE</p>
        <table cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding:4px 0;vertical-align:top;color:#f5f5f0;font-size:0.9rem;padding-right:12px;font-weight:700">01</td>
            <td style="padding:4px 0;font-size:0.85rem;color:#c8c8c0">On analyse ta demande et ton projet</td>
          </tr>
          <tr>
            <td style="padding:4px 0;vertical-align:top;color:#f5f5f0;font-size:0.9rem;padding-right:12px;font-weight:700">02</td>
            <td style="padding:4px 0;font-size:0.85rem;color:#c8c8c0">On te recontacte sous <strong style="color:#f5f5f0">48h</strong> par email ou téléphone</td>
          </tr>
          <tr>
            <td style="padding:4px 0;vertical-align:top;color:#f5f5f0;font-size:0.9rem;padding-right:12px;font-weight:700">03</td>
            <td style="padding:4px 0;font-size:0.85rem;color:#c8c8c0">Premier échange <strong style="color:#f5f5f0">gratuit</strong> pour cerner ton projet</td>
          </tr>
          <tr>
            <td style="padding:4px 0;vertical-align:top;color:#f5f5f0;font-size:0.9rem;padding-right:12px;font-weight:700">04</td>
            <td style="padding:4px 0;font-size:0.85rem;color:#c8c8c0">Proposition d'un plan d'action sur mesure</td>
          </tr>
        </table>
      </td></tr>
    </table>
  </td></tr>

  <!-- CONTACT -->
  <tr><td style="background:#111110;border-left:1px solid #1c1c1a;border-right:1px solid #1c1c1a;padding:0 28px 32px;text-align:center">
    <p style="font-size:0.88rem;color:#c8c8c0;margin:0 0 16px;line-height:1.7">
      Une question urgente ? Contacte-nous directement.
    </p>
    <div style="display:flex;justify-content:center;gap:1.5rem;flex-wrap:wrap;margin-bottom:20px">
      <a href="https://www.instagram.com/noirlandmusic/" style="font-family:monospace;font-size:0.68rem;color:#f5f5f0;text-decoration:none;letter-spacing:0.08em">📷 @noirlandmusic</a>
      <a href="mailto:contact@noirlandmusic.com" style="font-family:monospace;font-size:0.68rem;color:#f5f5f0;text-decoration:none;letter-spacing:0.08em">📧 Répondre à cet email</a>
    </div>
    <p style="font-family:monospace;font-size:0.6rem;color:#444440;margin:0;letter-spacing:0.08em">
      Noirland Music · Consulting Artistique · noirlandmusic.com
    </p>
  </td></tr>

  <!-- FOOTER -->
  <tr><td style="background:#0e0e0c;border:1px solid #1c1c1a;border-top:none;padding:14px 28px;text-align:center">
    <p style="font-family:monospace;font-size:0.54rem;color:#333330;letter-spacing:0.1em;text-transform:uppercase;margin:0">
      Noirland Music — Label Indépendant · Paris · Au pays du noir 🏴
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;

    // ══════════════════════════════════════════════════════════════════════════
    // EMAIL ADMIN — Notification complète
    // ══════════════════════════════════════════════════════════════════════════
    const htmlAdmin = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#080808;font-family:Arial,sans-serif;color:#f5f5f0">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#080808;padding:32px 16px">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">

  <tr><td style="background:#0e0e0c;border:1px solid #1c1c1a;border-bottom:none;padding:18px 24px">
    <div style="display:inline-block;width:28px;height:28px;background:#f5f5f0;text-align:center;line-height:28px;font-size:0.78rem;color:#080808;font-weight:bold;vertical-align:middle">NL</div>
    <span style="font-size:0.88rem;letter-spacing:0.1em;color:#f5f5f0;vertical-align:middle;margin-left:8px">NOIRLAND MUSIC · NOUVELLE DEMANDE CONSULTING</span>
  </td></tr>

  <tr><td style="background:#111110;border:1px solid #1c1c1a;border-top:none;padding:24px">

    <p style="font-family:monospace;font-size:0.62rem;color:#888882;letter-spacing:0.15em;text-transform:uppercase;margin:0 0 16px">📋 RÉCAPITULATIF DE LA DEMANDE</p>

    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:0.85rem;border-collapse:collapse;margin-bottom:20px">
      <tr style="border-bottom:1px solid #1c1c1a">
        <td style="color:#888882;padding:10px 0;width:130px;font-family:monospace;font-size:0.62rem;letter-spacing:0.1em;text-transform:uppercase;vertical-align:top">Nom</td>
        <td style="padding:10px 0;font-weight:bold;color:#f5f5f0">${escHtml(name)}</td>
      </tr>
      <tr style="border-bottom:1px solid #1c1c1a">
        <td style="color:#888882;padding:10px 0;font-family:monospace;font-size:0.62rem;letter-spacing:0.1em;text-transform:uppercase;vertical-align:top">Email</td>
        <td style="padding:10px 0"><a href="mailto:${escHtml(email)}" style="color:#f5f5f0;text-decoration:none">${escHtml(email)}</a></td>
      </tr>
      <tr style="border-bottom:1px solid #1c1c1a">
        <td style="color:#888882;padding:10px 0;font-family:monospace;font-size:0.62rem;letter-spacing:0.1em;text-transform:uppercase;vertical-align:top">Téléphone</td>
        <td style="padding:10px 0;color:#f5f5f0">${phone && phone !== "–" ? `<a href="tel:${escHtml(phone)}" style="color:#f5f5f0;text-decoration:none">${escHtml(phone)}</a>` : "–"}</td>
      </tr>
      <tr style="border-bottom:1px solid #1c1c1a">
        <td style="color:#888882;padding:10px 0;font-family:monospace;font-size:0.62rem;letter-spacing:0.1em;text-transform:uppercase;vertical-align:top">Type</td>
        <td style="padding:10px 0;color:#f5f5f0;font-weight:500">${escHtml(type)}</td>
      </tr>
      <tr style="border-bottom:1px solid #1c1c1a">
        <td style="color:#888882;padding:10px 0;font-family:monospace;font-size:0.62rem;letter-spacing:0.1em;text-transform:uppercase;vertical-align:top">Message</td>
        <td style="padding:10px 0;color:#c8c8c0;line-height:1.65;white-space:pre-line">${escHtml(message)}</td>
      </tr>
      ${links && links !== "–" ? `<tr style="border-bottom:1px solid #1c1c1a">
        <td style="color:#888882;padding:10px 0;font-family:monospace;font-size:0.62rem;letter-spacing:0.1em;text-transform:uppercase;vertical-align:top">Liens</td>
        <td style="padding:10px 0;color:#c8c8c0;word-break:break-all">${escHtml(links)}</td>
      </tr>` : ""}
      <tr>
        <td style="color:#888882;padding:10px 0;font-family:monospace;font-size:0.62rem;letter-spacing:0.1em;text-transform:uppercase;vertical-align:top">Date</td>
        <td style="padding:10px 0;color:#f5f5f0">${escHtml(date)}</td>
      </tr>
    </table>

    <div style="background:#0e0e0c;border:1px solid #1c1c1a;padding:14px 16px;margin-bottom:20px">
      <p style="font-family:monospace;font-size:0.6rem;color:#888882;letter-spacing:0.12em;text-transform:uppercase;margin:0 0 8px">Actions rapides</p>
      <a href="mailto:${escHtml(email)}?subject=Re: Ta demande de consulting – Noirland Music&body=Yo ${escHtml(name)},%0A%0A" style="display:inline-block;background:#f5f5f0;color:#080808;text-decoration:none;padding:8px 18px;font-family:monospace;font-size:0.62rem;letter-spacing:0.1em;text-transform:uppercase;font-weight:700;margin-right:8px">
        Répondre →
      </a>
      ${phone && phone !== "–" ? `<a href="tel:${escHtml(phone)}" style="display:inline-block;background:transparent;color:#f5f5f0;text-decoration:none;padding:8px 18px;font-family:monospace;font-size:0.62rem;letter-spacing:0.1em;text-transform:uppercase;border:1px solid #1c1c1a">Appeler</a>` : ""}
    </div>

    <p style="font-family:monospace;font-size:0.56rem;color:#444440;text-align:center;margin:0;letter-spacing:0.08em">
      Noirland Music · Demande consulting · ID: ${escHtml(requestId)}
    </p>

  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;

    // ── Envoi email CLIENT ────────────────────────────────────────────────────
    try {
      await resend.emails.send({
        from:    "Noirland Music <noreply@noirlandmusic.com>",
        to:      [email],
        subject: `[Noirland Music] Demande de consulting reçue ✓`,
        html:    htmlClient,
      });
      console.log(`✅ Noirland Consulting: email client envoyé à ${email}`);
    } catch (err) {
      console.error("❌ Noirland Consulting: erreur email client:", err);
    }

    // ── Envoi email ADMIN ─────────────────────────────────────────────────────
    try {
      await resend.emails.send({
        from:    "Noirland Music <noreply@noirlandmusic.com>",
        to:      ["noirlandmusic@gmail.com"],
        subject: `[Consulting] Nouvelle demande — ${name} — ${type}`,
        html:    htmlAdmin,
      });
      console.log(`✅ Noirland Consulting: notif admin envoyée`);
    } catch (err) {
      console.error("❌ Noirland Consulting: erreur email admin:", err);
    }

    return null;
  }
);


// ═══════════════════════════════════════════════════════════════════════════════
// 11. SOUMISSION DÉMO NOIRLAND — Emails artiste + admin
// ═══════════════════════════════════════════════════════════════════════════════
exports.noirlandDemoSubmission = onDocumentCreated(
  {
    document: "demo_submissions/{submissionId}",
    region: "europe-west1",
    secrets: [RESEND_NOIRLAND_KEY_SECRET],
  },
  async (event) => {
    const data = event.data.data();
    const id   = event.params.submissionId;

    if (data.source !== "noirlandmusic.com") return null;

    const keyVal = RESEND_NOIRLAND_KEY_SECRET.value();
    if (!keyVal) { console.error("❌ RESEND_NOIRLAND_KEY manquant"); return null; }

    const resend  = new Resend(keyVal);
    const nom     = data.nom     || "Artiste";
    const email   = data.email   || null;
    const genre   = data.genre   || "–";
    const ville   = data.ville   || "–";
    const lien    = data.lien    || "–";
    const message = data.message || "";
    const date    = new Date(data.createdAt || Date.now())
                      .toLocaleDateString("fr-FR", { weekday:"long", day:"numeric", month:"long", year:"numeric" });

    if (!email) { console.log("Demo: pas d'email pour", id); return null; }

    // ══════════════════════════════════════════════════════════════════════════
    // EMAIL ARTISTE — Confirmation de réception
    // ══════════════════════════════════════════════════════════════════════════
    const htmlArtiste = `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:#080808;font-family:'DM Sans',Arial,sans-serif;color:#f5f5f0">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#080808;padding:32px 16px">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:580px">

  <!-- HEADER -->
  <tr><td style="background:#0e0e0c;border:1px solid #1c1c1a;border-bottom:none;padding:18px 28px">
    <div style="display:inline-block;width:32px;height:32px;background:#f5f5f0;text-align:center;line-height:32px;font-family:'Bebas Neue',Arial,sans-serif;font-size:0.85rem;color:#080808;vertical-align:middle">NL</div>
    <span style="font-family:'Bebas Neue',Arial,sans-serif;font-size:1rem;letter-spacing:0.12em;color:#f5f5f0;vertical-align:middle;margin-left:10px">NOIRLAND MUSIC</span>
    <span style="font-family:monospace;font-size:0.6rem;color:#444440;letter-spacing:0.1em;margin-left:8px;vertical-align:middle">SOUMISSION DÉMO</span>
  </td></tr>

  <!-- HERO -->
  <tr><td style="background:#111110;border:1px solid #1c1c1a;border-top:none;border-bottom:none;padding:36px 28px 20px;text-align:center">
    <div style="font-size:2.8rem;margin-bottom:10px">🎤</div>
    <p style="font-family:'Bebas Neue',Arial,sans-serif;font-size:2.2rem;letter-spacing:0.08em;color:#f5f5f0;margin:0 0 6px;line-height:1">DÉMO REÇUE 🏴</p>
    <p style="font-family:monospace;font-size:0.68rem;color:#888882;letter-spacing:0.15em;text-transform:uppercase;margin:0">Label Indépendant · Paris</p>
  </td></tr>

  <!-- MESSAGE -->
  <tr><td style="background:#111110;border-left:1px solid #1c1c1a;border-right:1px solid #1c1c1a;padding:0 28px 20px">
    <p style="font-size:0.95rem;color:#c8c8c0;line-height:1.75;margin:0">
      Yo <strong style="color:#f5f5f0">${escHtml(nom)}</strong> 🏴<br><br>
      Ta démo est bien reçue et enregistrée chez Noirland Music. On l'écoute et on revient vers toi sous <strong style="color:#f5f5f0">7 jours</strong> si le projet nous intéresse.<br><br>
      Voici le récap de ce que tu nous as soumis.
    </p>
  </td></tr>

  <!-- RÉCAP -->
  <tr><td style="background:#111110;border-left:1px solid #1c1c1a;border-right:1px solid #1c1c1a;padding:0 28px 20px">
    <table width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #1c1c1a">
      <tr><td style="background:#0e0e0c;padding:12px 18px;border-bottom:1px solid #1c1c1a">
        <span style="font-family:monospace;font-size:0.6rem;color:#888882;letter-spacing:0.15em;text-transform:uppercase">🎵 Genre musical</span><br>
        <span style="font-size:0.95rem;color:#f5f5f0;margin-top:4px;display:block;font-weight:500">${escHtml(genre)}</span>
      </td></tr>
      ${ville && ville !== "–" ? `<tr><td style="background:#080808;padding:12px 18px;border-bottom:1px solid #1c1c1a">
        <span style="font-family:monospace;font-size:0.6rem;color:#888882;letter-spacing:0.15em;text-transform:uppercase">📍 Ville / Département</span><br>
        <span style="font-size:0.95rem;color:#f5f5f0;margin-top:4px;display:block">${escHtml(ville)}</span>
      </td></tr>` : ""}
      <tr><td style="background:#0e0e0c;padding:12px 18px;border-bottom:1px solid #1c1c1a">
        <span style="font-family:monospace;font-size:0.6rem;color:#888882;letter-spacing:0.15em;text-transform:uppercase">🔗 Lien de ta démo</span><br>
        <a href="${escHtml(lien)}" style="font-size:0.88rem;color:#f5f5f0;margin-top:4px;display:block;word-break:break-all;text-decoration:underline">${escHtml(lien)}</a>
      </td></tr>
      ${message ? `<tr><td style="background:#080808;padding:12px 18px;border-bottom:1px solid #1c1c1a">
        <span style="font-family:monospace;font-size:0.6rem;color:#888882;letter-spacing:0.15em;text-transform:uppercase">💬 Ton message</span><br>
        <span style="font-size:0.88rem;color:#c8c8c0;margin-top:6px;display:block;line-height:1.65;white-space:pre-line">${escHtml(message)}</span>
      </td></tr>` : ""}
      <tr><td style="background:#0e0e0c;padding:12px 18px">
        <span style="font-family:monospace;font-size:0.6rem;color:#888882;letter-spacing:0.15em;text-transform:uppercase">📅 Date de soumission</span><br>
        <span style="font-size:0.88rem;color:#f5f5f0;margin-top:4px;display:block">${escHtml(date)}</span>
      </td></tr>
    </table>
  </td></tr>

  <!-- CE QUI VA SE PASSER -->
  <tr><td style="background:#111110;border-left:1px solid #1c1c1a;border-right:1px solid #1c1c1a;padding:0 28px 20px">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#0e0e0c;border:1px solid #1c1c1a">
      <tr><td style="padding:16px 18px">
        <p style="font-family:monospace;font-size:0.6rem;color:#888882;letter-spacing:0.15em;text-transform:uppercase;margin:0 0 12px">🔜 LA SUITE</p>
        <table cellpadding="0" cellspacing="0">
          <tr>
            <td style="padding:4px 0;vertical-align:top;color:#f5f5f0;font-size:0.9rem;padding-right:14px;font-weight:700;font-family:monospace">01</td>
            <td style="padding:4px 0;font-size:0.85rem;color:#c8c8c0">Notre équipe écoute ta démo</td>
          </tr>
          <tr>
            <td style="padding:4px 0;vertical-align:top;color:#f5f5f0;font-size:0.9rem;padding-right:14px;font-weight:700;font-family:monospace">02</td>
            <td style="padding:4px 0;font-size:0.85rem;color:#c8c8c0">Si le projet nous intéresse, on te recontacte sous <strong style="color:#f5f5f0">7 jours</strong></td>
          </tr>
          <tr>
            <td style="padding:4px 0;vertical-align:top;color:#f5f5f0;font-size:0.9rem;padding-right:14px;font-weight:700;font-family:monospace">03</td>
            <td style="padding:4px 0;font-size:0.85rem;color:#c8c8c0">Premier échange pour mieux te connaître</td>
          </tr>
          <tr>
            <td style="padding:4px 0;vertical-align:top;color:#f5f5f0;font-size:0.9rem;padding-right:14px;font-weight:700;font-family:monospace">04</td>
            <td style="padding:4px 0;font-size:0.85rem;color:#c8c8c0">Décision sur une éventuelle collaboration</td>
          </tr>
        </table>
      </td></tr>
    </table>
  </td></tr>

  <!-- FOOTER -->
  <tr><td style="background:#111110;border-left:1px solid #1c1c1a;border-right:1px solid #1c1c1a;padding:0 28px 28px;text-align:center">
    <p style="font-size:0.85rem;color:#c8c8c0;margin:0 0 14px;line-height:1.7">
      En attendant, suis notre actualité sur Instagram et X.
    </p>
    <div style="display:flex;justify-content:center;gap:1.5rem;flex-wrap:wrap">
      <a href="https://www.instagram.com/noirlandmusic/" style="font-family:monospace;font-size:0.68rem;color:#f5f5f0;text-decoration:none;letter-spacing:0.08em">📷 @noirlandmusic</a>
      <a href="https://x.com/noirlandmusic" style="font-family:monospace;font-size:0.68rem;color:#f5f5f0;text-decoration:none;letter-spacing:0.08em">𝕏 @noirlandmusic</a>
    </div>
  </td></tr>

  <tr><td style="background:#0e0e0c;border:1px solid #1c1c1a;border-top:none;padding:14px 28px;text-align:center">
    <p style="font-family:monospace;font-size:0.54rem;color:#333330;letter-spacing:0.1em;text-transform:uppercase;margin:0">
      Noirland Music — Label Indépendant · Paris · Au pays du noir 🏴
    </p>
  </td></tr>

</table>
</td></tr>
</table>
</body></html>`;

    // ══════════════════════════════════════════════════════════════════════════
    // EMAIL ADMIN — Notification complète
    // ══════════════════════════════════════════════════════════════════════════
    const htmlAdmin = `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#080808;font-family:Arial,sans-serif;color:#f5f5f0">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#080808;padding:32px 16px">
<tr><td align="center">
<table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">

  <tr><td style="background:#0e0e0c;border:1px solid #1c1c1a;border-bottom:none;padding:18px 24px">
    <div style="display:inline-block;width:28px;height:28px;background:#f5f5f0;text-align:center;line-height:28px;font-size:0.78rem;color:#080808;font-weight:bold;vertical-align:middle">NL</div>
    <span style="font-size:0.88rem;letter-spacing:0.1em;color:#f5f5f0;vertical-align:middle;margin-left:8px">NOIRLAND MUSIC · NOUVELLE SOUMISSION DÉMO 🎤</span>
  </td></tr>

  <tr><td style="background:#111110;border:1px solid #1c1c1a;border-top:none;padding:24px">
    <p style="font-family:monospace;font-size:0.62rem;color:#888882;letter-spacing:0.15em;text-transform:uppercase;margin:0 0 16px">📋 DÉTAILS DE LA SOUMISSION</p>

    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:0.85rem;border-collapse:collapse;margin-bottom:20px">
      <tr style="border-bottom:1px solid #1c1c1a">
        <td style="color:#888882;padding:10px 0;width:130px;font-family:monospace;font-size:0.62rem;letter-spacing:0.1em;text-transform:uppercase;vertical-align:top">Artiste</td>
        <td style="padding:10px 0;font-weight:bold;color:#f5f5f0">${escHtml(nom)}</td>
      </tr>
      <tr style="border-bottom:1px solid #1c1c1a">
        <td style="color:#888882;padding:10px 0;font-family:monospace;font-size:0.62rem;letter-spacing:0.1em;text-transform:uppercase;vertical-align:top">Email</td>
        <td style="padding:10px 0"><a href="mailto:${escHtml(email)}" style="color:#f5f5f0;text-decoration:none">${escHtml(email)}</a></td>
      </tr>
      <tr style="border-bottom:1px solid #1c1c1a">
        <td style="color:#888882;padding:10px 0;font-family:monospace;font-size:0.62rem;letter-spacing:0.1em;text-transform:uppercase;vertical-align:top">Genre</td>
        <td style="padding:10px 0;color:#f5f5f0;font-weight:500">${escHtml(genre)}</td>
      </tr>
      ${ville && ville !== "–" ? `<tr style="border-bottom:1px solid #1c1c1a">
        <td style="color:#888882;padding:10px 0;font-family:monospace;font-size:0.62rem;letter-spacing:0.1em;text-transform:uppercase;vertical-align:top">Ville</td>
        <td style="padding:10px 0;color:#f5f5f0">${escHtml(ville)}</td>
      </tr>` : ""}
      <tr style="border-bottom:1px solid #1c1c1a">
        <td style="color:#888882;padding:10px 0;font-family:monospace;font-size:0.62rem;letter-spacing:0.1em;text-transform:uppercase;vertical-align:top">Démo</td>
        <td style="padding:10px 0"><a href="${escHtml(lien)}" style="color:#f5f5f0;text-decoration:underline;word-break:break-all">${escHtml(lien)}</a></td>
      </tr>
      ${message ? `<tr style="border-bottom:1px solid #1c1c1a">
        <td style="color:#888882;padding:10px 0;font-family:monospace;font-size:0.62rem;letter-spacing:0.1em;text-transform:uppercase;vertical-align:top">Message</td>
        <td style="padding:10px 0;color:#c8c8c0;line-height:1.65;white-space:pre-line">${escHtml(message)}</td>
      </tr>` : ""}
      <tr>
        <td style="color:#888882;padding:10px 0;font-family:monospace;font-size:0.62rem;letter-spacing:0.1em;text-transform:uppercase;vertical-align:top">Date</td>
        <td style="padding:10px 0;color:#f5f5f0">${escHtml(date)}</td>
      </tr>
    </table>

    <!-- Actions rapides -->
    <div style="background:#0e0e0c;border:1px solid #1c1c1a;padding:14px 16px;margin-bottom:16px">
      <p style="font-family:monospace;font-size:0.6rem;color:#888882;letter-spacing:0.12em;text-transform:uppercase;margin:0 0 10px">Actions rapides</p>
      <a href="${escHtml(lien)}" target="_blank" style="display:inline-block;background:#f5f5f0;color:#080808;text-decoration:none;padding:8px 18px;font-family:monospace;font-size:0.62rem;letter-spacing:0.1em;text-transform:uppercase;font-weight:700;margin-right:8px">
        🎵 Écouter la démo →
      </a>
      <a href="mailto:${escHtml(email)}?subject=Ta démo – Noirland Music&body=Yo ${escHtml(nom)},%0A%0A" style="display:inline-block;background:transparent;color:#f5f5f0;text-decoration:none;padding:8px 18px;font-family:monospace;font-size:0.62rem;letter-spacing:0.1em;text-transform:uppercase;border:1px solid #1c1c1a">
        Répondre
      </a>
    </div>

    <p style="font-family:monospace;font-size:0.56rem;color:#444440;text-align:center;margin:0;letter-spacing:0.08em">
      Noirland Music · Soumission démo · ID: ${escHtml(id)}
    </p>
  </td></tr>
</table>
</td></tr>
</table>
</body></html>`;

    // ── Envoi EMAIL ARTISTE ───────────────────────────────────────────────────
    try {
      await resend.emails.send({
        from:    "Noirland Music <noreply@noirlandmusic.com>",
        to:      [email],
        subject: `[Noirland Music] Ta démo est bien reçue 🎤`,
        html:    htmlArtiste,
      });
      console.log(`✅ Noirland Demo: email artiste envoyé à ${email}`);
    } catch (err) {
      console.error("❌ Noirland Demo: erreur email artiste:", err);
    }

    // ── Envoi EMAIL ADMIN ─────────────────────────────────────────────────────
    try {
      await resend.emails.send({
        from:    "Noirland Music <noreply@noirlandmusic.com>",
        to:      ["noirlandmusic@gmail.com"],
        subject: `[Démo] Nouvelle soumission — ${nom} — ${genre}`,
        html:    htmlAdmin,
      });
      console.log(`✅ Noirland Demo: notif admin envoyée`);
    } catch (err) {
      console.error("❌ Noirland Demo: erreur email admin:", err);
    }

    return null;
  }
);


// ═══════════════════════════════════════════════════════════════════════════════
// 11. RAPPEL J-1 — ENVOI MANUEL DEPUIS L'ADMIN
// ═══════════════════════════════════════════════════════════════════════════════
const { onCall, HttpsError } = require("firebase-functions/v2/https");

exports.sendReminderManual = onCall(
  {
    region: "europe-west1",
    secrets: [RESEND_API_KEY_SECRET],
  },
  async (request) => {
    // 1. Vérifier l'authentification admin
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Connexion requise.");
    }
    if (!request.auth.token.admin && request.auth.token.email !== "s.makouezi@gmail.com") {
      throw new HttpsError("permission-denied", "Accès admin requis.");
    }

    // 2. Récupérer l'ID du RDV
    const rdvId = request.data?.rdvId;
    if (!rdvId) {
      throw new HttpsError("invalid-argument", "rdvId manquant.");
    }

    // 3. Charger le RDV depuis Firestore
    const rdvSnap = await db.collection("reservations").doc(rdvId).get();
    if (!rdvSnap.exists) {
      throw new HttpsError("not-found", "RDV introuvable.");
    }
    const data = rdvSnap.data();

    // 4. Préparer les infos
    const email         = data.email;
    const nom           = data.nom || data.name || "Client";
    const dateFormatted = formatDate(data.dateKey || data.date);
    const timeLabel     = data.timeLabel || data.time || "–";
    const adresse       = data.adresse || "—";
    const service       = data.service || "Dépannage informatique";
    const price         = data.price || "";

    if (!email) {
      throw new HttpsError("failed-precondition", "Email du client manquant.");
    }

    // 5. Envoyer via Resend
    const resend = mkResend(process.env.RESEND_API_KEY);
    try {
      await resend.emails.send({
        from: "Makouez IT <contact@makouezit.org>",
        to: [email],
        subject: `🔔 Rappel : votre RDV Makouez IT demain – ${dateFormatted}`,
        html: `<!DOCTYPE html><html lang="fr"> <head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head> <body style="margin:0;padding:0;background:#09090f;font-family:'Segoe UI',Arial,sans-serif;color:#f0f0ff"> <table width="100%" cellpadding="0" cellspacing="0" style="background:#09090f;padding:40px 20px"> <tr><td align="center"> <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#111120;border:1px solid #ffffff14;border-radius:16px;overflow:hidden"> <tr><td style="background:#16162a;padding:24px 32px;border-bottom:1px solid #ffffff14"> <span style="font-size:20px;font-weight:800;color:#f0f0ff">Makouez <span style="color:#3b82f6">IT</span></span> </td></tr> <tr><td align="center" style="padding:36px 32px 20px"> <div style="font-size:48px">🔔</div> <h1 style="margin:20px 0 8px;font-size:22px;font-weight:700;color:#f0f0ff">C'est pour demain !</h1> <p style="margin:0;color:#8888aa;font-size:15px"> Bonjour <strong style="color:#f0f0ff">${escHtml(nom)}</strong>,<br> petit rappel : votre rendez-vous Makouez IT a lieu <strong style="color:#3b82f6">demain</strong>.<br> Voici tout ce qu'il faut savoir pour bien le préparer. </p> </td></tr> <tr><td style="padding:0 32px 16px"> <table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff08;border:1px solid #ffffff14;border-radius:12px;overflow:hidden"> <tr><td style="padding:16px 20px;border-bottom:1px solid #ffffff10"> <span style="color:#8888aa;font-size:13px">🔧 Service</span><br> <span style="color:#f0f0ff;font-size:15px;font-weight:500">${escHtml(service)}</span> </td></tr> <tr><td style="padding:16px 20px;border-bottom:1px solid #ffffff10"> <span style="color:#8888aa;font-size:13px">📅 Date</span><br> <span style="color:#f0f0ff;font-size:15px;font-weight:500">${escHtml(dateFormatted)}</span> </td></tr> <tr><td style="padding:16px 20px;border-bottom:1px solid #ffffff10"> <span style="color:#8888aa;font-size:13px">🕐 Plage horaire</span><br> <span style="color:#f0f0ff;font-size:15px;font-weight:500">${escHtml(timeLabel)}</span> </td></tr> <tr><td style="padding:16px 20px${price ? ';border-bottom:1px solid #ffffff10' : ''}"> <span style="color:#8888aa;font-size:13px">📍 Adresse</span><br> <span style="color:#f0f0ff;font-size:15px;font-weight:500">${escHtml(adresse)}</span> </td></tr> ${price ? `<tr><td style="padding:16px 20px"> <span style="color:#8888aa;font-size:13px">💰 Tarif indicatif</span><br> <span style="color:#3b82f6;font-size:15px;font-weight:600">${escHtml(price)}</span> </td></tr>` : ""} </table> </td></tr> <tr><td style="padding:8px 32px 24px"> <h2 style="margin:16px 0 12px;font-size:16px;font-weight:700;color:#3b82f6">📋 Préparez votre rendez-vous</h2> <table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff05;border-left:3px solid #3b82f6;border-radius:6px"> <tr><td style="padding:14px 18px"> <table cellpadding="0" cellspacing="0" style="font-size:14px;color:#c8c8d8;line-height:1.9"> <tr><td>✓ Sauvegardez vos données importantes si possible</td></tr> <tr><td>✓ Ayez vos identifiants et mots de passe à portée</td></tr> <tr><td>✓ Préparez l'appareil concerné, branché et accessible</td></tr> <tr><td>✓ Prévoyez une prise électrique disponible</td></tr> <tr><td>✓ Listez les problèmes ou symptômes rencontrés</td></tr> <tr><td>✓ Prévoyez un moyen de paiement (espèces, virement, CB)</td></tr> </table> </td></tr> </table> </td></tr> <tr><td style="padding:0 32px 24px"> <table width="100%" cellpadding="0" cellspacing="0" style="background:#3b82f610;border:1px solid #3b82f640;border-radius:10px"> <tr><td style="padding:14px 18px"> <p style="margin:0;color:#f0f0ff;font-size:14px;line-height:1.6"> <strong>Empêchement ou question ?</strong><br> <span style="color:#8888aa">Contactez Stevy au plus vite :</span><br> 📞 <a href="tel:+33745103827" style="color:#3b82f6;text-decoration:none">07 45 10 38 27</a><br> ✉️ <a href="mailto:s.makouezi@gmail.com" style="color:#3b82f6;text-decoration:none">s.makouezi@gmail.com</a> </p> </td></tr> </table> <div style="text-align:center;margin-top:24px"> <a href="${SITE_URL}/suivi-rdv.html?id=${escHtml(rdvId)}" style="display:inline-block;background:#3b82f6;color:#fff;text-decoration:none;padding:14px 32px;border-radius:10px;font-size:15px;font-weight:500">→ Voir / modifier ma réservation</a> </div> <p style="margin:24px 0 0;text-align:center;color:#8888aa;font-size:12px;line-height:1.6"> À demain !<br> <strong style="color:#f0f0ff">Stevy — Makouez IT</strong><br> <span style="color:#ffffff30">Intervention à domicile en Île-de-France</span> </p> </td></tr> </table> </td></tr> </table> </body></html>`,
      });
      console.log(`✅ Rappel J-1 envoyé à ${email} pour RDV ${rdvId}`);
    } catch (err) {
      console.error("❌ Erreur envoi rappel:", err);
      throw new HttpsError("internal", err.message || "Erreur envoi email");
    }

    // 6. Mettre à jour Firestore
    try {
      await rdvSnap.ref.update({
        reminderSent: true,
        reminderSentAt: admin.firestore.FieldValue.serverTimestamp(),
        reminderSendCount: admin.firestore.FieldValue.increment(1),
      });
    } catch (err) {
      console.error("⚠️ Email envoyé mais maj Firestore échouée:", err);
    }

    return { success: true, email: email };
  }
);
