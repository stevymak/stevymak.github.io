# TODO manuel — Makouez IT

Actions à faire par Stevy (console Firebase, Google Cloud, Cloudflare, comptes externes).
Le code est prêt ; ces étapes ne peuvent pas être faites depuis le dépôt.
Mis à jour le 20/10/2026 (fin du lot 4 de l'audit).

**Ordre :** A → B → C le même jour, D dans la semaine, E dès que possible.

---

## A. Avant la fusion de `audit-2026-10` dans `main`

### A1. ✅ TOTP activé sur le projet Firebase (fait le 20/10/2026)
Pour mémoire, la commande Cloud Shell utilisée :
```bash
curl -X PATCH "https://identitytoolkit.googleapis.com/admin/v2/projects/makouez-it/config?updateMask=mfa" \
  -H "Authorization: Bearer $(gcloud auth print-access-token)" \
  -H "Content-Type: application/json" \
  -H "X-Goog-User-Project: makouez-it" \
  -d '{"mfa":{"providerConfigs":[{"state":"ENABLED","totpProviderConfig":{"adjacentIntervals":5}}]}}'
```
L'email du compte admin `s.makouezi@gmail.com` doit être « vérifié » (*Authentication* → *Utilisateurs*).

### A2. Déployer les Cloud Functions (obligatoire avant la fusion)
La page de réservation appelle `createReservation` et l'accueil appelle `requestCallback` : si la fusion a lieu avant, les réservations et les demandes de rappel échouent.
Dans Google Cloud Shell (ou sur votre PC avec Firebase CLI) :
```bash
git clone -b audit-2026-10 https://github.com/stevymak/stevymak.github.io.git && cd stevymak.github.io
cd functions && npm ci && cd .. && firebase deploy --only functions --project makouez-it
```
Fonctions nouvelles ou modifiées : `createReservation`, `syncSlot`, `rebuildSlots`, `unsubscribe`, `requestCallback`, plus les emails (données échappées, prix issus de `tarifs.json`, lien de désinscription).
Vérification : https://europe-west1-makouez-it.cloudfunctions.net/unsubscribe doit afficher « Lien invalide » (et non une erreur 404).

---

## B. Fusion (je m'en charge quand A2 est fait)

### B1. Vérifier les 404 après publication (2–3 minutes après la fusion)
Ces adresses doivent renvoyer « Page introuvable » : `/firestore.rules`, `/firebase.json`, `/functions/index.js`, `/functions/legacy-v2.js`, `/README.md`, `/TODO-MANUEL.md`, `/tests/rules.test.mjs`.

---

## C. Juste après la fusion (même jour, dans cet ordre)

### C1. Enrôler la 2FA admin
Se connecter à `/admin.html` → écran « Activer la vérification en deux étapes » → scanner le QR code (Google Authenticator / Microsoft Authenticator) → saisir le code → se reconnecter.
**Conserver la clé de secours** affichée sous « Impossible de scanner ? » dans un gestionnaire de mots de passe. En cas de perte du téléphone, retirer la 2FA depuis Cloud Shell puis se réenrôler :
```bash
npm i firebase-admin && node -e "const {initializeApp}=require('firebase-admin/app');const {getAuth}=require('firebase-admin/auth');initializeApp({projectId:'makouez-it'});getAuth().getUserByEmail('s.makouezi@gmail.com').then(u=>getAuth().updateUser(u.uid,{multiFactor:{enrolledFactors:null}})).then(()=>console.log('2FA retirée')).catch(e=>console.error('Erreur :',e.message))"
```

### C2. Recalculer les créneaux (une seule fois)
Admin → Réservations → **« 🗓 Recalculer les créneaux »** : libère les créneaux bloqués par d'anciennes réservations annulées.

### C3. Déployer les règles Firestore validées (seulement après C1)
```bash
firebase deploy --only firestore:rules --project makouez-it
```
Les nouvelles règles exigent la 2FA pour tout accès admin. Avant ce déploiement, l'ancienne règle permet encore de créer des réservations sans passer par la fonction.
Noirland Music : ces règles réautorisent les demandes de session de `noirlandmusic.com/reservation.html` (probablement bloquées aujourd'hui). Le panneau admin de Noirland, qui lit aussi `reservations`, demandera un compte avec le claim `admin` **et** la 2FA.

### C4. Tests en conditions réelles
- Faire une réservation test sur `/makouez-it-rdv.html` (case CGV cochée) → email de confirmation reçu, créneau grisé, puis l'annuler dans l'admin → le créneau se libère.
- Remplir « Être rappelé » en bas de l'accueil avec votre numéro → email « 📞 Rappel demandé » reçu sur contact@makouezit.org (la demande est aussi gardée dans la collection Firestore `rappels` ; si vous voulez la voir dans l'admin, je vous proposerai le diff des règles).
- Souscrire un contrat test sur `/contrats.html` (case CGV obligatoire).

---

## G. Espace client v2 (21/10/2026) — à faire une fois

### G1. Déployer les fonctions et les règles
Dans Cloud Shell : `cd ~/stevymak.github.io && git checkout main && git pull`, puis :
```bash
cd functions && npm ci && cd .. && firebase deploy --only functions,firestore:rules --project makouez-it
```
Nouvelles fonctions : `linkMyAccount`, `autoLinkReservation`, `autoLinkContrat`, `setMarketingPreference`, `getMarketingPreference`, `notifyClientMessage`.
Si « Failed to set invoker » apparaît pour `linkMyAccount`, `setMarketingPreference` ou `getMarketingPreference` : même commande `gcloud run services add-iam-policy-binding <nom-en-minuscules> --region=europe-west1 --member=allUsers --role=roles/run.invoker --project makouez-it` que pour `createreservation`.
Les règles exigent la 2FA admin (C1) : faites C1 avant si ce n'est pas déjà fait.

### G2. Activer la connexion par lien email
Console Firebase → *Authentication* → *Méthode de connexion* → *Adresse e-mail/Mot de passe* → cocher **« Lien envoyé par e-mail (connexion sans mot de passe) »** → Enregistrer.
Vérifier dans *Authentication* → *Paramètres* → *Domaines autorisés* que `makouezit.org` figure dans la liste.

### G3. Emails Firebase en français
*Authentication* → *Modèles* → langue du modèle : **français** (vérification d'adresse, réinitialisation du mot de passe, changement d'email). Nom de l'expéditeur conseillé : « Makouez IT ».

### G4. Test
Créer un compte test lors d'une réservation → cliquer le lien de confirmation reçu → ouvrir `/mon-rdv.html` : la réservation, et un contrat demandé avec la même adresse, apparaissent. Le bandeau bleu « Bonjour … » s'affiche ensuite en haut de toutes les pages.
Accès admin discret : cliquer sur le symbole **©** en bas de l'accueil (ou de toute page qui l'affiche).

