/* tarifs.js – Makouez IT
 * Affiche les prix de /tarifs.json dans les éléments marqués data-tarif.
 *
 *   <span data-tarif="depannage.diagExpress.prix">55 €</span>
 *
 * Le texte écrit en dur dans la page reste la valeur de secours (et celle que
 * lit Google) : `node tests/check-tarifs.mjs` vérifie qu'il correspond au JSON.
 * Format : 55 € · 1 890 € · null → « Sur devis ».
 */
(function () {
  'use strict';

  function fmt(v) {
    if (v === null) return 'Sur devis';
    if (typeof v !== 'number') return String(v);
    var n = Number.isInteger(v) ? String(v) : v.toFixed(2).replace('.', ',');
    n = n.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    return n + ' €';
  }

  function get(obj, path) {
    return path.split('.').reduce(function (o, k) { return o == null ? undefined : o[k]; }, obj);
  }

  function hydrate(data) {
    window.MAKOUEZ_TARIFS = data;
    document.querySelectorAll('[data-tarif]').forEach(function (el) {
      var v = get(data, el.getAttribute('data-tarif'));
      if (v !== undefined) el.textContent = fmt(v);
    });
    document.dispatchEvent(new CustomEvent('tarifs:ready', { detail: data }));
  }

  window.formatTarif = fmt;

  var ready = fetch('/tarifs.json', { cache: 'no-cache' })
    .then(function (r) { return r.ok ? r.json() : null; })
    .catch(function () { return null; });

  ready.then(function (data) {
    if (!data) return;  // les prix écrits dans la page restent affichés
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () { hydrate(data); });
    } else {
      hydrate(data);
    }
  });

  window.MAKOUEZ_TARIFS_READY = ready;
})();
