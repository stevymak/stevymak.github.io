// ─────────────────────────────────────────────────────────────────────────────
// ui.js — Constantes partagées + helpers DOM (badges sidebar, formatters).
// ─────────────────────────────────────────────────────────────────────────────

export const MONTHS = [
  'Janvier','Février','Mars','Avril','Mai','Juin',
  'Juillet','Août','Septembre','Octobre','Novembre','Décembre',
];

export const DAYS = ['Lun','Mar','Mer','Jeu','Ven','Sam','Dim'];

export const CONTRAT_LABELS = {
  serenite: 'Contrat Sérénité',
  senior:   'Pack Senior+',
  famille:  'Pack Famille',
};

export const CONTRAT_TARIFS = { serenite: 45, senior: 49, famille: 59 };

export const CONTRAT_PILLS = {
  serenite: 'pill-serenite',
  senior:   'pill-senior',
  famille:  'pill-famille',
};

export const ROUTE_TITLES = {
  dashboard:    'Dashboard',
  calendrier:   'Agenda',
  reservations: 'Réservations',
  contrats:     'Contrats',
  avis:         'Avis',
};

export function formatDateLong(dateKey) {
  if (!dateKey) return '–';
  return new Date(dateKey + 'T12:00:00').toLocaleDateString('fr-FR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  });
}

export function setSidebarBadge(route, count) {
  const item = document.querySelector(`.sidebar-item[data-route="${route}"]`);
  if (!item) return;
  let badge = item.querySelector('.sidebar-badge');
  if (count > 0) {
    if (!badge) {
      badge = document.createElement('span');
      badge.className = 'sidebar-badge';
      item.appendChild(badge);
    }
    badge.textContent = count;
  } else if (badge) {
    badge.remove();
  }
}
