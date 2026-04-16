# Firestore Notes

Ce dépôt utilise Firestore directement depuis le front.
Le fichier [firestore.rules](./firestore.rules) fournit une base de règles plus sûre que l'état implicite actuel.

## Hypothèses prises

- Les comptes admin Firebase reçoivent un custom claim `admin: true`.
- Les clients authentifiés utilisent Firebase Auth avec une adresse email vérifiée côté token.
- `reservations` devrait idéalement porter un champ `uid` propriétaire quand la réservation appartient à un client connecté.

## Décalages importants à corriger

### 1. Réservations et propriété client

`makouez-it-rdv.html` accepte désormais deux parcours :

- sans mot de passe : la réservation est créée sans `uid` et reste visible côté admin ; le client est recontacté par email/téléphone ;
- avec mot de passe : un compte Firebase Auth est créé/reconnecté et la réservation est enregistrée avec `uid`, ce qui la rend visible dans `mon-rdv.html`.

Le même principe s’applique au flux contrats :

- sans mot de passe : demande de contrat créée sans `uid`, visible côté admin ;
- avec mot de passe : document `contrats` enregistré avec `uid` + `email`, donc visible dans l’espace client.

Point restant :

- le compte client est facultatif pour maximiser la conversion ;
- le suivi détaillé en ligne nécessite un compte client ;
- si vous voulez réintroduire un suivi public sans compte, il faudra passer par un backend / token signé, pas par une lecture directe Firestore depuis le navigateur.

### 2. Pages de suivi public par simple `id`

- `suivi-rdv.html?id=...`
- `suivi-contrat.html?id=...`
- `mes-demandes.html?email=...`

Ces flux ne sont pas compatibles avec des règles Firestore strictes si on garde un accès direct depuis le navigateur.

Solution recommandée :

- remplacer les lectures Firestore directes par un backend léger ou une Cloud Function ;
- utiliser un token signé à durée limitée ;
- ne jamais exposer la lecture d'un document privé seulement parce qu'un utilisateur connaît son `id`.

### 3. Admin front direct

`admin.html` suppose un accès complet à plusieurs collections.
Les règles proposées exigent un custom claim admin.

Exemple d'approche côté Firebase Admin SDK :

```js
await admin.auth().setCustomUserClaims(uid, { admin: true });
```

## Collections couvertes

- `reservations`
- `contrats`
- `messages_clients`
- `avis`
- `avis_en_attente`
- `devis_web`

## Collections à surveiller

Si d'autres collections apparaissent ensuite, elles seront bloquées par défaut car `firestore.rules` termine par :

```rules
match /{document=**} {
  allow read, write: if false;
}
```

C'est volontaire.
