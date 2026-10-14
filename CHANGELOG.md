# Changelog — Makouez IT

## [2026-04-25] Refonte stratégique complète (Phases 1–6)

### Phase 1 — Corrections critiques
- Titre, meta description et Schema.org corrigés : zone élargie à l'Île-de-France (8 départements)
- FAQ : zone d'intervention et tarifs mis à jour
- Blog : liens des 6 cartes corrigés (5 articles existants + fallback blog.html)
- Google Reviews : lien factice remplacé par un TODO commenté
- Facebook Pixel : code placeholder commenté (TODO : insérer vrai ID)
- `aggregateRating` reviewCount : 12 → 3 (aligné sur la réalité)

### Phase 2 — Refonte tarifaire
- 3 forfaits à domicile : Diag Express 55€ / Standard 89€ / Long format 129€
- Bandeau SAP crédit d'impôt 50% (sous réserve d'agrément)
- Prix nets affichés (après crédit d'impôt) sur chaque forfait
- Contrat Découverte 19€/mois ajouté (1ère position)
- Contrat Senior+ : 60€ → 55€ / Famille : 70€ → 79€
- Tarifs web mis à jour : Site vitrine 990€ / E-commerce 1 890€ / App 3 500€
- `contrats.html` : nouveau contrat Découverte, mise à jour des prix, tableau comparatif
- `contrats-pro.html` : nouvelle page pro (tarifs horaires HT + 3 contrats Pro)

### Phase 3 — SEO local
- 4 pages departementales : Paris 75, Hauts-de-Seine 92, Seine-Saint-Denis 93, Val-de-Marne 94
- `depannage-pc-ile-de-france.html` : page IDF générale
- 6 pages de service : dépannage PC, installation Windows, réseau Wi-Fi, récupération données, sauvegarde/sécurité, formation
- Chaque page : Schema.org Service + FAQPage + BreadcrumbList, FAQ accordéon, 3 tarifs, WhatsApp FAB
- `sitemap.xml` : 29 → 36 URLs, chemins blog corrigés (suppression préfixe /blog/)

### Phase 4 — UX & conversion
- Diagnostic : CTA hero mis en avant (btn-primary)
- Exit popup supprimé → bandeau promo sticky bas-de-page (BIENVENUE10 −10%)
- Portfolio : 2 projets réels (Makouez IT, Savourez Paris) + 3 cartes DÉMO
- Section zone corrigée : Seine-Saint-Denis → Île-de-France

### Phase 5 — Performance & accessibilité
- Polices Google : preconnect crossorigin + preload + media=print/onload (non bloquant)
- Landmark `<main id="main-content">` autour du contenu principal
- 3 modals (suivi/avis/blog) : `role=dialog`, `aria-modal`, `aria-labelledby`, `aria-label` close
- `btnSuiviNav` : aria-label descriptif
- Hamburger : `aria-expanded` + `aria-controls` synchronisés dynamiquement
- FAQ : réponses mises à jour (zone IDF, 3 forfaits + crédit SAP)

### Phase 6 — Mentions SAP légales
- `services-a-la-personne.html` : page dédiée crédit d'impôt (fonctionnement, étapes, tableau net, FAQ 6 questions)
- `cgv.html` : article 9 SAP complet, tarifs actualisés (Découverte/Senior+/Famille)
- `index.html` footer : mention légale astérisque + lien vers la page SAP
- `sitemap.xml` : page SAP ajoutée (priority 0.75)

## 2026-10-13 — Corrections issues de l'audit
- Blog : contenu des 6 articles remis dans les bons fichiers ; canonicals `/blog/...` corrigés ; `pourquoi-mon-pc-est-lent.html` créé ; vraie page 404.
- Accueil : 3 liens 404 réparés ; page `depannage-informatique-pierrefitte-sur-seine.html` créée.
- Canonicals/JSON-LD `.fr` → `.org` (5 pages service) ; `vatID` erroné retiré.
- SAP : prix « net » retirés, discours « déclaration » (plus d'agrément), plafond 3 000 €, section « exemple de coût réel » supprimée.
- Prix : CGV alignées sur l'accueil, TTC/HT retirés (franchise en base, art. 293 B), Sérénité/Famille alignés (2 et 3 interventions/mois).
- Légal : mentions, CGV (formulaire de rétractation), confidentialité (Google Maps, Analytics, FCM, PayPal, transferts).
- Cookies : `consent.js` (Google Analytics seulement après accord, choix 6 mois).
- Faux avis retirés ; état vide ; échappement HTML des avis.
- Pages Landes : noindex ; sitemap nettoyé (pages noindex retirées, nouvelles pages ajoutées).
- Firestore : `slots`, identifiants de contrats, champs/tailles bornés, e-mail vérifié, pas de réouverture d'une réservation annulée.
- Admin : accès au tableau de bord réservé au claim `admin`. Webhook Resend : signature Svix (si RESEND_WEBHOOK_SECRET défini).

## 2026-10-14 — Thème clair haute lisibilité + ménage
- Nouveau `theme-clair.css` (fond blanc, texte #111827, base 18 px, contrastes ≥ 4,5:1 vérifiés par script, boutons 2 px, focus visible) chargé sur 25 pages ; polices < 14,4 px remontées.
- Bandeau cookies clair, boutons Refuser/Accepter de même poids.
- Accueil : menu réduit à Services, Tarifs, Avis, Contact (+ Espace client, Rendez-vous) ; menu mobile corrigé (le bouton RDV débordait).
- 10 pages Landes supprimées (déjà en noindex) ; villes de la zone d'intervention cliquables (Aubervilliers, Stains, Épinay désormais liées).
- Numéro de téléphone corrigé dans `functions/index.js` (07 45 10 38 27) ; restes d'obfuscation Cloudflare retirés de index.html et mon-rdv.html ; 5 titres raccourcis ; règle `str(d.get('service', null), 120)` dans firestore.rules.
