'use strict';
// Fonctions de production (v2, europe-west1) : réservations, contrats, Noirland, chat Claude, rappel manuel.
Object.assign(exports, require('./legacy-v2'));
// Fonctions additionnelles (europe-west1) : demandes d'avis, relances auto, factures, campagnes, webhook Resend,
// automations, synchronisation des avis Google. (sendReminderManual reste celui de legacy-v2.)
Object.assign(exports, require('./extras'));
