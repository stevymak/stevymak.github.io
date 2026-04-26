# TODO Manuel — Makouez IT

Actions à réaliser manuellement par Stevy. Le code est en place ; seules les données réelles manquent.

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
