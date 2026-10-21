// ─────────────────────────────────────────────────────────────────────────────
// kit/zone.mjs — Zone d'intervention du client (étape 3 du kit).
//   • textes de zone : « Seine-Saint-Denis », « Île-de-France »… → zone du client
//   • pages locales : une page par ville + une page département, générées
//     sur le gabarit d'une page locale de makouezit.org
//   • bloc « Zone d'intervention » de l'accueil, données structurées, sitemap
// Les pages sont écrites dans la voix de makouezit.org (« je », Stevy) : le
// remplacement d'identité de build.mjs passe ensuite dessus.
// ─────────────────────────────────────────────────────────────────────────────

export const slugify = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/['’]/g, '-').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
const h = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const liste = (arr) => arr.length <= 1 ? (arr[0] || '') : `${arr.slice(0, -1).join(', ')} et ${arr.at(-1)}`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const PREFIXE = { informatique: 'depannage-informatique' };

// Textes des pages locales pour le métier d'origine (dépannage informatique).
// Un pack métier (kit/packs/<metier>.json, bloc « villes ») remplace ces valeurs.
export const METIER_INFORMATIQUE = {
  titreVille: 'Dépannage informatique à {ville}',
  h1Ville: 'Dépannage informatique à domicile à {ville}',
  descriptionVille: 'Technicien informatique à domicile à {ville} ({cp}) : PC lent, virus, Wi-Fi, installation Windows. Prix annoncé avant, paiement après.',
  introVille: 'Makouez IT intervient à domicile à {ville} et dans les communes voisines pour les pannes du quotidien : ordinateur lent, Wi-Fi instable, virus, fichiers perdus ou besoin d’aide pour se servir de son matériel.',
  serviceVille: 'Dépannage informatique à domicile à {ville}',
  serviceType: 'Assistance informatique à domicile',
  titreCartes: 'Les dépannages les plus demandés à {ville}',
  cartes: [
    ['Ordinateur lent ou bloqué', 'Nettoyage, optimisation, mises à jour, vérification du disque.'],
    ['Box et Wi-Fi', 'Connexion lente, coupures, mauvaise couverture dans le logement.'],
    ['Virus et arnaques', 'Nettoyage, protection, changement des mots de passe.'],
    ['Fichiers perdus', 'Récupération de données et mise en place d’une sauvegarde.'],
    ['Installation Windows', 'Réinstallation propre, logiciels utiles, transfert des fichiers.'],
    ['Accompagnement', 'Prise en main de l’ordinateur, du smartphone et des démarches en ligne.'],
  ],
  // Forfaits affichés sur les pages locales : clé de tarifs.json → depannage, et texte
  forfaits: [
    ['diagExpress', 'diagnostic et une réparation simple, déplacement inclus.'],
    ['standard', 'la plupart des dépannages, réinstallations et récupérations.'],
    ['longFormat', 'interventions lourdes, transfert de données, plusieurs appareils.'],
  ],
  rdvService: 'Dépannage PC',
  titreDepartement: 'Dépannage informatique {departementEn} ({code})',
  h1Departement: 'Dépannage informatique à domicile {departementEn}',
  descriptionDepartement: 'Technicien informatique à domicile {departementEn} : {villes}… Prix annoncé avant, paiement après.',
  serviceDepartement: 'Dépannage informatique à domicile {departementEn}',
  titreProcess: 'Comment se passe un dépannage',
};
const remplir = (t, o) => String(t).replace(/\{(\w+)\}/g, (m, k) => (o[k] ?? m));

// Vérifie et complète la configuration de zone
export function zoneConfig(CFG, M = METIER_INFORMATIQUE) {
  const z = CFG.zone || {};
  if (!z.villes?.length) return null;
  const req = ['region', 'regionEn', 'regionDe', 'regionLa', 'departement', 'departementCode', 'departementEn', 'departementDe', 'departementLe'];
  const manque = req.filter((k) => !z[k]);
  if (manque.length) throw new Error('zone incomplète : ' + manque.join(', '));
  const prefixe = M.prefixe || PREFIXE[CFG.metier || 'informatique'] || 'depannage';
  const villes = z.villes.map((v) => ({ ...v, slug: v.slug || slugify(v.nom), voisines: v.voisines || [], quartiers: v.quartiers || [] }))
    .map((v) => ({ ...v, fichier: `${prefixe}-${v.slug}.html`, sections: v.sections || [] }))
    // Page complète = texte propre à la ville (intro + au moins 2 paragraphes) ; sinon noindex pour éviter le contenu dupliqué
    .map((v) => ({ ...v, complete: !!v.intro && v.sections.length >= 2 }));
  const hub = `${prefixe}-${slugify(z.departement)}-${z.departementCode}.html`;
  return { ...z, prefixe, villes, hub, villeBase: z.villeBase || villes[0].nom };
}

// Remplacements de textes de zone (du plus précis au plus général)
export function zoneRemplacements(z) {
  const d = `${z.departement} (${z.departementCode})`;
  return [
    ['Île-de-France, principalement 93 (Seine-Saint-Denis) — Pierrefitte-sur-Seine, Saint-Denis, Stains, Saint-Ouen et environs', `${z.region}, principalement ${z.departementEn} — ${z.villes.map((v) => v.nom).join(', ')} et environs`],
    ['en Seine-Saint-Denis (93)', `${z.departementEn} (${z.departementCode})`],
    ['Seine-Saint-Denis (93)', d],
    ['dans le nord de la Seine-Saint-Denis', z.departementEn],
    ['de la Seine-Saint-Denis', z.departementDe],
    ['de Seine-Saint-Denis', z.departementDe],
    ['en Seine-Saint-Denis', z.departementEn],
    ['la Seine-Saint-Denis', z.departementLe],
    ['Seine-Saint-Denis', z.departement],
    ['Île-de-France (93)', d],
    ['En Île-de-France', cap(z.regionEn)],
    ['en Île-de-France', z.regionEn],
    ["d'Île-de-France", z.regionDe],
    ['toute l\'Île-de-France', `tout ${z.regionLa}`],
    ["l'Île-de-France", z.regionLa],
    ['Île-de-France', z.region],
    ['12 rue de la Paix, Pierrefitte', `12 rue de la Paix, ${z.villeBase}`],
    ['Pierrefitte-sur-Seine (93)', `${z.villeBase} (${z.departementCode})`],
    ['rue de la Paix, Pierrefitte-sur-Seine', `rue de la Paix, ${z.villeBase}`],
    ['rue de la Paix, Stains', `rue de la Paix, ${z.villeBase}`],
  ];
}

export function coquille(gabarit, { titre, description, url, jsonld }) {
  const i = gabarit.indexOf('<main'), j = gabarit.indexOf('</main>') + '</main>'.length;
  let tete = gabarit.slice(0, i), pied = gabarit.slice(j);
  tete = tete.replace(/<title>[\s\S]*?<\/title>/, `<title>${h(titre)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${h(description)}">`)
    .replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${url}">`)
    .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${h(titre)}">`)
    .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${h(description)}">`)
    .replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${url}">`)
    .replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, `<script type="application/ld+json">\n${JSON.stringify(jsonld, null, 2)}\n</script>`);
  return (main) => `${tete}${main}${pied}`;
}

