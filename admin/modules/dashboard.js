// ─────────────────────────────────────────────────────────────────────────────
// dashboard.js — Tableau de bord business.
//
// Sélecteur de période (jour/semaine/mois/trimestre/année) qui pilote 5 KPIs
// avec comparatif vs période précédente : CA estimé, interventions, panier
// moyen, taux de confirmation, nouveaux clients. + courbe CA 12 mois (Chart.js
// line), donut services (Chart.js doughnut), heatmap habitudes 8h-20h, et
// prévision CA fin de mois par extrapolation linéaire.
//
// Le CA s'appuie sur le champ `prixReel` saisi à la fin de chaque RDV.
// Si absent (RDV historiques), on retombe sur DEFAULT_PRIX comme estimation.
// ─────────────────────────────────────────────────────────────────────────────

import { store, on } from '../core/store.js';
import { CONTRAT_TARIFS } from '../core/ui.js';
import {
  PERIODS,
  getRange,
  getPreviousRange,
  dateKeyInRange,
  formatDelta,
} from '../core/period.js';

// Tarif moyen utilisé pour les RDV sans prixReel saisi (historique).
const DEFAULT_PRIX = 70;

let currentPeriod = 'month';
let chartCA       = null;
let chartServices = null;

// ─── Helpers ──────────────────────────────────────────────────────────────
function rdvRevenue(rdv) {
  if (typeof rdv.prixReel === 'number' && Number.isFinite(rdv.prixReel)) return rdv.prixReel;
  return DEFAULT_PRIX;
}

function rdvsBilledInRange(range) {
  return store.allRdvs.filter(
    (r) =>
      (r.status === 'confirmed' || r.status === 'done') && dateKeyInRange(r.dateKey, range),
  );
}

function fmtEUR(n) {
  if (n == null || !Number.isFinite(n)) return '–';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Math.round(n)) + ' €';
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function setDelta(id, current, previous) {
  const el = document.getElementById(id);
  if (!el) return;
  const d = formatDelta(current, previous);
  el.className = 'kpi-delta kpi-delta-' + d.dir;
  if (!d.text || previous == null) {
    el.textContent = '';
    return;
  }
  el.textContent = `${d.text} vs période préc.`;
}

// ─── Calcul des "nouveaux clients" sur une plage ─────────────────────────
function clientKey(r) {
  if (r.email)     return 'e:' + String(r.email).toLowerCase();
  if (r.telephone) return 't:' + String(r.telephone).replace(/\s+/g, '');
  return null;
}
function countNewClients(range) {
  const seen = new Set();
  store.allRdvs.forEach((r) => {
    if (!r.dateKey) return;
    const d = new Date(r.dateKey + 'T12:00:00');
    if (d < range.start) {
      const k = clientKey(r);
      if (k) seen.add(k);
    }
  });
  const newOnes = new Set();
  store.allRdvs.forEach((r) => {
    if (!dateKeyInRange(r.dateKey, range)) return;
    const k = clientKey(r);
    if (!k || seen.has(k)) return;
    newOnes.add(k);
  });
  return newOnes.size;
}

// ─── KPIs ─────────────────────────────────────────────────────────────────
function renderKPIs() {
  const range     = getRange(currentPeriod);
  const prevRange = getPreviousRange(currentPeriod);

  setText('periodLabel', range.label);

  const cur  = rdvsBilledInRange(range);
  const prev = rdvsBilledInRange(prevRange);

  // CA estimé
  const caCur  = cur.reduce((s, r) => s + rdvRevenue(r), 0);
  const caPrev = prev.reduce((s, r) => s + rdvRevenue(r), 0);
  setText('kpiCA', fmtEUR(caCur));
  setDelta('kpiCADelta', caCur, caPrev);

  // Interventions
  setText('kpiRdv', cur.length);
  setDelta('kpiRdvDelta', cur.length, prev.length);

  // Panier moyen
  const panierCur  = cur.length  ? caCur  / cur.length  : 0;
  const panierPrev = prev.length ? caPrev / prev.length : 0;
  setText('kpiPanier', cur.length ? fmtEUR(panierCur) : '–');
  setDelta('kpiPanierDelta', panierCur, panierPrev);

  // Taux de confirmation : (confirmed+done) / (total non pending) sur la période
  const allCur  = store.allRdvs.filter((r) => dateKeyInRange(r.dateKey, range)     && r.status !== 'pending');
  const okCur   = allCur.filter((r) => r.status === 'confirmed' || r.status === 'done').length;
  const tauxCur = allCur.length ? Math.round((okCur / allCur.length) * 100) : 0;

  const allPrev  = store.allRdvs.filter((r) => dateKeyInRange(r.dateKey, prevRange) && r.status !== 'pending');
  const okPrev   = allPrev.filter((r) => r.status === 'confirmed' || r.status === 'done').length;
  const tauxPrev = allPrev.length ? Math.round((okPrev / allPrev.length) * 100) : 0;

  setText('kpiConv', allCur.length ? `${tauxCur}%` : '–');
  setDelta('kpiConvDelta', tauxCur, allPrev.length ? tauxPrev : null);

  // Nouveaux clients
  const newCur  = countNewClients(range);
  const newPrev = countNewClients(prevRange);
  setText('kpiNouveaux', newCur);
  setDelta('kpiNouveauxDelta', newCur, newPrev);
}

