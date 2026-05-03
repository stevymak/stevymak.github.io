// ─────────────────────────────────────────────────────────────────────────────
// store.js — État partagé en mémoire + bus d'événements minimal.
//
// Pourquoi un bus ? Pour découpler les modules et éviter les imports croisés
// (ex. reservations qui force un re-render du calendrier). Chaque module
// s'abonne aux événements qui le concernent et émet quand ses données changent.
//
// Évènements actuels :
//   - rdvs:changed         → après load / update / delete d'un RDV
//   - contrats:changed     → après load / update / delete d'un contrat
//   - avis:changed         → après load / delete d'un avis publié
//   - avis-attente:changed → après load / approuver / rejeter un avis en attente
// ─────────────────────────────────────────────────────────────────────────────

export const store = {
  allRdvs: [],
  allAvis: [],
  avisEnAttente: [],
  allContrats: [],
};

const listeners = new Map();

export function on(event, cb) {
  if (!listeners.has(event)) listeners.set(event, new Set());
  listeners.get(event).add(cb);
  return () => listeners.get(event)?.delete(cb);
}

export function emit(event, payload) {
  const set = listeners.get(event);
  if (!set) return;
  set.forEach((cb) => {
    try {
      cb(payload);
    } catch (err) {
      console.error(`[bus] ${event}`, err);
    }
  });
}
