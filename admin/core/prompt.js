// ─────────────────────────────────────────────────────────────────────────────
// prompt.js — Modale d'input réutilisable (texte / nombre).
//
// Utilise la modale `#promptModal` définie dans admin.html. Renvoie une
// promesse résolue avec la valeur saisie (number ou string) ou `null` si
// l'utilisateur annule (Échap, clic hors modale, bouton Annuler).
// ─────────────────────────────────────────────────────────────────────────────

export function promptInput({
  title,
  message      = '',
  type         = 'text',
  placeholder  = '',
  defaultValue = '',
  unit         = '',
  confirmLabel = 'Valider',
  cancelLabel  = 'Annuler',
  min,
  max,
  step,
} = {}) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('promptModal');
    if (!overlay) { resolve(null); return; }

    document.getElementById('promptTitle').textContent   = title || '';
    document.getElementById('promptMessage').textContent = message;

    const input = document.getElementById('promptInput');
    input.type        = type;
    input.placeholder = placeholder;
    input.value       = defaultValue == null ? '' : String(defaultValue);
    if (min  != null) input.min  = String(min);  else input.removeAttribute('min');
    if (max  != null) input.max  = String(max);  else input.removeAttribute('max');
    if (step != null) input.step = String(step); else input.removeAttribute('step');

    document.getElementById('promptUnit').textContent = unit;

    const btnOk     = document.getElementById('promptConfirm');
    const btnCancel = document.getElementById('promptCancel');
    btnOk.textContent     = confirmLabel;
    btnCancel.textContent = cancelLabel;

    const onKey = (e) => {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Enter')  onConfirm();
    };

    const cleanup = () => {
      overlay.classList.remove('show');
      btnOk.onclick     = null;
      btnCancel.onclick = null;
      overlay.onclick   = null;
      document.removeEventListener('keydown', onKey);
    };

    const onConfirm = () => {
      const raw = input.value.trim();
      cleanup();
      if (type === 'number') {
        const n = parseFloat(raw.replace(',', '.'));
        resolve(Number.isFinite(n) ? n : null);
      } else {
        resolve(raw || null);
      }
    };
    const onCancel = () => { cleanup(); resolve(null); };

    btnOk.onclick     = onConfirm;
    btnCancel.onclick = onCancel;
    overlay.onclick   = (e) => { if (e.target === overlay) onCancel(); };
    document.addEventListener('keydown', onKey);

    overlay.classList.add('show');
    setTimeout(() => { input.focus(); input.select?.(); }, 50);
  });
}
