# TODO Manuel — Makouez IT

Actions à réaliser manuellement par Stevy. Le code est en place ; seules les données réelles manquent.

---

## 🔐 Sécurité — Lot 1 (audit du 20/10/2026)

À faire **dans cet ordre**, au moment de fusionner la branche `audit-2026-10`.

### S1. 2FA admin — activer le TOTP sur le projet Firebase (avant la fusion)
Le code de l'admin exige désormais une application d'authentification. Tant que le TOTP n'est pas activé sur le projet, l'admin reste accessible avec un bandeau orange d'avertissement.

1. **Console Firebase** → projet `makouez-it` → *Authentication* → *Paramètres*. Si un bouton « Passer à Firebase Authentication with Identity Platform » apparaît, cliquer dessus et valider (le projet est déjà en forfait Blaze ; les 50 000 premiers utilisateurs actifs mensuels restent gratuits).
2. **Vérifier l'email du compte admin** : *Authentication* → *Utilisateurs* → `s.makouezi@gmail.com` doit être « vérifié ». Sinon, depuis l'admin ou l'espace client, envoyer l'email de vérification et cliquer le lien (la 2FA l'exige).
3. **Activer le TOTP** (pas d'interrupteur dans la console pour le TOTP) : ouvrir **Google Cloud Shell** (icône `>_` en haut à droite de https://console.cloud.google.com, projet `makouez-it` sélectionné) et coller :
   ```bash
   curl -X PATCH "https://identitytoolkit.googleapis.com/admin/v2/projects/makouez-it/config?updateMask=mfa" \
     -H "Authorization: Bearer $(gcloud auth print-access-token)" \
     -H "Content-Type: application/json" \
     -H "X-Goog-User-Project: makouez-it" \
     -d '{"mfa":{"providerConfigs":[{"state":"ENABLED","totpProviderConfig":{"adjacentIntervals":5}}]}}'
   ```
   La réponse doit contenir `"totpProviderConfig"` avec `"state": "ENABLED"`.
4. **Enrôler le téléphone** : après fusion, se connecter à `/admin.html` → l'écran « Activer la vérification en deux étapes » s'affiche → scanner le QR code avec Google Authenticator / Microsoft Authenticator → saisir le code → se reconnecter (le code est alors demandé à chaque connexion).
5. **Conserver la clé de secours** affichée sous « Impossible de scanner ? » dans un gestionnaire de mots de passe : en cas de perte du téléphone, c'est le seul moyen de régénérer les codes. À défaut, retirer la 2FA depuis Google Cloud Shell, puis se reconnecter pour en enrôler une nouvelle :
   ```bash
   npm i firebase-admin && node -e "const {initializeApp}=require('firebase-admin/app');const {getAuth}=require('firebase-admin/auth');initializeApp({projectId:'makouez-it'});getAuth().getUserByEmail('s.makouezi@gmail.com').then(u=>getAuth().updateUser(u.uid,{multiFactor:{enrolledFactors:null}})).then(()=>console.log('2FA retirée')).catch(e=>console.error('Erreur :',e.message))"
   ```

Source : https://firebase.google.com/docs/auth/web/totp-mfa

### S2. Redéployer les Cloud Functions (emails échappés)
Les gabarits d'emails échappent maintenant les données saisies par les visiteurs.
```bash
cd functions && npm ci && firebase deploy --only functions
```

### S3. Restreindre la clé Google Maps
Google Cloud Console → *API et services* → *Identifiants* → la clé utilisée par `makouez-it-rdv.html` (commence par `AIzaSyA5`) → *Restrictions relatives aux applications* : « Sites web », ajouter `https://makouezit.org/*` et `https://www.makouezit.org/*` → *Restrictions relatives aux API* : uniquement « Places API (New) » et « Maps JavaScript API ».
La clé `AIzaSyBx…` est la configuration web Firebase : elle est publique par conception, la protection repose sur les règles Firestore (et bientôt App Check, lot 3).

### S4. Après fusion : vérifier les 404
Ces adresses doivent renvoyer « Page introuvable » : `/firestore.rules`, `/firebase.json`, `/functions/index.js`, `/functions/legacy-v2.js`, `/README.md`, `/TODO-MANUEL.md`, `/tests/rules.test.mjs`.

### S5. Lot 3 — ordre de mise en production (important)
1. **Déployer les fonctions** : `cd functions && npm ci && cd .. && firebase deploy --only functions` (nouvelles fonctions : `createReservation`, `syncSlot`, `rebuildSlots`, `unsubscribe`).
2. **Fusionner la branche** dans `main` (la page de réservation appelle désormais `createReservation`).
3. **Admin → Réservations → « 🗓 Recalculer les créneaux »** (une seule fois) : libère les créneaux bloqués par d'anciennes réservations annulées.
4. **S'être enrôlé en 2FA** (S1, étape 4) : les nouvelles règles exigent la 2FA pour tout accès admin aux données.
5. **Seulement ensuite**, déployer les règles Firestore validées : `firebase deploy --only firestore:rules`. Avant ce déploiement, l'ancienne règle permet encore de créer des réservations sans passer par la fonction.
6. Tests des règles (sur un poste avec Java) : `cd tests && npm install && npm test`. Tests des fonctions : `cd functions && npm ci && node ../tests/functions-lot3.test.cjs`.

### S6. App Check (reCAPTCHA Enterprise)
1. Google Cloud Console (projet `makouez-it`) → *Security* → *reCAPTCHA* → **Créer une clé** : type *Site Web*, domaines `makouezit.org` et `www.makouezit.org`, sans case à cocher (score). Copier l'**ID de la clé**.
2. Console Firebase → *App Check* → *Apps* → l'application web → **reCAPTCHA Enterprise** → coller l'ID de la clé → Enregistrer.
3. Me donner l'ID de la clé (ou le coller dans `appcheck-config.js` : `APP_CHECK_SITE_KEY = 'xxxx'`), puis publier.
4. **Attendre une semaine** en regardant *App Check → APIs → Cloud Firestore* : la part de requêtes « vérifiées » doit approcher 100 %.
5. Ensuite seulement : *App Check → Cloud Firestore* et *Authentication* → **Appliquer**, et passer `ENFORCE_APP_CHECK = true` dans `functions/booking.js` puis redéployer les fonctions.
   Ne pas appliquer avant : les visiteurs sans jeton valide seraient bloqués.

### S7. En-têtes de sécurité (Cloudflare)
Le site est servi directement par GitHub Pages (Cloudflare ne fait aujourd'hui que le DNS). GitHub Pages ne permet pas d'ajouter d'en-têtes : il faut faire passer le trafic par Cloudflare.
1. Cloudflare → `makouezit.org` → **SSL/TLS** → Vue d'ensemble → mode **Complet (Full)**. Pas « Flexible » (boucle de redirection), pas « Complet (strict) » (risque de coupure lors du renouvellement du certificat GitHub).
2. **DNS** → passer les enregistrements `makouezit.org` et `www` en **Proxied** (nuage orange). Vérifier que le site s'affiche.
3. **SSL/TLS → Certificats Edge** → activer **Toujours utiliser HTTPS** et **HSTS** : `max-age` 12 mois, *sans* « includeSubDomains » ni « preload » pour commencer.
4. **Règles → Transform Rules → Modifier l'en-tête de réponse** → créer une règle « Sécurité » s'appliquant à *Toutes les requêtes entrantes* avec :
   - Définir `Content-Security-Policy-Report-Only` = contenu de `securite/csp.txt` (une ligne)
   - Définir `X-Frame-Options` = `DENY`
   - Définir `X-Content-Type-Options` = `nosniff`
   - Définir `Referrer-Policy` = `strict-origin-when-cross-origin`
   - Définir `Permissions-Policy` = `camera=(), microphone=(), geolocation=(), payment=(), usb=()`
   - Définir `Cross-Origin-Opener-Policy` = `same-origin-allow-popups`
   - Supprimer `Access-Control-Allow-Origin` (ajouté par GitHub Pages, inutile pour ce site)
5. Après une semaine sans erreur « Content Security Policy » dans la console du navigateur (accueil, réservation, contrats, espace client, admin, chat), **renommer** l'en-tête `Content-Security-Policy-Report-Only` en `Content-Security-Policy`.
6. Vérifier sur https://securityheaders.com/?q=makouezit.org (objectif : note A).

### S8. Noirland Music — réservations de studio
Les règles actuelles refusent les demandes de session envoyées par `reservation.html` de noirlandmusic.com (champs `name`, `date`, `source`…). Elles échouent probablement depuis le durcissement des règles. Les nouvelles règles (S5, étape 5) réautorisent exactement ce format. Le panneau admin de Noirland lit aussi `reservations` : avec les nouvelles règles, il faudra un compte avec le claim `admin` **et** la 2FA.

---

## 🔴 Priorité haute

### 0. Adhérer à un médiateur de la consommation (obligation légale)
- **Pourquoi :** obligatoire pour vendre à des particuliers (art. L612-1 du Code de la consommation) ; l'absence peut être sanctionnée par une amende administrative.
- **Action :** adhérer à un médiateur agréé (liste officielle sur https://www.economie.gouv.fr/mediation-conso, ex. CM2C, Médiation Consommateur Française), puis compléter les emplacements prévus en commentaire dans `cgv.html` (article 10) et `mentions-legales.html` (section Médiation).

### 0 bis. Durée de conservation du chat
- **Action :** console Firebase → Firestore → *Durée de vie (TTL)* → ajouter une règle sur la collection `rate_limits`, champ `expireAt`. Sans elle, les empreintes d'IP du chat ne sont pas supprimées après 48 h, contrairement à ce qu'indique la politique de confidentialité.

### 1. Google Analytics — vérifier l'ID GA4
- **Fichier :** Tous les fichiers HTML (`G-5963KCLEX1` déjà présent)
- **Action :** Confirmer que `G-5963KCLEX1` est le bon ID GA4 dans Google Analytics → Admin → Flux de données

### 2. Facebook Pixel — insérer le vrai ID
- **Fichier :** `index.html` (chercher `TODO-PIXEL`)
- **Action :** Remplacer `XXXXXXXXXXXXXXX` par votre vrai Pixel ID Facebook
- **Lien :** Business Manager → Événements → Pixels

### 3. Google Reviews — lien vers votre fiche GMB
- **Fichier :** `index.html` (chercher `TODO-google-reviews`)
- **Action :** Remplacer `#TODO-google-reviews` par l'URL de votre fiche Google My Business
- **Format :** `https://g.page/r/VOTRE_PLACE_ID/review`

---

## 🟡 Priorité moyenne

### 5. Photo réelle de Stevy
- **Fichier :** `index.html` — section hero ou "À propos"
- **Action :** Remplacer le placeholder emoji/avatar par une vraie photo professionnelle
- **Format recommandé :** WebP, 400×400px, fond neutre

### 6. Avis clients réels
- **Fichier :** `index.html` — section `#avis`
- **Action :** Remplacer les avis factices par de vrais retours clients (nom, étoiles, texte)
- **Note :** Actuellement `reviewCount: 3` dans le Schema.org — mettre à jour au fil des avis

### 7. Portfolio — vraies URLs de démo
- **Fichier :** `portfolio.html`
- **Action :** Remplacer les liens `#` des cartes DÉMO par les vraies URLs quand les sites sont en ligne

### 8. Google Search Console — soumettre le sitemap
- **Action :** Aller sur https://search.google.com/search-console
- **Action :** Ajouter la propriété `https://makouezit.org/`
- **Action :** Aller dans Sitemaps → Soumettre `https://makouezit.org/sitemap.xml`

---

## 🟢 Priorité basse

### 9. Changer un prix
- **Fichier unique :** `tarifs.json` (tous les prix du site, de l'admin, de l'espace client, des emails et du chat IA)
- **Action :** modifier le prix dans `tarifs.json`, puis lancer `node tests/check-tarifs.mjs` : le test liste les pages dont le prix écrit en dur (celui que lit Google) est à mettre à jour.
- **Puis :** `cp tarifs.json functions/tarifs.json` (fait automatiquement par `firebase deploy`) et redéployer les fonctions pour les emails et le chat.

### 10. Dates CGV et mentions légales
- **Fichiers :** `cgv.html`, `mentions-legales.html`, `confidentialite.html`
- **Action :** Mettre à jour la date de "Dernière mise à jour" à chaque modification significative

### 11. Blog — ajouter de nouveaux articles
- **Fichiers :** Créer `slug-de-larticle.html` + ajouter à `blog.html` + ajouter à `sitemap.xml`
- **Thèmes suggérés :** sécuriser son mot de passe, choisir un antivirus, sauvegarder sur le cloud

---

## 📋 Rappels techniques

- **Domaine :** makouezit.org → pointe vers stevymak.github.io via CNAME
- **Firebase :** projet `makouez-it` (Firestore + Cloud Functions) — réservations, avis, contrats
- **Supabase :** utilisé pour le portfolio (carte Savourez Paris)
- **GitHub Pages :** branche `main` — déploiement automatique à chaque push
