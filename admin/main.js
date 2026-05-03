// ─────────────────────────────────────────────────────────────────────────────
// main.js — Point d'entrée. Charge tous les modules dans l'ordre et démarre
// la boucle d'authentification.
//
// Pourquoi un import statique de chaque module ? Ils enregistrent leurs
// abonnements au bus à l'évaluation. Le lazy-load par module sera introduit
// en Phase 1+ une fois que les nouveaux modules (factures, CRM, …) seront
// effectivement plus lourds.
// ─────────────────────────────────────────────────────────────────────────────

import './core/firebase.js';
import './modules/dashboard.js';
import './modules/calendrier.js';
import './modules/reservations.js';
import './modules/contrats.js';
import './modules/avis.js';
import './modules/clients.js';
import './modules/finance.js';
import { bootAuth } from './core/auth-guard.js';

bootAuth();
