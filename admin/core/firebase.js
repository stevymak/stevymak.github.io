// ─────────────────────────────────────────────────────────────────────────────
// firebase.js — Initialisation Firebase + exports partagés.
//
// Garde la compat avec les anciens accès `window._db / window._auth / window._fns`
// pour faciliter une migration progressive vers les imports ES modules natifs.
// ─────────────────────────────────────────────────────────────────────────────

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  addDoc,
  orderBy,
  query,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js';
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import {
  getFunctions,
  httpsCallable,
} from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';

const firebaseConfig = {
  apiKey: 'AIzaSyBx6R4LC9HOt4wXbG2VmjI9nmLciwzDmz0',
  authDomain: 'makouez-it.firebaseapp.com',
  projectId: 'makouez-it',
  storageBucket: 'makouez-it.firebasestorage.app',
  messagingSenderId: '558314427247',
  appId: '1:558314427247:web:83e656344dd79019ccce9a',
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

const functionsInstance = getFunctions(app, 'europe-west1');

export const fns = {
  collection,
  getDocs,
  doc,
  updateDoc,
  deleteDoc,
  addDoc,
  query,
  orderBy,
  serverTimestamp,
  signInWithEmailAndPassword,
  signOut,
};

export { onAuthStateChanged };

export const callSendReminder = httpsCallable(functionsInstance, 'sendReminderManual');

// Compat globale pour les modules historiques. À retirer module par module
// au fil des phases suivantes.
window._db = db;
window._auth = auth;
window._fns = fns;
window._callSendReminder = callSendReminder;