---

## D. Dans la semaine

### D1. Clé Google Maps — vérifier les restrictions d'API
Les restrictions de sites web sont posées (`https://makouezit.org/*`, `https://www.makouezit.org/*`). Vérifier aussi, sur la même clé (`AIzaSyA5…`), *Restrictions relatives aux API* : uniquement « Places API (New) » et « Maps JavaScript API ».
La clé `AIzaSyBx…` est la configuration web Firebase : publique par conception, protégée par les règles Firestore et App Check.

### D2. Durée de conservation (TTL) des limites anti-abus
Console Firebase → Firestore → *Durée de vie (TTL)* → règle sur la collection `rate_limits`, champ `expireAt`. Sans elle, les empreintes d'IP (chat, réservation, rappel) ne sont pas supprimées après 48 h, contrairement à la politique de confidentialité.

### D3. App Check (reCAPTCHA Enterprise)
1. Google Cloud Console → *Security* → *reCAPTCHA* → **Créer une clé** : type *Site Web*, domaines `makouezit.org` et `www.makouezit.org`, sans case à cocher. Copier l'**ID de la clé**.
2. Console Firebase → *App Check* → *Apps* → l'application web → **reCAPTCHA Enterprise** → coller l'ID → Enregistrer.
3. Me donner l'ID (ou le coller dans `appcheck-config.js` : `APP_CHECK_SITE_KEY = 'xxxx'`), puis publier.
4. **Attendre une semaine** (*App Check → APIs → Cloud Firestore* : la part « vérifiées » doit approcher 100 %).
5. Ensuite seulement : *App Check* → **Appliquer** sur Cloud Firestore et Authentication, et passer `ENFORCE_APP_CHECK = true` dans `functions/booking.js` et `functions/callback.js`, puis redéployer les fonctions.

