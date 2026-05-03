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
  clients:      'Clients',
  contrats:     'Contrats',
  avis:         'Avis',
};

// Tags clients prédéfinis. L'utilisateur peut en ajouter de personnalisés
// via la fiche client (ils s'affichent sans label/couleur dédiés).
export const CLIENT_TAGS_PRESET = [
  { id: 'senior',     label: '👴 Senior',          color: '#f59e0b' },
  { id: 'pro',        label: '💼 Professionnel',   color: '#3b82f6' },
  { id: 'famille',    label: '👨‍👩‍👧 Famille',         color: '#22c55e' },
  { id: 'serenite',   label: '✨ Abonné Sérénité',  color: '#a855f7' },
  { id: 'recommande', label: '🤝 Recommandé',      color: '#0ea5e9' },
  { id: 'vip',        label: '⭐ VIP',             color: '#ec4899' },
];

// Segments automatiques (calculés à partir du nombre de RDV et du dernier RDV)
export const SEGMENTS = {
  NEW:     { id: 'new',     label: '🆕 Nouveau',  color: '#3b82f6' },
  FIDELE:  { id: 'fidele',  label: '⭐ Fidèle',   color: '#22c55e' },
  VIP:     { id: 'vip',     label: '💎 VIP',      color: '#a855f7' },
  DORMANT: { id: 'dormant', label: '😴 Dormant',  color: '#8888aa' },
};

const SIX_MONTHS_MS = 6 * 30 * 24 * 3600 * 1000;

export function classifySegment(rdvCount, lastRdvDate) {
  if (lastRdvDate && (Date.now() - lastRdvDate.getTime()) > SIX_MONTHS_MS) return SEGMENTS.DORMANT;
  if (rdvCount >= 5) return SEGMENTS.VIP;
  if (rdvCount >= 2) return SEGMENTS.FIDELE;
  return SEGMENTS.NEW;
}

// Identifiant Firestore stable et RGPD-friendly d'un client.
// Renvoie 16 caractères hex (64 bits) — bien suffisant pour quelques milliers
// de clients sans risque de collision.
export async function clientHash(value, kind = 'e') {
  const raw = (kind === 'e') ? String(value).toLowerCase() : String(value).replace(/\s+/g, '');
  const data = new TextEncoder().encode(`${kind}:${raw}`);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf, 0, 8)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

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
