// ─────────────────────────────────────────────────────────────────────────────
// period.js — Utilitaires de plage temporelle (jour/semaine/mois/trimestre/année).
//
// Fournit la plage [start; end], la plage précédente de même longueur, le test
// d'appartenance d'un dateKey ('YYYY-MM-DD'), et le calcul du delta en %.
// ─────────────────────────────────────────────────────────────────────────────

export const PERIODS = ['day', 'week', 'month', 'quarter', 'year'];

export const PERIOD_LABELS = {
  day:     'Jour',
  week:    'Semaine',
  month:   'Mois',
  quarter: 'Trimestre',
  year:    'Année',
};

const MONTHS_SHORT = [
  'Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin',
  'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc',
];

function startOfDay(d) { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function endOfDay(d)   { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; }

function startOfWeek(d) {
  // Semaine ISO : lundi → dimanche.
  const x = startOfDay(d);
  const day = x.getDay() || 7; // Dim = 7
  if (day !== 1) x.setDate(x.getDate() - (day - 1));
  return x;
}
function endOfWeek(d) {
  const start = startOfWeek(d);
  const end   = new Date(start);
  end.setDate(start.getDate() + 6);
  return endOfDay(end);
}

function startOfMonth(d)   { return startOfDay(new Date(d.getFullYear(), d.getMonth(), 1)); }
function endOfMonth(d)     { return endOfDay(new Date(d.getFullYear(), d.getMonth() + 1, 0)); }
function startOfQuarter(d) { const q = Math.floor(d.getMonth() / 3); return startOfDay(new Date(d.getFullYear(), q * 3, 1)); }
function endOfQuarter(d)   { const q = Math.floor(d.getMonth() / 3); return endOfDay(new Date(d.getFullYear(), q * 3 + 3, 0)); }
function startOfYear(d)    { return startOfDay(new Date(d.getFullYear(), 0, 1)); }
function endOfYear(d)      { return endOfDay(new Date(d.getFullYear(), 11, 31)); }

export function getRange(period, ref = new Date()) {
  switch (period) {
    case 'day':
      return {
        start: startOfDay(ref),
        end:   endOfDay(ref),
        label: ref.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }),
      };
    case 'week': {
      const s = startOfWeek(ref);
      return {
        start: s,
        end:   endOfWeek(ref),
        label: `Sem. du ${s.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })}`,
      };
    }
    case 'quarter':
      return {
        start: startOfQuarter(ref),
        end:   endOfQuarter(ref),
        label: `T${Math.floor(ref.getMonth() / 3) + 1} ${ref.getFullYear()}`,
      };
    case 'year':
      return {
        start: startOfYear(ref),
        end:   endOfYear(ref),
        label: `Année ${ref.getFullYear()}`,
      };
    case 'month':
    default:
      return {
        start: startOfMonth(ref),
        end:   endOfMonth(ref),
        label: `${MONTHS_SHORT[ref.getMonth()]} ${ref.getFullYear()}`,
      };
  }
}

export function getPreviousRange(period, ref = new Date()) {
  const prev = new Date(ref);
  switch (period) {
    case 'day':     prev.setDate(ref.getDate() - 1); break;
    case 'week':    prev.setDate(ref.getDate() - 7); break;
    case 'quarter': prev.setMonth(ref.getMonth() - 3); break;
    case 'year':    prev.setFullYear(ref.getFullYear() - 1); break;
    case 'month':
    default:        prev.setMonth(ref.getMonth() - 1); break;
  }
  return getRange(period, prev);
}

export function dateKeyInRange(dateKey, range) {
  if (!dateKey || !range) return false;
  // dateKey est un 'YYYY-MM-DD' — on prend midi pour éviter les bords TZ.
  const d = new Date(dateKey + 'T12:00:00');
  return d >= range.start && d <= range.end;
}

export function formatDelta(current, previous) {
  if (previous == null || previous === 0) {
    if (current > 0) return { text: 'Nouveau', dir: 'up', pct: null };
    return { text: '', dir: 'flat', pct: null };
  }
  const pct = Math.round(((current - previous) / previous) * 100);
  const sign = pct > 0 ? '↑' : pct < 0 ? '↓' : '→';
  const dir  = pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat';
  return { text: `${sign} ${Math.abs(pct)}%`, dir, pct };
}
