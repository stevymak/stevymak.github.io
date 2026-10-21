# Kit « site clé en main » — à partir de makouezit.org

Le kit fabrique, pour chaque client, une copie complète du site de Makouez IT (pages, réservation, espace client, admin, Cloud Functions, règles Firestore) à son nom. Le site source reste makouezit.org : toute amélioration faite sur le site profite aux prochaines générations.

## Générer le site d'un client

```bash
node kit/build.mjs kit/config/<client>.json
```

Le site est produit dans `dist/<slug>/` (dossier ignoré par git), avec un fichier `RAPPORT-GENERATION.md` qui liste ce qui reste à personnaliser à la main.

Exemple fourni (client fictif) : `kit/config/demo-clic-repare.json`.

## La configuration d'un client

| Bloc | Ce qu'il contient |
| --- | --- |
| `slug` | Nom technique du dossier (minuscules, chiffres, tirets) |
| `metier` | `informatique` aujourd'hui ; le pack « services à domicile » arrive à l'étape 5 |
| `design` | `clair` aujourd'hui ; `nuit` et `artisan` arrivent à l'étape 4 |
| `identite` | Marque, logo en deux parties (`debut`, `accent`), prénom, nom, SIRET, adresse, et la présentation du client : `bio` (paragraphe « À propos »), `accroche` (phrase des aperçus de partage), `experience` (pour l'assistant IA) |
| `contact` | Téléphone (affiché et international), WhatsApp, emails (contact, facturation, newsletter, admin) |
| `site.domaine` | Domaine du client (écrit aussi dans CNAME) |
| `zone` | Zone d'intervention : formulations de la région et du département (voir ci-dessous), `villeBase`, `phrasePriorite`, `surDemande`, `delai`, `horaires`, `villes` |
| `zone.pagesLocalesAGarder` | Pages locales de Makouez IT à conserver (en général aucune) |
| `modules` | `portfolio`, `offresWeb`, `chatIA` : `false` pour retirer le module et ses liens |
| `firebase` | Projet Firebase du client (projectId, apiKey, messagingSenderId, appId) |
| `integrations` | Google Analytics, lien d'avis Google, clé Google Maps, clé App Check |
| `tarifs` | Chemin d'un `tarifs.json` propre au client (sinon la grille de Makouez IT) |

`kit/config/source-makouez-it.json` décrit les valeurs actuelles du site source : le générateur les remplace par celles du client. À mettre à jour si l'identité de Makouez IT change.

## La zone et les pages par ville

Le français ne se remplace pas mot pour mot (« en Île-de-France », « d'Île-de-France », « la Seine-Saint-Denis »…) : la configuration donne chaque tournure.

| Clé | Remplace | Exemple (Lyon) |
| --- | --- | --- |
| `region` | Île-de-France | la métropole de Lyon |
| `regionEn` | en Île-de-France | dans la métropole de Lyon |
| `regionDe` | d'Île-de-France | de la métropole de Lyon |
| `regionLa` | l'Île-de-France | la métropole de Lyon |
| `departement`, `departementCode` | Seine-Saint-Denis, 93 | Rhône, 69 |
| `departementEn` | en Seine-Saint-Denis | dans le Rhône |
| `departementDe` | de (la) Seine-Saint-Denis | du Rhône |
| `departementLe` | la Seine-Saint-Denis | le Rhône |

Chaque ville de `villes` donne une page `depannage-informatique-<ville>.html` ; une page département regroupe toutes les villes. Champs d'une ville : `nom`, `codePostal`, `principale`, `quartiers`, `voisines`, `intro` et `sections` (liste de `{titre, texte}`).

**Contenu unique obligatoire.** Une page de ville n'est publiée (indexable et dans le sitemap) que si elle a une `intro` et au moins 2 `sections` écrites pour cette ville. Sinon elle existe pour les visiteurs mais reste en `noindex` : des pages presque identiques d'une ville à l'autre font baisser tout le site dans Google. Le rapport liste les villes à compléter.

## Ce que fait le générateur

1. Copie le site sans les fichiers internes (notes, tests, kit, sauvegardes de code).
2. Remplace l'identité : logos, marque, nom, téléphone, emails, SIRET, adresse, domaine, projet Firebase, adresses des fonctions, Analytics, avis Google, clé Maps.
3. Retire les pages locales de Makouez IT, les modules non souscrits et les liens qui y menaient ; filtre le sitemap.
4. Génère les pages par ville et la page département, adapte le bloc « Zone d'intervention » de l'accueil, les données structurées, les suggestions d'adresse et l'assistant IA.
5. Retire Noirland Music : code des 5 fonctions et règle de création Firestore.
6. Écrit `CNAME`, `.firebaserc`, `tarifs.json` et le rapport.

## Installer le site d'un client (procédure actuelle, à automatiser à l'étape 6)

1. Créer le projet Firebase du client (région europe-west1), passer en forfait Blaze, activer Authentication (email/mot de passe + lien par email) et Firestore.
2. Reporter sa configuration web dans `kit/config/<client>.json`, puis générer.
3. Dans `dist/<slug>/functions` : `npm ci`, puis créer le secret `RESEND_API_KEY` (et `ANTHROPIC_API_KEY` si le chat IA est vendu).
4. `firebase deploy --only functions,firestore:rules --project <projectId>`.
5. Publier le dossier sur l'hébergement du client (GitHub Pages ou Firebase Hosting) et brancher son domaine.
6. Créer son compte admin, lui donner le claim `admin`, activer le TOTP et l'enrôler (même procédure que TODO-MANUEL.md, C1).

## Feuille de route

| Étape | Statut |
| --- | --- |
| 1. Noirland hors du produit | Fait dans le kit (retrait à la génération) |
| 2. Configuration unique | Fait : identité, contact, domaine, Firebase, intégrations, modules, tarifs |
| 3. Générateur de pages | Fait : identité, présentation, textes de zone, pages par ville et page département, accueil, sitemap |
| 4. Trois designs | À faire (passage des couleurs du site en variables de thème) |
| 5. Pack « services à domicile » | À faire |
| 6. Installation automatisée | À faire (procédure manuelle ci-dessus) |
| 7. Vitrine commerciale | Démo publiée (3 designs, 3 métiers fictifs) |
