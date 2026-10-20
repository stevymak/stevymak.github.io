'use strict';
// Fonctions de production (v2, europe-west1) : réservations, contrats, Noirland, chat Claude, rappel manuel.
Object.assign(exports, require('./legacy-v2'));
// Fonctions additionnelles (europe-west1) : demandes d'avis, relances auto, factures, campagnes, webhook Resend,
// automations, synchronisation des avis Google. (sendReminderManual reste celui de legacy-v2.)
Object.assign(exports, require('./extras'));
// Réservations côté serveur (création, quota, créneaux) — lot 3 de l'audit.
const { _test: _bookingTest, ...booking } = require('./booking');
Object.assign(exports, booking);
// Désinscription des emails commerciaux — lot 3 de l'audit.
Object.assign(exports, require('./unsubscribe').functions);
// Demande de rappel depuis l'accueil — lot 4 de l'audit.
Object.assign(exports, require('./callback'));
