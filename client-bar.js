/* client-bar.js — Bandeau « espace client » affiché en haut du site quand le
 * client est connecté (21/10/2026).
 * L'espace client (mon-rdv.html) mémorise seulement le prénom dans
 * localStorage (clé mkClient) à la connexion et l'efface à la déconnexion :
 * aucune donnée personnelle n'est lue ici, et Firebase n'est pas chargé sur
 * les autres pages (le site reste aussi rapide). */
(function () {
  if (/\/(admin|mon-rdv)\.html$/.test(location.pathname)) return;
  var c = null;
  try { c = JSON.parse(localStorage.getItem('mkClient') || 'null'); } catch (e) { return; }
  if (!c || !c.prenom) return;
  // Session Firebase non revue depuis 90 jours : on n'affiche plus le bandeau.
  if (!c.t || Date.now() - c.t > 90 * 864e5) { try { localStorage.removeItem('mkClient'); } catch (e) {} return; }

  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); };
  var css = document.createElement('style');
  css.textContent =
    '.mk-client-bar{position:fixed;top:0;left:0;right:0;z-index:190;min-height:44px;background:#1e3a8a;color:#fff;display:flex;align-items:center;justify-content:center;gap:.25rem 1rem;flex-wrap:nowrap;white-space:nowrap;overflow:hidden;padding:0 .75rem;font:600 15px/1.2 system-ui,-apple-system,"Segoe UI",sans-serif}' +
    '.mk-client-bar a{color:#fff;text-decoration:none;display:inline-flex;align-items:center;min-height:44px;padding:0 .35rem;border-radius:6px}' +
    '.mk-client-bar a:hover,.mk-client-bar a:focus-visible{text-decoration:underline}' +
    '.mk-client-bar .mk-cta{background:#fff;color:#1e3a8a;min-height:32px;padding:0 .8rem;border-radius:99px}' +
    '.mk-client-bar .mk-cta:hover{text-decoration:none;background:#dbeafe}' +
    '.mk-client-bar .mk-hello{font-weight:500;opacity:.95}' +
    'body.has-client-bar{padding-top:44px}' +
    'body.has-client-bar>nav,body.has-client-bar>header,body.has-client-bar .nav,body.has-client-bar .navbar,body.has-client-bar .site-header{top:44px}' +
    '@media(max-width:640px){.mk-client-bar{gap:.4rem;font-size:14px;justify-content:space-between}.mk-client-bar .mk-opt{display:none}.mk-client-bar .mk-hello{overflow:hidden;text-overflow:ellipsis;min-width:0}}';
  document.head.appendChild(css);

  function render() {
    var bar = document.createElement('div');
    bar.className = 'mk-client-bar';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Mon espace client');
    bar.innerHTML =
      '<span class="mk-hello"><span aria-hidden="true">👤</span> Bonjour ' + esc(c.prenom) + '</span>' +
      '<a class="mk-opt" href="/mon-rdv.html#rdv">Mes rendez-vous</a>' +
      '<a class="mk-opt" href="/mon-rdv.html#contrats">Mes contrats</a>' +
      '<a href="/mon-rdv.html#profil">Mon profil</a>' +
      '<a class="mk-cta" href="/mon-rdv.html">Mon espace →</a>';
    var skip = document.querySelector('.skip-link');
    if (skip && skip.parentNode === document.body) skip.after(bar); else document.body.insertBefore(bar, document.body.firstChild);
    document.body.classList.add('has-client-bar');
  }
  if (document.body) render(); else document.addEventListener('DOMContentLoaded', render);
})();
