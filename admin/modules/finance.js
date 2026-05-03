// ─────────────────────────────────────────────────────────────────────────────
// finance.js — Suivi financier basique (auto-entreprise / micro).
//
// Calcule, sur la période sélectionnée, le CA estimé, les cotisations URSSAF
// (~22% pour prestations de services) et le net estimé. Affiche aussi la
// progression annuelle vs le seuil micro 2026 (77 700 €) avec une projection
// fin d'année et une alerte si la tendance suggère un dépassement.
//
// Sources :
//   - RDV `confirmed` ou `done` sur la période, valorisés via `prixReel`
//     ou DEFAULT_PRIX si absent.
//   - Contrats récurrents `active` : on additionne les mois actifs dans la
//     plage × tarif mensuel du pack.
// ─────────────────────────────────────────────────────────────────────────────

import { store, on } from '../core/store.js';
import { CONTRAT_TARIFS } from '../core/ui.js';
import { PERIODS, getRange, dateKeyInRange } from '../core/period.js';

// Hypothèses (prestations de services BIC/BNC)
const URSSAF_RATE      = 0.22;       // cotisations sociales + CFP estimées
const SEUIL_MICRO_2026 = 77_700;     // € HT — seuil de chiffre d'affaires
const SEUIL_TOLERANCE  = 85_800;     // € HT — seuil majoré (tolérance 1 an)

const DEFAULT_PRIX = 70;
const MS_PER_MONTH = 30 * 24 * 3600 * 1000;

let financePeriod = 'month';

// ─── Helpers ──────────────────────────────────────────────────────────────
function rdvRevenue(r) {
  if (typeof r.prixReel === 'number' && Number.isFinite(r.prixReel)) return r.prixReel;
  return DEFAULT_PRIX;
}

function caRdvsInRange(range) {
  return store.allRdvs
    .filter((r) => (r.status === 'confirmed' || r.status === 'done') && dateKeyInRange(r.dateKey, range))
    .reduce((s, r) => s + rdvRevenue(r), 0);
}

function caContratsInRange(range) {
  // Pour chaque contrat actif, on additionne les mois passés dans la plage.
  const now = new Date();
  let total = 0;
  store.allContrats.forEach((c) => {
    if (c.status !== 'active' || !c.dateActive?.toDate) return;
    const start = c.dateActive.toDate();
    if (start > range.end) return;
    const tarif = CONTRAT_TARIFS[c.contrat] || 0;
    const from  = start > range.start ? start : range.start;
    const to    = now < range.end ? now : range.end;
    if (to <= from) return;
    const months = (to - from) / MS_PER_MONTH;
    total += tarif * months;
  });
  return total;
}

function caInRange(range) {
  return caRdvsInRange(range) + caContratsInRange(range);
}

function fmtEUR(n) {
  if (n == null || !Number.isFinite(n)) return '–';
  return new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(Math.round(n)) + ' €';
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

// ─── Rendu ────────────────────────────────────────────────────────────────
function renderFinance() {
  const range = getRange(financePeriod);
  const ca    = caInRange(range);
  const cot   = ca * URSSAF_RATE;
  const net   = ca - cot;

  setText('finPeriodLabel', range.label);
  setText('finCA',  fmtEUR(ca));
  setText('finCot', fmtEUR(cot));
  setText('finNet', fmtEUR(net));

  // Année en cours (toujours, indépendamment de la période sélectionnée)
  const yearRange = getRange('year');
  const caYear    = caInRange(yearRange);

  // Projection fin d'année : extrapolation linéaire sur le temps écoulé.
  const elapsedMs = Math.max(Date.now() - yearRange.start.getTime(), 1);
  const totalMs   = yearRange.end - yearRange.start;
  const projected = (caYear / elapsedMs) * totalMs;

  setText('finCAYear',     fmtEUR(caYear));
  setText('finProjection', fmtEUR(projected));

  const pctReal = Math.min(100, (caYear   / SEUIL_MICRO_2026) * 100);
  const pctProj = Math.min(100, (projected / SEUIL_MICRO_2026) * 100);

  const fillReal = document.getElementById('finSeuilFill');
  const fillProj = document.getElementById('finSeuilProj');
  if (fillReal) fillReal.style.width = pctReal + '%';
  if (fillProj) fillProj.style.width = pctProj + '%';

  setText('finSeuilLabel',
    `${Math.round(pctReal)}% du seuil micro réalisé · projection ${Math.round(pctProj)}%`);

  // Alerte selon la tendance
  const alertEl = document.getElementById('finSeuilAlert');
  if (!alertEl) return;
  if (projected > SEUIL_TOLERANCE) {
    alertEl.style.display = 'block';
    alertEl.className = 'fin-alert fin-alert-danger';
    alertEl.innerHTML = `🚨 Sur cette tendance, tu dépasses le <strong>seuil majoré</strong> (${fmtEUR(SEUIL_TOLERANCE)}). Sortie du régime micro à anticiper.`;
  } else if (projected > SEUIL_MICRO_2026) {
    alertEl.style.display = 'block';
    alertEl.className = 'fin-alert fin-alert-warn';
    alertEl.innerHTML  = `⚠ Tu risques de dépasser le seuil micro (${fmtEUR(SEUIL_MICRO_2026)}) de ~${fmtEUR(projected - SEUIL_MICRO_2026)} sur l'année. Tu restes dans la tolérance majorée jusqu'à ${fmtEUR(SEUIL_TOLERANCE)}.`;
  } else if (pctProj > 85) {
    alertEl.style.display = 'block';
    alertEl.className = 'fin-alert fin-alert-warn';
    alertEl.innerHTML  = `⚠ Tu approches le seuil micro (${Math.round(pctProj)}% projeté). Pense à provisionner.`;
  } else {
    alertEl.style.display = 'none';
  }
}

// ─── Sélecteur de période (scoped au tab finance) ────────────────────────
function initFinancePeriodSelector() {
  document.querySelectorAll('#tab-finance .period-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = btn.dataset.period;
      if (!PERIODS.includes(p)) return;
      financePeriod = p;
      document.querySelectorAll('#tab-finance .period-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      renderFinance();
    });
  });
}

// ─── Souscriptions ────────────────────────────────────────────────────────
on('rdvs:changed',     renderFinance);
on('contrats:changed', renderFinance);
on('route:changed', ({ route }) => { if (route === 'finance') renderFinance(); });

initFinancePeriodSelector();
