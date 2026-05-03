// ─────────────────────────────────────────────────────────────────────────────
// calendrier.js — Calendrier mensuel des RDV (vue grille 7 colonnes).
// ─────────────────────────────────────────────────────────────────────────────

import { store, on } from '../core/store.js';
import { MONTHS, DAYS } from '../core/ui.js';
import { openRdvModal } from './reservations.js';

let calYear  = new Date().getFullYear();
let calMonth = new Date().getMonth();

export function renderCalAdmin() {
  const titleEl = document.getElementById('calAdminTitle');
  const grid    = document.getElementById('calAdminGrid');
  if (!titleEl || !grid) return;

  titleEl.textContent = MONTHS[calMonth] + ' ' + calYear;
  grid.innerHTML = '';

  DAYS.forEach((d) => {
    const el = document.createElement('div');
    el.className = 'cal-head';
    el.textContent = d;
    grid.appendChild(el);
  });

  const first = new Date(calYear, calMonth, 1);
  let startDay = first.getDay() - 1;
  if (startDay < 0) startDay = 6;

  const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < startDay; i++) {
    const el = document.createElement('div');
    el.className = 'cal-cell cal-empty';
    grid.appendChild(el);
  }

  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(calYear, calMonth, d);
    const dateKey = `${calYear}-${String(calMonth + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const isPast  = date < today;
    const isToday = date.getTime() === today.getTime();
    const rdvs = store.allRdvs.filter((r) => r.dateKey === dateKey && r.status !== 'cancelled');

    const el = document.createElement('div');
    el.className =
      'cal-cell' + (isPast ? ' cal-past' : '') + (isToday ? ' cal-today' : '');
    el.innerHTML = `<div class="cal-day-num">${d}</div>`;

    rdvs.slice(0, 3).forEach((r) => {
      const cls =
        r.status === 'confirmed' || r.status === 'done' ? 'chip-confirmed' : 'chip-pending';
      const chip = document.createElement('div');
      chip.className = `cal-rdv-chip ${cls}`;
      chip.textContent =
        (r.timeLabel || r.time || '').slice(0, 12) + ' – ' + (r.nom || '').split(' ')[0];
      chip.onclick = (e) => {
        e.stopPropagation();
        openRdvModal(r);
      };
      el.appendChild(chip);
    });

    if (rdvs.length > 3) {
      const more = document.createElement('div');
      more.className = 'cal-more';
      more.textContent = `+${rdvs.length - 3} de plus`;
      el.appendChild(more);
    }

    if (rdvs.length > 0) {
      el.onclick = () => {
        if (rdvs.length === 1) openRdvModal(rdvs[0]);
      };
    }

    grid.appendChild(el);
  }
}

function calPrev() {
  calMonth--;
  if (calMonth < 0) {
    calMonth = 11;
    calYear--;
  }
  renderCalAdmin();
}

function calNext() {
  calMonth++;
  if (calMonth > 11) {
    calMonth = 0;
    calYear++;
  }
  renderCalAdmin();
}

// Re-render quand les RDV changent OU quand on bascule sur l'onglet (pour gérer
// le cas où la grille a été montée alors que le DOM n'était pas encore visible).
on('rdvs:changed', renderCalAdmin);
on('route:changed', ({ route }) => {
  if (route === 'calendrier') renderCalAdmin();
});

// Compat handlers inline
window.calPrev = calPrev;
window.calNext = calNext;
