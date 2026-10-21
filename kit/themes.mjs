// ─────────────────────────────────────────────────────────────────────────────
// kit/themes.mjs — Les trois designs du kit (étape 4).
//
// Le site source est écrit avec une palette cohérente (bleus, neutres, verts,
// oranges) mais en couleurs « en dur » dans chaque page. Plutôt que de réécrire
// 40 pages, chaque design transforme cette palette au moment de la génération :
// chaque couleur est convertie en teinte/saturation/luminosité puis redessinée
// selon des règles par famille (accent, neutres, succès, alerte), en conservant
// les rapports de contraste du site d'origine. S'y ajoutent les polices et une
// feuille « forme » (arrondis, filets) chargée en dernier.
//
//   clair   : design d'origine de makouezit.org (rien n'est transformé)
//   nuit    : sombre bleu graphite, accent ambre, angles nets
//   artisan : clair vert-de-gris, accent vert forêt, ocre pour l'action, filets
// ─────────────────────────────────────────────────────────────────────────────

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
function hexToRgb(h) {
  h = h.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
}
function rgbToHsl([r, g, b]) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn, s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let hh = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [hh * 60, s, l];
}
function hslToHex([h, s, l]) {
  h = ((h % 360) + 360) % 360; s = clamp(s); l = clamp(l);
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return '#' + [r, g, b].map((v) => Math.round((v + m) * 255).toString(16).padStart(2, '0')).join('');
}
const lin = (v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const luminance = (hex) => { const [r, g, b] = hexToRgb(hex).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
// Ajuste la luminosité HSL pour retrouver une luminance relative cible (garde les contrastes WCAG)
function versLuminance([h, s], cible) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 22; i++) { const m = (lo + hi) / 2; if (luminance(hslToHex([h, s, m])) < cible) lo = m; else hi = m; }
  return [h, s, (lo + hi) / 2];
}
function famille([h, s, l]) {
  const chroma = s * (1 - Math.abs(2 * l - 1));
  if (chroma < 0.12 || l > 0.96 || l < 0.05) return 'neutre'; // gris, y compris les gris ardoise légèrement bleutés
  if (h >= 185 && h < 260) return 'accent';     // bleus du site
  if (h >= 260 && h < 320) return 'accent';     // violets (rares) → accent
  if (h >= 85 && h < 185) return 'succes';      // verts (bouton d'appel, validations)
  if (h >= 30 && h < 85) return 'alerte';       // ambres / jaunes
  if (h >= 12 && h < 30) return 'orange';       // oranges (pages locales, badges)
  return 'danger';                               // rouges / oranges
}

// Règles par design : chaque famille reçoit une fonction [h,s,l] → [h,s,l]
const DESIGNS = {
  nuit: {
    sombre: true,
    polices: { 'Syne': 'Unbounded', 'DM Sans': 'Manrope' },
    googleFonts: 'family=Unbounded:wght@500;700;800&family=Manrope:wght@400;500;600;800',
    couleur: {
      // Neutres : luminosité inversée, teinte bleu graphite
      neutre: ([, , l]) => [222, 0.22, 0.07 + (1 - l) * 0.86],
      // Accent : ambre ; teintes claires → fonds sombres, foncés → texte clair, moyens → ambre lumineux
      accent: ([, s, l], role) => (l > 0.78 ? [218, 0.25, 0.12 + (1 - l) * 0.5] : l < 0.32 ? (role === 'texte' ? [40, 0.9, 0.8] : [222, 0.3, 0.05 + l * 0.5]) : [40, Math.max(s, 0.85), 0.6]),
      succes: ([h, s, l]) => (l > 0.8 ? [h, 0.3, 0.14] : l < 0.3 ? [h, 0.55, 0.7] : [h, Math.min(s, 0.6), 0.5]),
      alerte: ([h, s, l]) => (l > 0.8 ? [h, 0.35, 0.15] : [h, s, Math.max(l, 0.6)]),
      danger: ([h, s, l]) => (l > 0.8 ? [h, 0.35, 0.15] : l < 0.35 ? [h, 0.75, 0.72] : [h, s, 0.6]),
      orange: ([, s, l], role) => (l > 0.8 ? [218, 0.25, 0.12 + (1 - l) * 0.5] : role === 'texte' || l < 0.35 ? [40, 0.9, 0.72] : [40, Math.max(s, 0.85), 0.6]),
    },
    rgbaBlanc: 'rgba(14,19,28,', // voiles blancs → voiles sombres
    forme: `/* Design « Nuit moderne » */
:root{color-scheme:dark;--r:6px}
html{-webkit-font-smoothing:antialiased}
h1,h2,h3{letter-spacing:-0.01em}
[class*="card"],.faq-item,details,.tile,.offer,.pb-tile,.more-offer,.callback-card,.contact-method{border-radius:6px!important}
.btn,.btn-primary,.nav-cta,.cta-call,.cta-primary,button[type=submit]{border-radius:6px!important}
img{filter:brightness(.92)}
/* pied de page : reste sombre (le site d'origine l'a foncé sur fond clair) */
body>footer,footer.footer,.site-footer{background:#0a0d13!important;border-top:1px solid #263044!important}
body>footer,body>footer *:not(a),footer.footer *:not(a){color:#b8c2d4!important}
body>footer a,footer.footer a{color:#f5b83d!important}
body>footer .logo,body>footer strong{color:#eef2f8!important}
body>footer a.admin-door,footer a.admin-door{color:inherit!important}
`,
  },
  artisan: {
    sombre: false,
    polices: { 'Syne': 'Bricolage Grotesque', 'DM Sans': 'Source Serif 4' },
    googleFonts: 'family=Bricolage+Grotesque:opsz,wght@12..96,600;12..96,800&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600',
    couleur: {
      // Neutres : gris tirés vers le vert-de-gris, fonds blancs légèrement teintés
      neutre: ([, , l]) => [100, l > 0.9 ? 0.12 : 0.1, l > 0.985 ? 0.985 : l],
      // Accent : vert forêt (luminosité conservée → mêmes contrastes)
      accent: ([, s, l]) => [152, Math.min(s, 0.45) * (l > 0.85 ? 0.8 : 1), l < 0.5 ? Math.max(l - 0.08, 0.16) : l],
      // Action (appel, succès) : ocre
      succes: ([, s, l]) => [36, Math.min(s + 0.1, 0.75), l > 0.85 ? l : clamp(l + 0.04, 0.3, 0.42)],
      alerte: ([h, s, l]) => [h, s * 0.8, l],
      danger: ([h, s, l]) => [h - 4, s * 0.85, l],
      orange: ([, s, l]) => [34, Math.min(s, 0.7), l],
    },
    garderLuminance: true,
    rgbaBlanc: null,
    forme: `/* Design « Artisan chaleureux » */
:root{--r:4px}
[class*="card"],.faq-item,details,.tile,.offer,.pb-tile,.more-offer,.callback-card,.contact-method{border-radius:4px!important;border-width:2px!important}
.btn,.btn-primary,.nav-cta,.cta-call,.cta-primary,button[type=submit]{border-radius:3px!important;letter-spacing:.01em}
h1,h2{letter-spacing:-0.015em}
p,li{line-height:1.75}
`,
  },
};

