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

---

## 🔴 Priorité haute

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

### 4. Agrément SAP — mettre à jour le numéro
- **Fichiers :** `services-a-la-personne.html`, `index.html`, `cgv.html`, `contrats.html`
- **Action :** Dès réception de l'agrément DREETS, remplacer toutes les mentions "en cours" par le numéro officiel
- **Recherche :** `grep -r "en cours" *.html`

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

### 9. Tarifs CGV — mise à jour annuelle
- **Fichier :** `cgv.html` → Article 3 (Tarifs)
- **Action :** Mettre à jour les tarifs dès qu'ils changent pour rester cohérent avec `index.html` et `contrats.html`

### 10. Dates CGV et mentions légales
- **Fichiers :** `cgv.html`, `mentions-legales.html`, `confidentialite.html`
- **Action :** Mettre à jour la date de "Dernière mise à jour" à chaque modification significative

### 11. Blog — ajouter de nouveaux articles
- **Fichiers :** Créer `slug-de-larticle.html` + ajouter à `blog.html` + ajouter à `sitemap.xml`
- **Thèmes suggérés :** sécuriser son mot de passe, choisir un antivirus, sauvegarder sur le cloud

### 12. Numéro de médiateur de consommation
- **Fichier :** `cgv.html` → Article 10 (Litiges)
- **Action :** Indiquer le nom et l'URL du médiateur de la consommation (obligatoire pour les CGV B2C)
- **Option :** CM2C, Médiateur du numérique, ou FEVAD selon votre secteur

---

## 📋 Rappels techniques

- **Domaine :** makouezit.org → pointe vers stevymak.github.io via CNAME
- **Firebase :** projet `makouez-it` (Firestore + Cloud Functions) — réservations, avis, contrats
- **Supabase :** utilisé pour le portfolio (carte Savourez Paris)
- **GitHub Pages :** branche `main` — déploiement automatique à chaque push
