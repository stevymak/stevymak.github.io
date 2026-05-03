// ─────────────────────────────────────────────────────────────────────────────
// dashboard.js — KPIs + graphiques inline (réservations/mois, top services,
// taux de confirmation, MRR, revenu mois en cours).
//
// S'abonne aux événements `rdvs:changed` et `contrats:changed` pour redessiner.
// ─────────────────────────────────────────────────────────────────────────────

import { store, on } from '../core/store.js';
import { MONTHS, CONTRAT_TARIFS } from '../core/ui.js';

export function updateStats() {
  const { allRdvs } = store;

  const total     = allRdvs.length;
  const pending   = allRdvs.filter((r) => r.status === 'pending').length;
  const confirmed = allRdvs.filter((r) => r.status === 'confirmed').length;
  const done      = allRdvs.filter((r) => r.status === 'done').length;

  document.getElementById('statTotal').textContent     = total;
  document.getElementById('statPending').textContent   = pending;
  document.getElementById('statConfirmed').textContent = confirmed;
  document.getElementById('statDone').textContent      = done;

  const now = new Date();
  const moisKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const rdvMois = allRdvs.filter(
    (r) => (r.status === 'confirmed' || r.status === 'done') && r.monthKey === moisKey,
  ).length;
  document.getElementById('revMois').textContent = `${rdvMois * 70}€`;

  updateDashboardMRR();

  const nonCancelled = allRdvs.filter((r) => r.status !== 'cancelled').length;
  const taux = nonCancelled > 0 ? Math.round(((confirmed + done) / nonCancelled) * 100) : 0;
  document.getElementById('tauxConfirm').innerHTML = `
    <div style="display:flex;align-items:center;gap:1rem;margin-bottom:0.5rem">
      <div style="font-family:'Syne',sans-serif;font-size:2rem;font-weight:800;color:var(--success)">${taux}%</div>
      <div style="color:var(--muted);font-size:0.82rem">des demandes reçues sont confirmées ou terminées</div>
    </div>
    <div style="background:var(--card);border-radius:99px;height:8px;overflow:hidden">
      <div style="width:${taux}%;height:100%;background:var(--success);border-radius:99px;transition:width 0.5s ease"></div>
    </div>`;
}

export function updateDashboardMRR() {
  const { allContrats } = store;
  let mrr = 0;
  allContrats
    .filter((c) => c.status === 'active')
    .forEach((c) => {
      mrr += CONTRAT_TARIFS[c.contrat] || 0;
    });
  const el = document.getElementById('revMRR');
  if (el) el.textContent = mrr + '€';
}

export function renderDashboardCharts() {
  const { allRdvs } = store;

  // Histogramme des 6 derniers mois
  const now = new Date();
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    months.push({ key, label: MONTHS[d.getMonth()].slice(0, 3) });
  }
  const counts = months.map((m) => allRdvs.filter((r) => r.monthKey === m.key).length);
  const maxVal = Math.max(...counts, 1);
  document.getElementById('barChart').innerHTML = counts
    .map(
      (c, i) =>
        `<div class="bar-wrap"><div class="bar-val">${c || ''}</div><div class="bar" style="height:${Math.max((c / maxVal) * 100, 4)}%"></div><div class="bar-label">${months[i].label}</div></div>`,
    )
    .join('');

  // Top services (jusqu'à 6)
  const svcCount = {};
  allRdvs.forEach((r) => {
    if (r.service) svcCount[r.service] = (svcCount[r.service] || 0) + 1;
  });
  const sorted = Object.entries(svcCount).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const maxSvc = sorted[0]?.[1] || 1;
  document.getElementById('servicesChart').innerHTML =
    sorted.length === 0
      ? '<div style="color:var(--muted);font-size:0.85rem">Aucune donnée</div>'
      : sorted
          .map(
            ([name, count]) =>
              `<div class="svc-bar-row"><div class="svc-bar-name">${name}</div><div class="svc-bar-track"><div class="svc-bar-fill" style="width:${(count / maxSvc) * 100}%"></div></div><div class="svc-bar-count">${count}</div></div>`,
          )
          .join('');
}

// ─── Souscriptions au bus ──────────────────────────────────────────────────
on('rdvs:changed', () => {
  updateStats();
  renderDashboardCharts();
});
on('contrats:changed', () => {
  // Le total contrats actifs est rendu dans le module contrats, mais le MRR
  // affiché côté dashboard doit lui aussi être rafraîchi.
  updateDashboardMRR();
  // Le compteur "contrats actifs" sur le dashboard est mis à jour par contrats.js
  // via updateContratStats(), qui touche aussi statContratsActifs.
});