export function genererPages(z, CFG, gabarit, domaine, M = METIER_INFORMATIQUE, T = null) {
  const base = `https://${domaine}/`;
  const pages = {};
  const delai = z.delai || 'généralement sous 24 h';
  const horaires = z.horaires || 'Du lundi au samedi, aux horaires indiqués lors de la réservation.';
  const rdv = `makouez-it-rdv.html?service=${encodeURIComponent(M.rdvService).replace(/%20/g, '+')}`;
  const fmtEur = (v) => (v == null ? 'Sur devis' : `${String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}&nbsp;€`);
  const forfaitsHtml = M.forfaits.map(([k, txt]) => {
    const f = T?.depannage?.[k] || { nom: k, prix: null };
    return `<div class="card"><h3>${h(f.nom)}${f.duree && !f.nom.includes(f.duree) ? ` · ${h(f.duree)}` : ''}</h3><p><strong data-tarif="depannage.${k}.prix">${fmtEur(f.prix)}</strong> : ${h(txt)}</p></div>`;
  }).join('\n');

  for (const v of z.villes) {
    const autres = z.villes.filter((x) => x !== v);
    const voisinesLiens = v.voisines.map((n) => { const p = z.villes.find((x) => x.nom === n); return p ? `<a href="${p.fichier}">${h(n)}</a>` : h(n); });
    const o = { ville: v.nom, cp: v.codePostal };
    const titre = `${remplir(M.titreVille, o)} – Makouez IT`;
    const description = remplir(M.descriptionVille, o).slice(0, 160);
    const intro = v.intro || remplir(M.introVille, o);
    const coque = coquille(gabarit, {
      titre, description, url: base + v.fichier,
      jsonld: { '@context': 'https://schema.org', '@type': 'Service', name: remplir(M.serviceVille, o),
        provider: { '@type': 'LocalBusiness', name: 'Makouez IT', url: base, telephone: '+33745103827', email: 'contact@makouezit.org' },
        areaServed: [v.nom, ...v.voisines, z.departement], serviceType: M.serviceType, url: base + v.fichier },
    });
    const main = `<main class="wrap" id="contenu" tabindex="-1">
<section class="hero"><div class="badge">${h(v.nom)} et alentours</div><h1>${h(remplir(M.h1Ville, o))}</h1><p>${h(intro)}</p><div class="cta"><a class="btn btnp" href="${rdv}">Prendre rendez-vous</a><a class="btn btno" href="tel:+33745103827">Appeler Stevy</a></div></section>
${v.sections.map((x) => `<section class="section"><h2>${h(x.titre)}</h2><p>${h(x.texte)}</p></section>`).join('\n')}
<section class="section"><h2>${h(remplir(M.titreCartes, o))}</h2><div class="cards">${M.cartes.map(([t, d]) => `<div class="card"><h3>${h(t)}</h3><p>${h(d)}</p></div>`).join('')}</div></section>
${v.quartiers.length || v.voisines.length ? `<section class="section"><h2>Où j’interviens autour de ${h(v.nom)}</h2>
${v.quartiers.length ? `<p>À ${h(v.nom)} : ${h(liste(v.quartiers))}.</p>` : ''}
${v.voisines.length ? `<p>Communes voisines : ${liste(voisinesLiens)}.</p>` : ''}
<p>Le déplacement est inclus dans le forfait, ${h(z.departementEn)} comme ${h(z.regionEn)}.</p></section>` : ''}
<section class="section"><h2>Des prix annoncés avant</h2><div class="cards">
${forfaitsHtml}
</div><p style="margin-top:1rem">Paiement après l’intervention. Le forfait est confirmé avec vous avant de commencer.</p></section>
<section class="section"><h2>Questions fréquentes à ${h(v.nom)}</h2><div class="cards">
<div class="card"><h3>Sous quel délai ?</h3><p>${h(cap(delai))}. Pour une urgence, appelez le 07 45 10 38 27.</p></div>
<div class="card"><h3>Quels horaires ?</h3><p>${h(horaires)}</p></div>
<div class="card"><h3>Et ailleurs ${h(z.departementEn)} ?</h3><p>${autres.length ? `Voir aussi ${liste(autres.slice(0, 4).map((x) => `<a href="${x.fichier}">${h(x.nom)}</a>`))}, ou` : 'Voir'} la page <a href="${z.hub}">${h(z.departement)} (${h(z.departementCode)})</a>.</p></div>
</div></section>
<section class="foot"><h2>Besoin d’aide rapidement ?</h2><p>Vous pouvez réserver sans créer de compte, ou demander à être rappelé.</p><div class="cta"><a class="btn btnp" href="${rdv}">Réserver maintenant</a><a class="btn btno" href="index.html#callback">Être rappelé</a></div></section>
</main>`;
    let page = coque(main);
    if (!v.complete) page = page.replace('<meta name="viewport"', '<meta name="robots" content="noindex, follow">\n<meta name="viewport"');
    pages[v.fichier] = page;
  }

  // Page département (hub)
  {
    const o = { departementEn: z.departementEn, code: z.departementCode, villes: z.villes.map((v) => v.nom).slice(0, 4).join(', ') };
    const titre = `${remplir(M.titreDepartement, o)} – Makouez IT`;
    const description = remplir(M.descriptionDepartement, o).slice(0, 160);
    const coque = coquille(gabarit, {
      titre, description, url: base + z.hub,
      jsonld: { '@context': 'https://schema.org', '@type': 'Service', name: remplir(M.serviceDepartement, o),
        provider: { '@type': 'LocalBusiness', name: 'Makouez IT', url: base, telephone: '+33745103827', email: 'contact@makouezit.org' },
        areaServed: [z.departement, ...z.villes.map((v) => v.nom)], serviceType: M.serviceType, url: base + z.hub },
    });
    const main = `<main class="wrap" id="contenu" tabindex="-1">
<section class="hero"><div class="badge">${h(z.departement)} (${h(z.departementCode)})</div><h1>${h(remplir(M.h1Departement, o))}</h1><p>${h(z.introDepartement || `J’interviens à domicile ${z.departementEn}, ${delai}. Choisissez votre ville pour voir les détails.`)}</p><div class="cta"><a class="btn btnp" href="${rdv}">Prendre rendez-vous</a><a class="btn btno" href="tel:+33745103827">Appeler Stevy</a></div></section>
<section class="section"><h2>Villes desservies</h2><div class="cards">${z.villes.map((v) => `<div class="card"><h3><a href="${v.fichier}">${h(v.nom)}</a></h3><p>${h(v.codePostal)}${v.voisines.length ? ` · avec ${h(liste(v.voisines))}` : ''}</p></div>`).join('')}</div></section>
<section class="section"><h2>${h(M.titreProcess)}</h2><div class="cards">
<div class="card"><h3>1. Vous décrivez le problème</h3><p>En ligne, par téléphone ou par WhatsApp, avec vos mots.</p></div>
<div class="card"><h3>2. Je confirme le créneau et le prix</h3><p>Le forfait est annoncé avant de commencer, déplacement inclus.</p></div>
<div class="card"><h3>3. J’interviens chez vous</h3><p>Réparation, explications, et paiement une fois le travail terminé.</p></div>
</div></section>
<section class="foot"><h2>Une question ?</h2><p>Appelez le 07 45 10 38 27 ou demandez à être rappelé.</p><div class="cta"><a class="btn btnp" href="${rdv}">Réserver</a><a class="btn btno" href="index.html#callback">Être rappelé</a></div></section>
</main>`;
    pages[z.hub] = coque(main);
  }
  return pages;
}

