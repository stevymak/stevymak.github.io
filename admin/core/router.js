// ─────────────────────────────────────────────────────────────────────────────
// router.js — Routage par hash pour la sidebar (#dashboard, #calendrier, …).
//
// Le routeur ne fait que basculer la classe `.active` sur les `.tab-content`
// et `.sidebar-item`. Les modules eux-mêmes peuvent s'abonner à `route:changed`
// via le bus (pour redessiner par ex. le calendrier au moment où il devient
// visible) — pour l'instant aucun module n'en a besoin, le rendu se fait à
// chaque mutation de données.
// ─────────────────────────────────────────────────────────────────────────────

import { ROUTE_TITLES } from './ui.js';
import { emit } from './store.js';

const ROUTES = ['dashboard', 'calendrier', 'reservations', 'clients', 'devis', 'factures', 'contrats', 'communications', 'finance', 'avis'];

function getCurrentRoute() {
  const h = (window.location.hash || '').replace('#', '');
  return ROUTES.includes(h) ? h : 'dashboard';
}

function applyRoute() {
  const route = getCurrentRoute();
  document.querySelectorAll('.tab-content').forEach((c) => c.classList.remove('active'));
  document.querySelectorAll('.sidebar-item').forEach((i) => i.classList.remove('active'));
  document.getElementById('tab-' + route)?.classList.add('active');
  document.querySelector(`.sidebar-item[data-route="${route}"]`)?.classList.add('active');

  const title = ROUTE_TITLES[route] || 'Admin';
  const titleEl = document.getElementById('topbarTitle');
  if (titleEl) titleEl.textContent = title;

  // Drawer mobile : on referme à chaque navigation.
  document.getElementById('sidebar')?.classList.remove('open');
  document.getElementById('sidebarBackdrop')?.classList.remove('show');

  emit('route:changed', { route });
}

export function initRouter() {
  window.addEventListener('hashchange', applyRoute);

  document.querySelectorAll('.sidebar-item[data-route]').forEach((item) => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      window.location.hash = item.dataset.route;
    });
  });

  // Toggle drawer mobile
  const sidebar = document.getElementById('sidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  document.getElementById('sidebarToggle')?.addEventListener('click', () => {
    sidebar?.classList.toggle('open');
    backdrop?.classList.toggle('show');
  });
  backdrop?.addEventListener('click', () => {
    sidebar?.classList.remove('open');
    backdrop?.classList.remove('show');
  });

  applyRoute();
}