// ─── Forecast fin de mois ─────────────────────────────────────────────────
function renderForecast() {
  const range  = getRange('month');
  const now    = new Date();
  const elapsedMs = Math.max(now - range.start, 1);
  const totalMs   = range.end - range.start;
  const cur       = rdvsBilledInRange(range);
  const caSoFar   = cur.reduce((s, r) => s + rdvRevenue(r), 0);

  const forecast = (caSoFar / elapsedMs) * totalMs;
  setText('forecastVal', fmtEUR(forecast));

  const sub = document.getElementById('forecastSub');
  if (sub) sub.textContent = `${fmtEUR(caSoFar)} estimés à date · projection sur la tendance`;

  const pct = Math.min(100, Math.max(0, Math.round((elapsedMs / totalMs) * 100)));
  const fill = document.getElementById('forecastFill');
  if (fill) fill.style.width = pct + '%';
  setText('forecastProgressLabel', `${pct}% du mois écoulé`);
}

// ─── MRR (côté dashboard mini-card) ──────────────────────────────────────
export function updateDashboardMRR() {
  let mrr = 0;
  store.allContrats
    .filter((c) => c.status === 'active')
    .forEach((c) => { mrr += CONTRAT_TARIFS[c.contrat] || 0; });
  setText('revMRR', fmtEUR(mrr));
}

// ─── Chart options communes (thème sombre) ───────────────────────────────
function commonAxisOpts() {
  return {
    ticks: { color: '#8888aa', font: { size: 11 } },
    grid:  { color: '#ffffff08' },
  };
}
function commonTooltipOpts() {
  return {
    backgroundColor: '#16162a',
    borderColor:    '#3b82f640',
    borderWidth:    1,
    titleColor:     '#f0f0ff',
    bodyColor:      '#ccccdd',
    padding:        10,
    boxPadding:     4,
  };
}

