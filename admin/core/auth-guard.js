// ─────────────────────────────────────────────────────────────────────────────
// auth-guard.js — Login + onAuthStateChanged + bascule login/dashboard.
// ─────────────────────────────────────────────────────────────────────────────

import { auth, fns, onAuthStateChanged } from './firebase.js';
import { initRouter } from './router.js';

import { loadAll }            from '../modules/reservations.js';
import { loadAvis,
         loadAvisEnAttente }  from '../modules/avis.js';
import { loadContrats }       from '../modules/contrats.js';
import { loadClientsMeta }    from '../modules/clients.js';
import { loadDevis }          from '../modules/devis.js';
import { loadFactures }       from '../modules/factures.js';

let routerStarted = false;

export function bootAuth() {
  onAuthStateChanged(auth, (user) => {
    document.getElementById('pageLoader').classList.add('hidden');

    if (user) {
      document.getElementById('loginWrap').style.display = 'none';
      document.getElementById('dashboard').style.display = 'flex';
      document.getElementById('adminEmail').textContent  = user.email;

      if (!routerStarted) {
        initRouter();
        routerStarted = true;
      }

      loadAll();
      loadAvis();
      loadAvisEnAttente();
      loadContrats();
      loadClientsMeta();
      loadDevis();
      loadFactures();
    } else {
      document.getElementById('loginWrap').style.display = 'flex';
      document.getElementById('dashboard').style.display = 'none';
    }
  });
}

async function login() {
  const email = document.getElementById('emailInput').value.trim();
  const pwd   = document.getElementById('pwdInput').value;
  const btn   = document.getElementById('loginBtn');
  const err   = document.getElementById('errMsg');

  if (!email || !pwd) {
    err.textContent = 'Veuillez remplir tous les champs.';
    err.style.display = 'block';
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<div class="spinner" style="width:18px;height:18px;border-width:2px;margin:0"></div> Connexion...';
  err.style.display = 'none';

  try {
    await fns.signInWithEmailAndPassword(auth, email, pwd);
  } catch (e) {
    btn.disabled = false;
    btn.innerHTML = 'Se connecter';
    const msgs = {
      'auth/invalid-email':       'Email invalide.',
      'auth/user-not-found':      'Compte introuvable.',
      'auth/wrong-password':      'Mot de passe incorrect.',
      'auth/invalid-credential':  'Email ou mot de passe incorrect.',
      'auth/too-many-requests':   'Trop de tentatives.',
    };
    err.textContent = msgs[e.code] || 'Erreur de connexion.';
    err.style.display = 'block';
  }
}

async function logout() {
  await fns.signOut(auth);
  document.getElementById('emailInput').value = '';
  document.getElementById('pwdInput').value = '';
}

// Compat handlers inline (onclick="login()" / onclick="logout()")
window.login  = login;
window.logout = logout;