// Bloc « Zone d'intervention » de l'accueil + données structurées
export function adapterAccueil(html, z) {
  const chips = z.villes.map((v) => `      <a class="zone-chip main" href="${v.fichier}">${h(v.nom)}</a>`).join('\n');
  const bloc = `    <p class="section-sub">${h(z.phrasePriorite || `J'interviens ${z.departementEn}. Choisissez votre ville :`)}</p>
    <div class="zone-chips zone-big">
${chips}
      <a class="zone-chip main" href="${z.hub}">Tout le département (${h(z.departementCode)})</a>
    </div>
${z.surDemande ? `    <p style="color:var(--muted);margin-top:1.25rem">${h(z.surDemande)}</p>\n` : ''}`;
  html = html.replace(/ *<!-- kit:zone-villes[\s\S]*?<!-- \/kit:zone-villes -->\n/, bloc);
  const area = [{ '@type': 'AdministrativeArea', name: z.region }, { '@type': 'AdministrativeArea', name: `${z.departement} (${z.departementCode})` },
    ...z.villes.map((v) => ({ '@type': 'City', name: v.nom }))];
  html = html.replace(/"areaServed":\[[^\]]*\]/, `"areaServed":${JSON.stringify(area)}`);
  html = html.replace(/Pierrefitte-sur-Seine, Saint-Denis, Stains, Épinay-sur-Seine/g, z.villes.slice(0, 4).map((v) => v.nom).join(', '));
  return html;
}

// Suggestions d'adresse de secours (réservation) : villes du client
export function adapterReservation(js, z) {
  const villes = z.villes.map((v) => `${v.nom}, ${z.departement}, France`);
  // « const cities=[…].filter(…) » : liste de secours quand Google Maps est indisponible
  return js.replace(/const cities=\[[^\]]*\]/, `const cities=${JSON.stringify(villes)}`);
}

export function entreesSitemap(z, domaine, date) {
  const u = (f, p) => `  <url><loc>https://${domaine}/${f}</loc><lastmod>${date}</lastmod><changefreq>monthly</changefreq><priority>${p}</priority></url>`;
  return `\n  <!-- Pages locales (générées par le kit) -->\n${[u(z.hub, '0.9'), ...z.villes.filter((v) => v.complete).map((v) => u(v.fichier, v.principale ? '0.85' : '0.8'))].join('\n')}\n`;
}