// ─── Évolution CA — line chart 12 mois ───────────────────────────────────
function renderChartCA() {
  if (typeof Chart === 'undefined') return;

  const now    = new Date();
  const months = [];
  for (let i = 11; i >= 0; i--) {
    const d   = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months.push({ key, label: d.toLocaleDateString('fr-FR', { month: 'short' }) });
  }
  const data = months.map((m) =>
    store.allRdvs
      .filter((r) => (r.status === 'confirmed' || r.status === 'done') && r.monthKey === m.key)
      .reduce((s, r) => s + rdvRevenue(r), 0),
  );

  const ctx = document.getElementById('chartCA');
  if (!ctx) return;
  if (chartCA) chartCA.destroy();
  chartCA = new Chart(ctx, {
    type: 'line',
    data: {
      labels: months.map((m) => m.label),
      datasets: [{
        label: 'CA',
        data,
        borderColor:          '#3b82f6',
        backgroundColor:      'rgba(59,130,246,0.12)',
        fill:                 true,
        tension:              0.3,
        pointBackgroundColor: '#3b82f6',
        pointRadius:          3,
        pointHoverRadius:     5,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend:  { display: false },
        tooltip: {
          ...commonTooltipOpts(),
          callbacks: { label: (c) => fmtEUR(c.parsed.y) },
        },
      },
      scales: {
        x: commonAxisOpts(),
        y: { ...commonAxisOpts(), beginAtZero: true,
             ticks: { ...commonAxisOpts().ticks, callback: (v) => fmtEUR(v) } },
      },
    },
  });
}

// ─── Donut services sur la période courante ──────────────────────────────
function renderChartServices() {
  if (typeof Chart === 'undefined') return;

  const range = getRange(currentPeriod);
  const cur   = rdvsBilledInRange(range);
  const tally = {};
  cur.forEach((r) => { if (r.service) tally[r.service] = (tally[r.service] || 0) + 1; });
  const sorted = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 8);

  const ctx     = document.getElementById('chartServices');
  const empty   = document.getElementById('chartServicesEmpty');
  if (!ctx || !empty) return;

  if (sorted.length === 0) {
    empty.style.display = 'flex';
    ctx.style.display   = 'none';
    if (chartServices) { chartServices.destroy(); chartServices = null; }
    return;
  }
  empty.style.display = 'none';
  ctx.style.display   = '';

  const labels = sorted.map((e) => e[0]);
  const data   = sorted.map((e) => e[1]);

  if (chartServices) chartServices.destroy();
  chartServices = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: [
          '#3b82f6', '#22c55e', '#f59e0b', '#a855f7',
          '#ef4444', '#0ea5e9', '#ec4899', '#84cc16',
        ],
        borderWidth: 0,
      }],
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend:  { position: 'bottom', labels: { color: '#aaaacc', font: { size: 11 }, boxWidth: 12 } },
        tooltip: commonTooltipOpts(),
      },
    },
  });

  const sub = document.getElementById('chartServicesSub');
  if (sub) sub.textContent = range.label;
}

// ─── Heatmap (toujours toutes périodes, pour donner une intuition) ───────
function renderHeatmap() {
  // 7 jours (Lun→Dim) × 12 plages horaires (8h→19h)
  const grid = Array.from({ length: 7 }, () => Array(12).fill(0));
  store.allRdvs.forEach((r) => {
    if (!r.dateKey || r.status === 'cancelled') return;
    const d = new Date(r.dateKey + 'T12:00:00');
    let day = d.getDay() - 1; if (day < 0) day = 6;
    const m = String(r.timeLabel || r.time || '').match(/(\d{1,2})\s*h/);
    const hour = m ? parseInt(m[1], 10) : NaN;
    if (!Number.isFinite(hour) || hour < 8 || hour > 19) return;
    grid[day][hour - 8]++;
  });

  let max = 1;
  grid.forEach((row) => row.forEach((v) => { if (v > max) max = v; }));

  const labels = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
  const root = document.getElementById('heatmap');
  if (!root) return;

  let html = '<div class="heatmap-grid">';
  html += '<div></div>';
  for (let h = 8; h < 20; h++) html += `<div class="heatmap-h">${h}h</div>`;
  grid.forEach((row, i) => {
    html += `<div class="heatmap-d">${labels[i]}</div>`;
    row.forEach((v, j) => {
      const intensity = v === 0 ? 0 : 0.15 + 0.85 * (v / max);
      const hour      = j + 8;
      html += `<div class="heatmap-cell" title="${labels[i]} ${hour}h — ${v} RDV" style="background:rgba(59,130,246,${intensity})"></div>`;
    });
  });
  html += '</div>';
  root.innerHTML = html;
}

// ─── Période : changement / init ─────────────────────────────────────────
function setPeriod(period) {
  if (!PERIODS.includes(period)) return;
  currentPeriod = period;
  document.querySelectorAll('.period-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.period === period);
  });
  renderKPIs();
  renderChartServices();
}

function initPeriodSelector() {
  document.querySelectorAll('.period-btn').forEach((btn) => {
    btn.addEventListener('click', () => setPeriod(btn.dataset.period));
  });
}

function renderAll() {
  renderKPIs();
  renderForecast();
  renderChartCA();
  renderChartServices();
  renderHeatmap();
}

// ─── Souscriptions ────────────────────────────────────────────────────────
on('rdvs:changed', renderAll);
on('contrats:changed', updateDashboardMRR);

initPeriodSelector();
