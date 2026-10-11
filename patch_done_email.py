#!/usr/bin/env python3
"""Ajoute dans functions/index.js un email « Merci pour votre confiance » envoyé
au client quand une réservation passe en « Terminé » depuis l'admin :
  - récapitulatif de l'intervention (service, date, créneau, lieu, montant facturé)
  - bouton pour laisser un avis sur la fiche Google de Makouez IT
  - rappel des coordonnées + invitation à recommander
  - envoyé une seule fois par réservation (champ doneEmailSentAt)

Usage :
  python3 patch_done_email.py functions/index.js "https://g.page/r/XXXXXXXX/review"
(le lien Google est optionnel : sans lui, le bouton renvoie vers l'avis du site)
"""
import re, shutil, sys

path = sys.argv[1] if len(sys.argv) > 1 else "functions/index.js"
google_url = sys.argv[2] if len(sys.argv) > 2 else ""
src = open(path, encoding="utf-8").read()

if "GOOGLE_REVIEW_URL" in src:
    sys.exit("Déjà appliqué (GOOGLE_REVIEW_URL existe). Modifie la constante dans le fichier pour changer le lien.")

CONSTS = '''const SITE_URL      = "https://makouezit.org";

// ─── Email « intervention terminée » : avis Google + coordonnées ──────────────
const GOOGLE_REVIEW_URL = "__GOOGLE_URL__"; // lien « Laisser un avis » de la fiche Google Makouez IT
const PRO_PHONE         = "06 19 51 57 56";
const PRO_PHONE_TEL     = "+33619515756";
const PRO_EMAIL         = "contact@makouezit.org";
const escHtml = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => (
  { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
));'''.replace("__GOOGLE_URL__", google_url)

DONE_BLOCK = r'''const isDone   = after.status === "done";

    // ── Email « Merci » spécifique au passage en Terminé (envoyé 1 seule fois) ──
    if (isDone) {
      if (after.doneEmailSentAt) {
        console.log("ℹ️ Email « terminé » déjà envoyé pour " + rdvId + ", ignoré");
        return null;
      }
      const prenom      = escHtml((after.nom || after.name || "").trim().split(" ")[0]);
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
<tr><td align="center" style="padding:36px 32px 12px"><div style="font-size:48px">🙏</div><h1 style="margin:18px 0 8px;font-size:22px;font-weight:700;color:#f0f0ff">Merci pour votre confiance${prenom ? ", " + prenom : ""} !</h1>
<p style="margin:0;color:#c8c8d8;font-size:15px;line-height:1.7">Merci de m'avoir contacté et de m'avoir ouvert votre porte. J'espère que tout fonctionne à votre entière satisfaction.</p></td></tr>
<tr><td style="padding:16px 32px 8px"><p style="margin:0 0 10px;color:#8888aa;font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase">Récapitulatif de l'intervention</p>
<table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff08;border:1px solid #ffffff14;border-radius:12px;overflow:hidden">${recapRows}</table></td></tr>
<tr><td style="padding:20px 32px 8px"><table width="100%" cellpadding="0" cellspacing="0" style="background:#f59e0b10;border:1px solid #f59e0b30;border-radius:12px"><tr><td align="center" style="padding:22px 20px">
<p style="margin:0 0 8px;color:#f59e0b;font-size:15px;font-weight:700">⭐ Votre avis compte beaucoup</p>
<p style="margin:0 0 16px;color:#c8c8d8;font-size:14px;line-height:1.6">Si vous êtes satisfait, un avis sur ma fiche Google prend 1 minute et m'aide énormément à me faire connaître.</p>
<a href="${reviewUrl}" style="display:inline-block;background:#f59e0b;color:#111;text-decoration:none;padding:12px 26px;border-radius:10px;font-size:15px;font-weight:700">${reviewLabel}</a></td></tr></table></td></tr>
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
    }'''

patches = [
    ("constantes avis/coordonnées",
     r'const SITE_URL\s*=\s*"https://makouezit\.org";',
     lambda m: CONSTS),
    ("email « merci » au passage en Terminé",
     r'const isDone {3}= after\.status === "done";',
     lambda m: DONE_BLOCK),
]

out = src
for name, pattern, repl in patches:
    n = len(re.findall(pattern, out))
    if n != 1:
        sys.exit(f"ECHEC « {name} » : {n} occurrence(s) (1 attendue). Rien n'a été modifié.")
    out = re.sub(pattern, repl, out, count=1)
    print(f"OK  {name}")

shutil.copyfile(path, path + ".bak2")
open(path, "w", encoding="utf-8").write(out)
print(f"\nTerminé. Sauvegarde : {path}.bak2")
print("Lien Google utilisé :", google_url or "(aucun : le bouton renverra vers l'avis du site)")
print("Étape suivante : firebase deploy --only functions:sendStatusUpdateEmail")