export const DESIGNS_DISPONIBLES = ['clair', ...Object.keys(DESIGNS)];

export function transformeur(nom) {
  const d = DESIGNS[nom];
  if (!d) return null;
  const cache = new Map();
  // role : 'texte' (color, fill…) ou 'fond' (background, bordure…) ; une même couleur sombre peut servir aux deux
  const hex = (h, role = 'fond') => {
    const k = h.toLowerCase();
    const ck = k + role;
    if (cache.has(ck)) return cache.get(ck);
    if (k === '#25d366') { cache.set(ck, h); return h; } // vert WhatsApp : marque tierce, inchangé
    const hsl = rgbToHsl(hexToRgb(k));
    let cible = d.couleur[famille(hsl)](hsl, role);
    if (d.garderLuminance) cible = versLuminance(cible, luminance(k.length === 4 ? '#' + k.slice(1).split('').map((c) => c + c).join('') : k));
    const out = hslToHex(cible);
    cache.set(ck, out); return out;
  };
  const roleAvant = (txt, i) => {
    const avant = txt.slice(Math.max(0, i - 160), i);
    const m = avant.match(/([a-zA-Z-]+)\s*[:=]\s*[^;{}:=]*$/);
    if (!m) return 'fond';
    if (/^--/.test(m[1])) return /(text|muted|fg|ink|titre|title)/i.test(m[1]) ? 'texte' : 'fond'; // variables CSS : d'après leur nom
    return /^(color|fill|stroke|caret-color|text-decoration-color|-webkit-text-fill-color|outline-color)$/i.test(m[1]) ? 'texte' : 'fond';
  };
  const rgba = (m, r, g, b, a, role) => {
    const nouveau = hex('#' + [r, g, b].map((v) => (+v).toString(16).padStart(2, '0')).join(''), role);
    const [R, G, B] = hexToRgb(nouveau).map((v) => Math.round(v * 255));
    return `rgba(${R},${G},${B},${a})`;
  };
  return {
    sombre: d.sombre,
    forme: d.forme,
    exclus: d.sombre ? ['chat-widget.js'] : [],
    // Applique le design à un fichier texte (HTML, CSS, JS du site public)
    appliquer(txt) {
      txt = txt.replace(/rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)/g,
        (m, r, g, b, a, i, all) => rgba(m, r, g, b, a ?? 1, roleAvant(all, i)));
      // #rrggbbaa et #rgba : on transforme la couleur et on garde la transparence
      txt = txt.replace(/#([0-9a-fA-F]{6})([0-9a-fA-F]{2})\b/g, (m, c, a, i, all) => hex('#' + c, roleAvant(all, i)) + a);
      txt = txt.replace(/#([0-9a-fA-F]{3})([0-9a-fA-F])\b(?![0-9a-fA-F])/g, (m, c, a, i, all) => hex('#' + c, roleAvant(all, i)) + a + a);
      txt = txt.replace(/#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b(?![0-9a-fA-F])/g, (m, i, all) => hex(m, roleAvant(all, i)));
      txt = txt.replace(/\bwhite\b(?=\s*[;!}"'])/g, hex('#ffffff')).replace(/\bblack\b(?=\s*[;!}"'])/g, hex('#000000'));
      for (const [a, b] of Object.entries(d.polices)) txt = txt.split(`'${a}'`).join(`'${b}'`).split(`"${a}"`).join(`"${b}"`);
      txt = txt.replace(/https:\/\/fonts\.googleapis\.com\/css2\?[^"')\s]*/g, `https://fonts.googleapis.com/css2?${d.googleFonts}&display=swap`);
      if (d.sombre) txt = txt.replace(/color-scheme:\s*light/g, 'color-scheme:dark');
      return txt;
    },
  };
}
