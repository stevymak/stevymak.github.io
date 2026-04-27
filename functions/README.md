# Firebase Functions

Ce dossier prépare le patch 13 : demande automatique d'avis Google après une intervention terminée.

## Ce que fait la fonction

- écoute les mises à jour sur `reservations/{id}` ;
- déclenche uniquement quand `status` passe de n'importe quelle valeur à `completed` ;
- crée une entrée dans `email_queue` avec le contenu d'email à envoyer au client.

## Ce qu'il reste à brancher

1. Remplacer `REVIEW_LINK` dans `functions/index.js` par le vrai lien Google Business.
2. Choisir un vrai provider d'email transactionnel.
3. Déployer Firebase Functions avec une config Firebase présente dans le repo (`firebase.json`, `.firebaserc`) ou via votre projet Firebase existant.
4. Si vous voulez une relance à J+7, ajouter Cloud Scheduler ou Cloud Tasks.

## Dépendances

```bash
cd functions
npm install
```

## Déploiement

```bash
firebase deploy --only functions
```

## Remarque importante

Le code est volontairement honnête : il ne prétend pas envoyer un email sans provider configuré.
Il prépare la file `email_queue`, ce qui permet d'intégrer ensuite Brevo, Resend, Mailgun ou un autre système sans réécrire la logique métier.
