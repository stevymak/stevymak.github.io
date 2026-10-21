// ─────────────────────────────────────────────────────────────────────────────
// auth-guard.js — Login + 2FA (TOTP) + onAuthStateChanged + bascule login/dashboard.
//
// Parcours :
//   1. email + mot de passe
//   2. si le compte a une 2FA : code à 6 chiffres de l'application d'authentification
//   3. si le compte admin n'a PAS encore de 2FA : enrôlement obligatoire (QR code)
//      avant d'accéder au tableau de bord.
//
// Pré-requis côté Firebase : TOTP activé sur le projet (voir TODO-MANUEL.md,
// section « 2FA admin »). Tant que ce n'est pas fait, l'accès reste possible
// avec un bandeau d'avertissement (mode transitoire, pour ne pas bloquer l'admin).
// ─────────────────────────────────────────────────────────────────────────────

import { auth, fns, onAuthStateChanged } from './firebase.js';
import { initRouter } from './router.js';

import { loadAll }            from '../modules/reservations.js';
import { loadAvis,
         loadAvisEnAttente }  from '../modules/avis.js';
import { loadContrats }       from '../modules/contrats.js';
import { loadMessages }       from '../modules/messages.js';
import { loadClientsMeta }    from '../modules/clients.js';
import { loadDevis }          from '../modules/devis.js';
import { loadFactures }       from '../modules/factures.js';
import { loadTemplates,
         loadCampagnes,
         loadFiches,
         loadAutomationSettings } from '../modules/communications.js';

// Exiger la 2FA pour tout compte admin.
const ENFORCE_ADMIN_MFA = true;
const MFA_ISSUER        = 'Makouez IT';

let routerStarted = false;
let mfaResolver   = null;   // résolveur de connexion 2FA en cours
let totpSecret    = null;   // secret TOTP en cours d'enrôlement

const $ = (id) => document.getElementById(id);

// Affiche une seule des trois cartes de connexion (ou le tableau de bord).
function showScreen(name) {
  const wrap = $('loginWrap');
  const dash = $('dashboard');
  if (name === 'dashboard') {
    wrap.style.display = 'none';
    dash.style.display = 'flex';
    return;
  }
  wrap.style.display = 'flex';
  dash.style.display = 'none';
  $('loginCard').style.display = name === 'login'  ? 'flex' : 'none';
  $('mfaStep').style.display   = name === 'mfa'    ? 'flex' : 'none';
  $('mfaEnroll').style.display = name === 'enroll' ? 'flex' : 'none';
}

function showError(id, msg) {
  const el = $(id);
  if (!el) return;
  el.textContent = msg;
  el.style.display = msg ? 'block' : 'none';
}

function setBusy(btnId, busy, label) {
  const btn = $(btnId);
  if (!btn) return;
  btn.disabled = busy;
  btn.textContent = busy ? 'Vérification…' : label;
}

function readCode(inputId) {
  return ($(inputId).value || '').replace(/\D/g, '').slice(0, 6);
}

const ERR = {
  'auth/invalid-email':             'Email invalide.',
  'auth/user-not-found':            'Email ou mot de passe incorrect.',
  'auth/wrong-password':            'Email ou mot de passe incorrect.',
  'auth/invalid-credential':        'Email ou mot de passe incorrect.',
  'auth/too-many-requests':         'Trop de tentatives. Réessayez dans quelques minutes.',
  'auth/invalid-verification-code': 'Code incorrect ou expiré.',
  'auth/missing-code':              'Saisissez le code à 6 chiffres.',
  'auth/requires-recent-login':     'Session trop ancienne : déconnectez-vous puis reconnectez-vous pour activer la 2FA.',
  'auth/unverified-email':          "L'adresse email du compte admin doit être vérifiée avant d'activer la 2FA.",
  'auth/totp-challenge-timeout':    'Délai dépassé. Reconnectez-vous.',
};
const errMsg = (e, fallback) => ERR[e && e.code] || fallback;

// ─── Contrôle d'accès ───────────────────────────────────────────────────────
export function bootAuth() {
  onAuthStateChanged(auth, async (user) => {
    $('pageLoader').classList.add('hidden');

    if (!user) {
      showScreen(mfaResolver ? 'mfa' : 'login');
      return;
    }

    // Seuls les comptes avec le claim `admin` accèdent au tableau de bord.
    // (Les clients de l'espace client sont aussi des utilisateurs Firebase.)
    let isAdmin = false;
    try {
      let tok = await user.getIdTokenResult();
      isAdmin = tok.claims && tok.claims.admin === true;
      if (!isAdmin) {
        tok = await user.getIdTokenResult(true); // jeton rafraîchi
        isAdmin = tok.claims && tok.claims.admin === true;
      }
    } catch (e) { isAdmin = false; }

    if (!isAdmin) {
      await fns.signOut(auth);
      showScreen('login');
      showError('errMsg', "Ce compte n'a pas accès à l'administration.");
      return;
    }

    if (ENFORCE_ADMIN_MFA) {
      const enrolled = fns.multiFactor(user).enrolledFactors.length > 0;
      if (!enrolled) {
        const started = await startEnrollment(user);
        if (started) return;               // l'admin doit d'abord activer la 2FA
        // TOTP pas encore activé sur le projet : accès transitoire + avertissement
      }
    }

    enterDashboard(user);
  });
}

function enterDashboard(user) {
  showScreen('dashboard');
  $('adminEmail').textContent = user.email;

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
  loadTemplates();
  loadCampagnes();
  loadFiches();
  loadAutomationSettings();
  loadMessages();
}

