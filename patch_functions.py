#!/usr/bin/env python3
"""Corrige functions/index.js :
 1. branche le secret RESEND_API_KEY sur les fonctions qui envoient des mails Makouez IT
 2. fait remonter les erreurs Resend (elles ne sont pas levées par défaut -> logs « ✅ » trompeurs)

Usage :  python3 patch_functions.py [functions/index.js]
Une sauvegarde .bak est créée. Si un point d'ancrage n'est pas trouvé le bon nombre
de fois, RIEN n'est écrit.
"""
import re, shutil, sys

path = sys.argv[1] if len(sys.argv) > 1 else "functions/index.js"
src = open(path, encoding="utf-8").read()

HELPER = '''const SITE_URL      = "https://makouezit.org";

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
}'''

SECRETS = "secrets: [RESEND_API_KEY_SECRET]"

patches = [
    # (nom, regex, remplacement, nombre attendu)
    ("helper mkResend",
     r'const SITE_URL\s*=\s*"https://makouezit\.org";',
     lambda m: HELPER, 1),
    ("secret sur sendConfirmationEmail + sendStatusUpdateEmail",
     r'\{ document: "reservations/\{reservationId\}", region: "europe-west1" \}',
     lambda m: '{ document: "reservations/{reservationId}", region: "europe-west1", ' + SECRETS + ' }', 2),
    ("secret sur sendContratConfirmation",
     r'\{ document: "contrats/\{contratId\}", region: "europe-west1" \}',
     lambda m: '{ document: "contrats/{contratId}", region: "europe-west1", ' + SECRETS + ' }', 1),
    ("secret sur resendSuiviLink",
     r'(exports\.resendSuiviLink = onRequest\(\s*\{ region: "europe-west1", cors: \[[^\]]*\])( \})',
     lambda m: m.group(1) + ", " + SECRETS + m.group(2), 1),
    ("Resend avec erreurs visibles",
     r'new Resend\(process\.env\.RESEND_API_KEY\)',
     lambda m: 'mkResend(process.env.RESEND_API_KEY)', 5),
]

out = src
for name, pattern, repl, expected in patches:
    n = len(re.findall(pattern, out))
    if n != expected:
        sys.exit(f"ECHEC « {name} » : {n} occurrence(s) trouvée(s), {expected} attendue(s). Rien n'a été modifié.")
    out = re.sub(pattern, repl, out)
    print(f"OK  {name}")

shutil.copyfile(path, path + ".bak")
open(path, "w", encoding="utf-8").write(out)
print(f"\nTerminé. Sauvegarde : {path}.bak")
print("Étape suivante : firebase deploy --only functions")
