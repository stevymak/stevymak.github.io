/* consent.js – Makouez IT
 * Charge Google Analytics 4 uniquement après consentement explicite.
 * Choix mémorisé 6 mois (localStorage). Réouvrir : window.openCookieSettings()
 */
(function () {
  var GA_ID = 'G-5963KCLEX1';
  var KEY = 'mit_cookie_consent';
  var MAX_AGE = 1000 * 60 * 60 * 24 * 182; // ~6 mois
  var loaded = false;

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };

  function read() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (v && v.t && Date.now() - v.t < MAX_AGE) return v.v;
    } catch (e) {}
    return null;
  }
  function write(v) {
    try { localStorage.setItem(KEY, JSON.stringify({ v: v, t: Date.now() })); } catch (e) {}
  }

  window.trackEvent = function (cat, action, label) {
    if (read() === 'granted' && loaded) {
      window.gtag('event', action, { event_category: cat, event_label: label });
    }
  };

  function loadGA() {
    if (loaded) return;
    loaded = true;
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA_ID;
    document.head.appendChild(s);
    window.gtag('js', new Date());
    window.gtag('config', GA_ID);
  }

  function closeBanner() {
    var b = document.getElementById('mit-consent');
    if (b) b.remove();
  }

  function showBanner() {
    if (document.getElementById('mit-consent')) return;
    var b = document.createElement('div');
    b.id = 'mit-consent';
    b.setAttribute('role', 'dialog');
    b.setAttribute('aria-label', 'Choix sur les cookies');
    b.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:99999;max-width:560px;margin:0 auto;' +
      'background:#12121c;color:#f0f0ff;border:1px solid #ffffff22;border-radius:14px;padding:16px 18px;' +
      'font:14px/1.5 "DM Sans",Arial,sans-serif;box-shadow:0 10px 40px rgba(0,0,0,.5)';
    b.innerHTML =
      '<p style="margin:0 0 12px">Ce site utilise Google Analytics pour mesurer sa fréquentation. ' +
      'Aucun cookie de mesure n\u2019est déposé sans votre accord. ' +
      '<a href="/confidentialite.html" style="color:#7aa7ff">En savoir plus</a></p>' +
      '<div style="display:flex;gap:10px;flex-wrap:wrap">' +
      '<button id="mit-refuse" type="button" style="flex:1;min-width:130px;padding:10px 14px;border-radius:10px;border:1px solid #ffffff44;background:transparent;color:#f0f0ff;font:inherit;cursor:pointer">Refuser</button>' +
      '<button id="mit-accept" type="button" style="flex:1;min-width:130px;padding:10px 14px;border-radius:10px;border:1px solid #3b82f6;background:#3b82f6;color:#fff;font:inherit;cursor:pointer">Accepter</button>' +
      '</div>';
    document.body.appendChild(b);
    document.getElementById('mit-accept').onclick = function () { write('granted'); closeBanner(); loadGA(); };
    document.getElementById('mit-refuse').onclick = function () { write('denied'); closeBanner(); };
  }

  window.openCookieSettings = showBanner;

  var c = read();
  if (c === 'granted') loadGA();
  else if (c === null) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showBanner);
    else showBanner();
  }
})();
