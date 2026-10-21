# Kit « site clé en main » — à partir de makouezit.org

Le kit fabrique, pour chaque client, une copie complète du site de Makouez IT (pages, réservation, espace client, admin, Cloud Functions, règles Firestore) à son nom. Le site source reste makouezit.org : toute amélioration faite sur le site profite aux prochaines générations.

## Générer le site d'un client

```bash
node kit/build.mjs kit/config/<client>.json
```

Le site est produit dans `dist/<slug>/` (dossier ignoré par git), avec un fichier `RAPPORT-GENERATION.md` qui liste ce qui reste à personnaliser à la main.

Exemples fournis (clients fictifs) : `kit/config/demo-clic-repare.json` (informatique, Lyon) et `kit/config/demo-garnier-plomberie.json` (plomberie, Nantes).

Pour essayer un autre design sans toucher à la configuration : `node kit/build.mjs kit/config/<client>.json --design nuit` (sortie dans `dist/<slug>-nuit/`).

## La configuration d'un client

| Bloc | Ce qu'il contient |
| --- | --- |
| `slug` | Nom technique du dossier (minuscules, chiffres, tirets) |
| `metier` | `informatique` (textes du site source) ou le nom d'un pack de `kit/packs/` (ex. `plomberie`) |
| `design` | `clair` (d'origine), `nuit` (sombre, accent ambre) ou `artisan` (vert forêt, ocre, filets) |
| `identite` | Marque, logo en deux parties (`debut`, `accent`), prénom, nom, SIRET, adresse, `activitePrincipale` (mentions légales, avec le code NAF), et la présentation du client : `bio` (paragraphe « À propos »), `accroche` (phrase des aperçus de partage), `experience` (pour l'assistant IA), `badgeExperience` |
| `contact` | Téléphone (affiché et international), WhatsApp, emails (contact, facturation, newsletter, admin) |
| `site.domaine` | Domaine du client (écrit aussi dans CNAME) |
| `zone` | Zone d'intervention : formulations de la région et du département (voir ci-dessous), `villeBase`, `phrasePriorite`, `surDemande`, `delai`, `horaires`, `villes` |
| `zone.pagesLocalesAGarder` | Pages locales de Makouez IT à conserver (en général aucune) |
| `modules` | `portfolio`, `offresWeb`, `chatIA` : `false` pour retirer le module et ses liens |
| `firebase` | Projet Firebase du client (projectId, apiKey, messagingSenderId, appId) |
| `integrations` | Google Analytics, lien d'avis Google, clé Google Maps, clé App Check |
| `tarifs` | Chemin d'un `tarifs.json` propre au client (sinon la grille d'exemple du pack, sinon celle de Makouez IT) |

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

## La grille `tarifs.json` pilote le site

Prix, mais aussi tout ce qui en dépend :

- `services` : les entrées qui ont un `libelle` sont réservables en ligne, dans cet ordre (carte de réservation : `icone`, `carte`, `badge`, `large` ; récapitulatif : `forfait` ; demande de rappel : `rappel`, ou `false` pour l'exclure). `prix: null` = sur devis.
- `reservation` : créneaux par période, périodes proposées en semaine et le week-end, nombre de rendez-vous par jour, délai maximal, choix libres du formulaire de rappel.
- `contrats` : cartes de la page Contrats (`icone`, `description`, `avantages`, `badge`), emails de confirmation, règles Firestore.
- `promo` : code de bienvenue (bandeau de l'accueil, page de réservation, contrôle serveur). Sans ce bloc : aucun code.

`node kit/services.mjs --write` régénère les listes écrites dans les pages du site source (entre marqueurs `kit:…`) ; `node tests/check-tarifs.mjs` vérifie qu'elles suivent la grille. Le serveur (`functions/booking.js`, `callback.js`) lit directement `tarifs.json`.

## Les packs métier

Un pack (`kit/packs/<metier>.json`) transforme le site de dépannage informatique en site d'un autre métier à domicile. Pack fourni : `plomberie`.

| Bloc | Rôle |
| --- | --- |
| `tarifs` | Grille d'exemple du métier (prix **fictifs**, remplacés par la grille du client) |
| `pagesRetirees`, `modules` | Pages propres à l'informatique (blog, diagnostic, services, offres pro) et modules désactivés (chat IA, portfolio, offres web) |
| `accueil` | Titre et description, accroche, tuiles « Quel est votre besoin ? », forfaits, autres offres, étapes, valeurs, FAQ (et données structurées), pied de page |
| `servicesPages` | Une page par service (`fichier`, `titre`, `description`, `intro`, `sections`), avec prix et liens croisés |
| `villes` | Textes des pages par ville et de la page département (préfixe des fichiers, titres, cartes, forfaits) |
| `equipements` | Carnet d'équipements de l'espace client (types, libellés) et règle Firestore correspondante |
| `contratsPage`, `cgvServices`, `conseils` | Page Contrats, article « Services proposés » des CGV, conseils de l'espace client |
| `remplacements` | Phrases de l'informatique restant dans les pages gardées (réservation, espace client, emails) |

Les textes acceptent `{prenom}`, `{marque}`, `{telephone}`, `{villeBase}`, `{departementEn}`, `{regionEn}` et tout chemin de prix (`{depannage.deplacement.prix}`). Le rapport de génération liste les prix introuvables, les termes informatiques restants et les textes à faire valider par le client (CGV, mentions légales, statut et TVA).

Pour un nouveau métier : copier `plomberie.json`, réécrire les textes et la grille, générer, puis lire le rapport.

## Ce que fait le générateur

1. Copie le site sans les fichiers internes (notes, tests, kit, sauvegardes de code).
2. Remplace l'identité : logos, marque, nom, téléphone, emails, SIRET, adresse, domaine, projet Firebase, adresses des fonctions, Analytics, avis Google, clé Maps.
3. Retire les pages locales de Makouez IT, les modules non souscrits et les liens qui y menaient ; filtre le sitemap.
4. Génère les pages par ville et la page département, adapte le bloc « Zone d'intervention » de l'accueil, les données structurées, les suggestions d'adresse et l'assistant IA.
5. Retire Noirland Music : code des 5 fonctions et règle de création Firestore.
6. Applique le design choisi : palette transformée famille par famille (accent, neutres, action, alertes) en gardant les contrastes, polices, feuille de forme `theme-design.css`.
7. Écrit `CNAME`, `.firebaserc`, `tarifs.json` et le rapport.

Avec un pack métier, il applique aussi le pack (étape 2 ter) : listes de services et créneaux régénérés depuis la grille du client, accueil, pages services, contrats, CGV, espace client.

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
| 4. Trois designs | Fait : clair, nuit, artisan ; contraste vérifié sur les 29 pages publiques (WCAG AA), aucun débordement mobile. L'admin garde son propre thème |
| 5. Pack « services à domicile » | Fait : grille qui pilote services, créneaux, contrats et code promo ; packs métier ; pack plomberie et démo Garnier Plomberie (23 pages, 3 designs, contraste AA) |
| 6. Installation automatisée | À faire (procédure manuelle ci-dessus) |
| 7. Vitrine commerciale | Démo publiée (3 designs, 3 métiers fictifs) |