### D4. En-têtes de sécurité (Cloudflare)
GitHub Pages ne permet pas d'ajouter d'en-têtes : il faut faire passer le trafic par Cloudflare (aujourd'hui DNS seulement).
1. **SSL/TLS** → mode **Complet (Full)** (ni « Flexible », ni « Complet (strict) »).
2. **DNS** → `makouezit.org` et `www` en **Proxied** (nuage orange). Vérifier que le site s'affiche.
3. **SSL/TLS → Certificats Edge** → **Toujours utiliser HTTPS** et **HSTS** (`max-age` 12 mois, sans includeSubDomains ni preload).
4. **Règles → Transform Rules → Modifier l'en-tête de réponse** → règle « Sécurité » sur toutes les requêtes :
   - `Content-Security-Policy-Report-Only` = contenu de `securite/csp.txt` (une ligne)
   - `X-Frame-Options` = `DENY`
   - `X-Content-Type-Options` = `nosniff`
   - `Referrer-Policy` = `strict-origin-when-cross-origin`
   - `Permissions-Policy` = `camera=(), microphone=(), geolocation=(), payment=(), usb=()`
   - `Cross-Origin-Opener-Policy` = `same-origin-allow-popups`
   - Supprimer `Access-Control-Allow-Origin`
5. Après une semaine sans erreur « Content Security Policy » dans la console (accueil, réservation, contrats, espace client, admin, chat) : renommer en `Content-Security-Policy`.
6. Vérifier sur https://securityheaders.com/?q=makouezit.org (objectif : A).

### D5. Google Search Console
https://search.google.com/search-console → propriété `https://makouezit.org/` → *Sitemaps* → soumettre `https://makouezit.org/sitemap.xml` (à refaire après le lot 5, qui modifie les pages et le sitemap).

### D6. Google Analytics
Confirmer que `G-5963KCLEX1` est le bon ID (Google Analytics → Admin → Flux de données).

---

## E. Obligation légale

### E1. Adhérer à un médiateur de la consommation
Obligatoire pour vendre à des particuliers (art. L612-1 du Code de la consommation) ; son absence peut être sanctionnée par une amende administrative.
Choisir un médiateur agréé (liste officielle : https://www.economie.gouv.fr/mediation-conso), puis me donner son nom, son adresse et son site : je complète `cgv.html` (article 10) et `mentions-legales.html` (emplacements prévus en commentaire).

---

## F. Contenu à fournir

### F1. Photo de Stevy
Le fichier `/images/stevy-makouez-it.jpg` n'a jamais été envoyé sur le site : l'accueil affiche pour l'instant un médaillon « SM ».
Déposer une photo carrée (400×400, fond neutre) sous `images/stevy-makouez-it.jpg`, puis dans `index.html` (section « Bonjour, je suis Stevy ») remplacer le bloc `<div class="avatar" …>SM</div>` par la balise `<img>` indiquée en commentaire juste au-dessus. Remettre aussi `"image":"https://makouezit.org/images/stevy-makouez-it.jpg"` dans le JSON-LD de l'accueil.

### F2. Captures du portfolio
Déposer `images/portfolio/makouez-it.webp`, `noirland.webp` et `landing.webp` (1200×720, WebP), puis dans `portfolio.html` retirer les marques de commentaire `<!-- … -->` autour des balises `<img>` (repérées par « EMPLACEMENT CAPTURE »).

### F3. Ancienne adresse de la page 93 (optionnel, après D4)
`depannage-informatique-seine-saint-denis.html` redirige vers `…-seine-saint-denis-93.html` par une page de redirection. Quand le trafic passe par Cloudflare, ajouter *Règles → Redirect Rules* : URL égale à `https://makouezit.org/depannage-informatique-seine-saint-denis.html` → `https://makouezit.org/depannage-informatique-seine-saint-denis-93.html`, code **301**.

---

## Référence (à chaque modification)

- **Changer un prix :** modifier uniquement `tarifs.json`, lancer `node tests/check-tarifs.mjs` (liste les prix écrits en dur à aligner), publier, puis redéployer les fonctions (emails et chat ; la copie `functions/tarifs.json` est faite automatiquement par `firebase deploy`).
- **CGV, mentions légales, confidentialité :** mettre à jour la date « Dernière mise à jour » à chaque modification significative.
- **Nouvel article de blog :** créer `slug-de-larticle.html`, l'ajouter à `blog.html` et à `sitemap.xml`.
- **Tests :** règles Firestore (poste avec Java) `cd tests && npm install && npm test` ; fonctions `cd functions && npm ci && node --test ../tests/functions-lot3.test.cjs` ; prix `node tests/check-tarifs.mjs`.

## Rappels techniques
- **Domaine :** makouezit.org → stevymak.github.io (CNAME), DNS chez Cloudflare.
- **Publication :** GitHub Pages, branche `main`, automatique à chaque push.
- **Firebase :** projet `makouez-it` (Firestore europe-west1, Auth + 2FA TOTP, Cloud Functions, FCM), partagé avec Noirland Music.
- **Emails :** Resend (secret `RESEND_API_KEY` dans Firebase).
- **Supabase :** portfolio (carte Savourez Paris).

*Retirés car déjà faits ou devenus sans objet : Pixel Facebook (aucun emplacement dans le code), lien avis Google, avis factices (les avis viennent de Google/Firestore et la section reste masquée tant qu'il n'y en a pas), liens « # » du portfolio.*