// ─── Étape 1 : email + mot de passe ─────────────────────────────────────────
async function login() {
  const email = $('emailInput').value.trim();
  const pwd   = $('pwdInput').value;

  if (!email || !pwd) {
    showError('errMsg', 'Veuillez remplir tous les champs.');
    return;
  }

  setBusy('loginBtn', true, 'Se connecter');
  showError('errMsg', '');

  try {
    await fns.signInWithEmailAndPassword(auth, email, pwd);
  } catch (e) {
    if (e.code === 'auth/multi-factor-auth-required') {
      mfaResolver = fns.getMultiFactorResolver(auth, e);
      $('mfaCodeInput').value = '';
      showError('mfaErr', '');
      showScreen('mfa');
      setTimeout(() => $('mfaCodeInput').focus(), 50);
    } else {
      showError('errMsg', errMsg(e, 'Erreur de connexion.'));
    }
  } finally {
    setBusy('loginBtn', false, 'Se connecter');
  }
}

// ─── Étape 2 : code TOTP à la connexion ─────────────────────────────────────
async function verifyMfaCode() {
  if (!mfaResolver) { showScreen('login'); return; }
  const code = readCode('mfaCodeInput');
  if (code.length !== 6) { showError('mfaErr', 'Saisissez le code à 6 chiffres.'); return; }

  const hint = mfaResolver.hints.find((h) => h.factorId === fns.TotpMultiFactorGenerator.FACTOR_ID);
  if (!hint) {
    showError('mfaErr', "Aucune application d'authentification n'est associée à ce compte.");
    return;
  }

  setBusy('mfaBtn', true, 'Valider');
  try {
    const assertion = fns.TotpMultiFactorGenerator.assertionForSignIn(hint.uid, code);
    const resolver  = mfaResolver;
    mfaResolver = null;                     // onAuthStateChanged prend le relais
    await resolver.resolveSignIn(assertion);
  } catch (e) {
    showError('mfaErr', errMsg(e, 'Vérification impossible. Réessayez.'));
  } finally {
    setBusy('mfaBtn', false, 'Valider');
  }
}

function cancelMfa() {
  mfaResolver = null;
  $('pwdInput').value = '';
  showScreen('login');
}

// ─── Enrôlement 2FA (premier accès admin) ───────────────────────────────────
// Renvoie true si l'écran d'enrôlement est affiché, false si la 2FA n'est pas
// disponible sur le projet (accès transitoire avec avertissement).
async function startEnrollment(user) {
  try {
    const session = await fns.multiFactor(user).getSession();
    totpSecret = await fns.TotpMultiFactorGenerator.generateSecret(session);
  } catch (e) {
    if (e.code === 'auth/operation-not-allowed' || e.code === 'auth/admin-restricted-operation') {
      const w = $('mfaWarning');
      if (w) {
        w.textContent = "⚠ La vérification en deux étapes n'est pas encore activée sur le projet Firebase. Suivez la procédure « 2FA admin » de TODO-MANUEL.md.";
        w.style.display = 'block';
      }
      return false;
    }
    showScreen('enroll');
    $('mfaQr').textContent = '';
    showError('mfaEnrollErr', errMsg(e, "Impossible de préparer l'activation de la 2FA."));
    return true;
  }

  const uri = totpSecret.generateQrCodeUrl(user.email || 'admin', MFA_ISSUER);
  const qrBox = $('mfaQr');
  qrBox.textContent = '';
  try {
    const qr = window.qrcode(0, 'M');
    qr.addData(uri);
    qr.make();
    const img = document.createElement('img');
    img.src = qr.createDataURL(6, 2);
    img.alt = 'QR code à scanner avec votre application d’authentification';
    qrBox.appendChild(img);
  } catch (e) {
    qrBox.textContent = 'QR code indisponible : utilisez la clé ci-dessous.';
  }
  $('mfaSecret').textContent = totpSecret.secretKey;
  $('mfaEnrollCode').value = '';
  showError('mfaEnrollErr', '');
  showScreen('enroll');
  setTimeout(() => $('mfaEnrollCode').focus(), 50);
  return true;
}

async function confirmMfaEnroll() {
  const user = auth.currentUser;
  if (!user || !totpSecret) { showScreen('login'); return; }
  const code = readCode('mfaEnrollCode');
  if (code.length !== 6) { showError('mfaEnrollErr', 'Saisissez le code à 6 chiffres.'); return; }

  setBusy('mfaEnrollBtn', true, 'Activer la 2FA');
  try {
    const assertion = fns.TotpMultiFactorGenerator.assertionForEnrollment(totpSecret, code);
    await fns.multiFactor(user).enroll(assertion, 'Application d’authentification');
    totpSecret = null;
    // L'enrôlement révoque la session : on demande une reconnexion avec le code.
    await fns.signOut(auth);
    showScreen('login');
    showError('errMsg', '✅ 2FA activée. Reconnectez-vous : le code vous sera demandé.');
  } catch (e) {
    showError('mfaEnrollErr', errMsg(e, 'Activation impossible. Vérifiez le code et réessayez.'));
  } finally {
    setBusy('mfaEnrollBtn', false, 'Activer la 2FA');
  }
}

async function logout() {
  mfaResolver = null;
  totpSecret  = null;
  await fns.signOut(auth);
  setBusy('loginBtn', false, 'Se connecter');
  $('emailInput').value = '';
  $('pwdInput').value = '';
  showScreen('login');
}

// Compat handlers inline (onclick="login()" / onclick="logout()")
window.login            = login;
window.logout           = logout;
window.verifyMfaCode    = verifyMfaCode;
window.cancelMfa        = cancelMfa;
window.confirmMfaEnroll = confirmMfaEnroll;
