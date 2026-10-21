// ─────────────────────────────────────────────────────────────────────────────
// kit/packs.mjs — Packs métier (étape 5 du kit).
//
// Le site source est un site de dépannage informatique. Un pack
// (kit/packs/<metier>.json) le transforme en site d'un autre métier à
// domicile : grille et services réservables, accueil, pages services,
// pages par ville, contrats, CGV (article « services » et grille), carnet
// d'équipements de l'espace client, textes propres à l'informatique.
//
// Les textes du pack acceptent des variables : {prenom}, {marque},
// {telephone}, {villeBase}, {departementEn}, {regionEn}, {departement}, {code},
// et tout chemin de la grille ({depannage.deplacement.prix}) qui devient un
// prix affiché (balise data-tarif dans les pages).
// ─────────────────────────────────────────────────────────────────────────────

import fs from 'node:fs';
import path from 'node:path';
import { coquille, METIER_INFORMATIQUE } from './zone.mjs';
import { fmt } from './services.mjs';

const h = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const get = (o, p) => p.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
const texteBrut = (s) => String(s).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

export function chargerPack(CFG, KIT) {
  const m = CFG.metier || 'informatique';
  if (m === 'informatique') return null;
  const f = path.join(KIT, 'packs', `${m}.json`);
  if (!fs.existsSync(f)) throw new Error(`pack métier introuvable : kit/packs/${m}.json`);
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

export const metierVilles = (pack) => (pack?.villes ? { ...METIER_INFORMATIQUE, ...pack.villes } : METIER_INFORMATIQUE);

// Remplit les variables d'un texte du pack. html=true : prix en <span data-tarif>, sinon texte simple.
export function remplir(tpl, ctx, T, { html = true } = {}) {
  return String(tpl ?? '').replace(/\{([\w.]+)\}/g, (m, k) => {
    if (ctx[k] != null) return html ? h(ctx[k]) : ctx[k];
    const v = get(T, k);
    if (v === undefined || typeof v === 'object') return m;
    if (!/\.prix$/.test(k)) return String(v);
    return html ? `<span data-tarif="${k}">${fmt(v)}</span>` : fmt(v).replace('&nbsp;', ' ');
  });
}

export function contexte(CFG, Z) {
  return {
    prenom: CFG.identite.prenom, marque: CFG.identite.marque, telephone: CFG.contact.telephone,
    villeBase: Z?.villeBase || CFG.identite.adresse.ville, departement: Z?.departement || '', code: Z?.departementCode || '',
    departementEn: Z?.departementEn || '', regionEn: Z?.regionEn || '', region: Z?.region || '',
  };
}

const remplacerBloc = (txt, nom, contenu, fichier) => {
  const re = new RegExp(`(<!-- kit:${nom} -->\\n)[\\s\\S]*?(<!-- /kit:${nom} -->\\n?)`);
  if (!re.test(txt)) throw new Error(`${fichier} : marqueur kit:${nom} introuvable`);
  return txt.replace(re, () => contenu);
};
const remplacerBlocJs = (txt, nom, contenu, fichier) => {
  const re = new RegExp(`// kit:${nom}\\n[\\s\\S]*?// /kit:${nom}\\n?`);
  if (!re.test(txt)) throw new Error(`${fichier} : marqueur kit:${nom} introuvable`);
  return txt.replace(re, () => contenu);
};
const meta = (txt, attr, nom, valeur) => txt.replace(new RegExp(`(<meta ${attr}="${nom}" content=")[^"]*(")`), (m, a, b) => a + h(valeur) + b);

// Prix « à partir de » d'un service, en HTML
function prixService(T, k) {
  const t = T.services[k];
  const tag = `<span data-tarif="services.${k}.prix">${fmt(t.prix)}</span>`;
  if (t.prix == null) return 'sur devis';
  if (t.unite === 'h') return `${tag} / heure`;
  return `${t.aPartirDe ? 'à partir de ' : ''}${tag}`;
}

// ─── Application du pack sur le dossier généré ──────────────────────────────
export function appliquerPack(OUT, pack, CFG, Z, T, gabarit) {
  const ctx = contexte(CFG, Z);
  const R = (s) => remplir(s, ctx, T);
  const Rt = (s) => remplir(s, ctx, T, { html: false });
  const base = `https://${CFG.site.domaine}/`;
  const A = pack.accueil || {};
  const pagesService = {};
  const lire = (f) => fs.readFileSync(path.join(OUT, f), 'utf8');
  const ecrire = (f, t) => fs.writeFileSync(path.join(OUT, f), t);
  const rdvLien = (k) => `makouez-it-rdv.html?service=${encodeURIComponent(T.services[k].libelle).replace(/%20/g, '+')}`;
  const tel = CFG.contact.telephoneIntl;

  // 1. Pages services
  const SP = pack.servicesPages || {};
  for (const [k, p] of Object.entries(SP)) {
    const t = T.services[k];
    if (!t) throw new Error(`servicesPages.${k} : service absent de la grille`);
    const url = base + p.fichier;
    const coque = coquille(gabarit, {
      titre: `${p.titre} – ${CFG.identite.marque}`, description: p.description, url,
      jsonld: { '@context': 'https://schema.org', '@type': 'Service', name: p.titre, serviceType: pack.villes?.serviceType || pack.libelle,
        provider: { '@type': 'LocalBusiness', name: CFG.identite.marque, url: base, telephone: tel, email: CFG.contact.email },
        areaServed: Z ? [Z.departement, ...Z.villes.map((v) => v.nom)] : [CFG.identite.adresse.ville], url,
        ...(typeof t.prix === 'number' ? { offers: { '@type': 'Offer', price: String(t.prix), priceCurrency: 'EUR' } } : {}) },
    });
    const f = t.forfait && T.depannage?.[t.forfait.base];
    const autres = Object.entries(SP).filter(([k2]) => k2 !== k);
    const main = `<main class="wrap" id="contenu" tabindex="-1">
<section class="hero"><div class="badge">${h(pack.libelle)}</div><h1>${h(p.titre)}</h1><p>${R(p.intro)}</p><div class="cta"><a class="btn btnp" href="${rdvLien(k)}">Prendre rendez-vous</a><a class="btn btno" href="tel:${tel}">Appeler ${h(CFG.identite.prenom)}</a></div></section>
${(p.sections || []).map((x) => `<section class="section"><h2>${h(x.titre)}</h2><p>${R(x.texte)}</p></section>`).join('\n')}
<section class="section"><h2>Le prix</h2><div class="cards">
<div class="card"><h3>${h(t.nom)}</h3><p><strong>${prixService(T, k).replace(/^à/, 'À').replace(/^sur/, 'Sur')}</strong>${t.note ? ` · ${h(t.note)}` : ''}</p></div>
${f ? `<div class="card"><h3>${h(f.nom)}${f.duree && !f.nom.includes(f.duree) ? ` · ${h(f.duree)}` : ''}</h3><p><strong data-tarif="depannage.${t.forfait.base}.prix">${fmt(f.prix)}</strong> : ${h(f.detail)}.</p></div>` : ''}
</div><p style="margin-top:1rem">Le prix est confirmé avec vous avant de commencer. Paiement après l’intervention.</p></section>
${autres.length ? `<section class="section"><h2>Autres interventions</h2><div class="cards">${autres.map(([k2, p2]) => `<div class="card"><h3><a href="${p2.fichier}" style="color:inherit">${h(p2.titre)}</a></h3><p>${prixService(T, k2).replace(/^à/, 'À').replace(/^sur/, 'Sur')}</p></div>`).join('')}</div></section>` : ''}
<section class="foot"><h2>Besoin d’un rendez-vous ?</h2><p>Vous pouvez réserver en ligne sans créer de compte, ou demander à être rappelé.</p><div class="cta"><a class="btn btnp" href="${rdvLien(k)}">Réserver</a><a class="btn btno" href="index.html#callback">Être rappelé</a></div></section>
</main>`;
    pagesService[p.fichier] = coque(main);
  }
  for (const [f, c] of Object.entries(pagesService)) ecrire(f, c);

  // 2. Accueil
  {
    let t = lire('index.html');
    const titre = Rt(A.title);
    t = t.replace(/<title>[\s\S]*?<\/title>/, `<title>${h(titre)}</title>`);
    t = meta(t, 'name', 'description', Rt(A.description));
    t = meta(t, 'property', 'og:title', titre);
    t = meta(t, 'property', 'og:description', Rt(A.ogDescription || A.description));
    t = meta(t, 'property', 'og:image:alt', titre);
    t = meta(t, 'name', 'twitter:title', titre);
    t = meta(t, 'name', 'twitter:description', Rt(A.ogDescription || A.description));
    t = remplacerBloc(t, 'accueil-titre', `    <h1>${remplir(A.h1, ctx, T)}</h1>\n    <p class="lede">${R(A.lede)}</p>\n`, 'index.html');
    const tuiles = (A.tuiles || []).map((x) => {
      const s = T.services[x.service];
      const page = SP[x.service]?.fichier || rdvLien(x.service);
      return `      <a class="pb-tile" href="${page}"><span class="pb-ico" aria-hidden="true">${s.icone || '•'}</span><span class="pb-txt"><strong>${h(x.titre)}</strong><small>${h(s.nom)} · ${prixService(T, x.service)}</small></span></a>`;
    }).join('\n');
    t = remplacerBloc(t, 'accueil-tuiles', `    <h2 class="pb-title">${h(A.tuilesTitre || 'Quel est votre besoin ?')}</h2>\n    <div class="pb-grid">\n${tuiles}\n    </div>\n`, 'index.html');
    const cartes = (A.forfaits || []).map((x) => {
      const f = T.depannage[x.cle];
      return `      <div class="tarif-card${x.badge ? ' featured' : ''}">
${x.badge ? `        <div class="tarif-badge">${h(x.badge)}</div>\n` : ''}        <div class="tarif-name">${h(f.nom)}</div>
        <div class="tarif-price"><span data-tarif="depannage.${x.cle}.prix">${fmt(f.prix)}</span>${f.duree && !f.nom.includes(f.duree) ? ` <span>· ${h(f.duree)}</span>` : ''}</div>
        <div class="tarif-desc">${R(x.desc || f.detail)}</div>
      </div>`;
    }).join('\n');
    const offres = (A.autresOffres || []).filter((o) => !o.lien || fs.existsSync(path.join(OUT, o.lien.split('#')[0])))
      .map((o) => `      <a class="more-offer" href="${o.lien}"><strong>${h(o.titre)}</strong><span>${R(o.texte)}</span><em>${h(o.action || 'En savoir plus →')}</em></a>`).join('\n');
    t = remplacerBloc(t, 'accueil-tarifs', `    <h2 class="section-title">${h(A.tarifsTitre)}</h2>
    <p class="section-sub">${R(A.tarifsSous)}</p>
    <div class="tarifs-grid">
${cartes}
    </div>
${A.noteForfaits ? `    <div class="tarif-heure-supp">${R(A.noteForfaits)}</div>\n` : ''}${offres ? `\n    <div class="more-offers">\n${offres}\n    </div>\n` : ''}`, 'index.html');
    if (A.process) t = remplacerBloc(t, 'accueil-process', A.process.map(([ti, tx], i) => `      <div class="process-card"><div class="process-step">${i + 1}</div><h3>${R(ti)}</h3><p>${R(tx)}</p></div>\n`).join(''), 'index.html');
    if (A.valeurs) t = remplacerBloc(t, 'accueil-valeurs', A.valeurs.map(([ic, ti, tx]) => `          <div class="value-item"><div class="value-icon"><span aria-hidden="true">${ic}</span></div><div><h3>${R(ti)}</h3><p>${R(tx)}</p></div></div>\n`).join(''), 'index.html');
    if (A.faq) t = remplacerBloc(t, 'accueil-faq', A.faq.map((x) => `      <div class="faq-item"><div class="faq-q">${R(x.q)} <span class="faq-arrow">+</span></div><div class="faq-a">${R(x.r)}</div></div>\n`).join(''), 'index.html');
    // Données structurées : entreprise, offres de la grille, FAQ visible
    const offers = Object.entries(T.services).filter(([, s]) => typeof s.prix === 'number')
      .map(([, s]) => ({ '@type': 'Offer', itemOffered: { '@type': 'Service', name: s.nom }, price: String(s.prix), priceCurrency: 'EUR', ...(s.unite === 'h' ? { unitText: 'heure' } : {}) }));
    const area = Z ? [{ '@type': 'AdministrativeArea', name: Z.region }, { '@type': 'AdministrativeArea', name: `${Z.departement} (${Z.departementCode})` }, ...Z.villes.map((v) => ({ '@type': 'City', name: v.nom }))] : [];
    const ld = { '@context': 'https://schema.org', '@graph': [
      { '@type': 'LocalBusiness', '@id': `${base}#business`, name: CFG.identite.marque, description: Rt(A.description), url: base.replace(/\/$/, ''),
        telephone: tel, email: CFG.contact.email, image: `${base}og-image.png`, priceRange: '€€', areaServed: area,
        founder: { '@type': 'Person', name: CFG.identite.nomComplet, jobTitle: pack.activite ? pack.activite.charAt(0).toUpperCase() + pack.activite.slice(1) : undefined },
        identifier: { '@type': 'PropertyValue', propertyID: 'SIRET', value: CFG.identite.siret },
        hasOfferCatalog: { '@type': 'OfferCatalog', name: pack.libelle, itemListElement: offers } },
      ...(A.faq ? [{ '@type': 'FAQPage', mainEntity: A.faq.map((x) => ({ '@type': 'Question', name: Rt(x.q), acceptedAnswer: { '@type': 'Answer', text: texteBrut(Rt(x.r)) } })) }] : []),
    ] };
    t = t.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, () => `<script type="application/ld+json">\n${JSON.stringify(ld)}\n</script>`);
    if (A.pied) t = t.replace(/(<footer>[\s\S]*?<div>)Technicien informatique à domicile/, (m, a) => a + h(A.pied));
    ecrire('index.html', t);
  }

  // 3. Contrats
  if (fs.existsSync(path.join(OUT, 'contrats.html'))) {
    let t = lire('contrats.html');
    const P = pack.contratsPage || {};
    t = remplacerBloc(t, 'contrats-comparatif', '', 'contrats.html');
    if (P.faq) t = remplacerBloc(t, 'contrats-faq', P.faq.map((x) => `    <div class="faq-item"><div class="faq-q">${R(x.q)} <span class="faq-arrow">+</span></div><div class="faq-a">${R(x.r)}</div></div>\n`).join(''), 'contrats.html');
    if (P.titre) t = t.replace(/<h1 class="page-title">[^<]*<\/h1>/, `<h1 class="page-title">${h(P.titre)}</h1>`);
    if (P.sous) t = t.replace(/(<h1 class="page-title">[^<]*<\/h1>\s*<p class="page-sub">)[^<]*(<\/p>)/, (m, a, b) => a + R(P.sous) + b);
    const titreContrats = `${P.titre || 'Contrats'} – ${CFG.identite.marque}`;
    t = t.replace(/<title>[\s\S]*?<\/title>/, `<title>${h(titreContrats)}</title>`);
    t = meta(t, 'name', 'description', texteBrut(Rt(P.sous || '')));
    t = meta(t, 'property', 'og:title', titreContrats);
    t = meta(t, 'property', 'og:description', texteBrut(Rt(P.sous || '')));
    t = t.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, () => `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'WebPage', name: titreContrats, description: texteBrut(Rt(P.sous || '')), url: `${base}contrats.html` })}</script>`);
    ecrire('contrats.html', t);
  }

  // 4. CGV : article « Services proposés » et grille (contenu légal : à faire valider par le client)
  if (fs.existsSync(path.join(OUT, 'cgv.html'))) {
    let t = lire('cgv.html');
    if (pack.cgvServices) t = t.replace(/(<h2><span aria-hidden="true">🛠️<\/span> Services proposés<\/h2>\s*<p>[^<]*<\/p>\s*<ul>)[\s\S]*?(<\/ul>)/, (m, a, b) => `${a}\n${pack.cgvServices.map((x) => `      <li>${h(x)}</li>`).join('\n')}\n    ${b}`);
    const L = [];
    for (const [k, f] of Object.entries(T.depannage || {})) L.push([f.duree && !f.nom.includes(f.duree) ? `${f.nom} (${f.duree})` : f.nom, `<span data-tarif="depannage.${k}.prix">${fmt(f.prix)}</span>${f.unite === 'h' ? '/h' : ''}`]);
    for (const [k, s] of Object.entries(T.services || {})) L.push([s.nom, `${prixService(T, k)}${s.note ? ` (${h(s.note.charAt(0).toLowerCase() + s.note.slice(1))})` : ''}`]);
    for (const [k, c] of Object.entries(T.contrats || {})) L.push([c.nom, `<span data-tarif="contrats.${k}.prix">${fmt(c.prix)}</span>/mois`]);
    t = t.replace(/<div class="tarif-box">[\s\S]*?\n    <\/div>/, `<div class="tarif-box">\n${L.map(([a, b]) => `      <div class="tarif-row"><span class="tarif-service">${h(a)}</span><span class="tarif-price">${b}</span></div>`).join('\n')}\n    </div>`);
    t = t.replace(/\s*<p style="margin-top:0\.75rem">Les offres destinées aux professionnels[^\n]*<\/p>/, '\n    <p style="margin-top:0.75rem">Le tarif applicable est confirmé au client avant toute intervention ; un devis gratuit est établi pour tout chantier.</p>');
    ecrire('cgv.html', t);
  }

  // 5. Espace client : carnet d'équipements
  const E = pack.equipements;
  if (E && fs.existsSync(path.join(OUT, 'mon-rdv.html'))) {
    let t = lire('mon-rdv.html');
    t = remplacerBloc(t, 'appareils-options', E.types.map(([id, , nom]) => `<option value="${h(id)}">${h(nom)}</option>`).join('') + '\n', 'mon-rdv.html');
    t = remplacerBlocJs(t, 'appareils-types', `const TYPES=${JSON.stringify(Object.fromEntries(E.types.map(([id, ic, nom]) => [id, [ic, nom]])))};\n`, 'mon-rdv.html');
    if (E.marquePlaceholder) t = t.replace('placeholder="HP, Lenovo, Apple…"', `placeholder="${h(E.marquePlaceholder)}"`);
    if (E.systemeLabel) t = t.replace('<label for="aSysteme">Système</label>', `<label for="aSysteme">${h(E.systemeLabel)}</label>`);
    if (E.systemePlaceholder) t = t.replace('placeholder="Windows 11, Android…"', `placeholder="${h(E.systemePlaceholder)}"`);
    if (pack.conseils) t = remplacerBlocJs(t, 'conseils', `const CONSEILS=${JSON.stringify(pack.conseils.map((x) => Rt(x)), null, 1).replace(/\n\s*/g, '\n  ')};\n`, 'mon-rdv.html');
    if (E.aide) t = t.replace(/(<p class="field-hint" style="margin:-0\.5rem 0 1\.25rem">)[^<]*(<\/p>)/, (m, a, b) => a + R(E.aide) + b);
    ecrire('mon-rdv.html', t);
    const rp = path.join(OUT, 'firestore.rules');
    let r = fs.readFileSync(rp, 'utf8');
    r = r.replace(/(d\['type'\] in \[)[^\]]*(\])/, (m, a, b) => a + E.types.map(([id]) => `'${id}'`).join(', ') + b);
    fs.writeFileSync(rp, r);
  }

  return { pagesService: Object.keys(pagesService) };
}

// Liste des contrats acceptés par les règles Firestore : clés de la grille du client
export function reglesContrats(rules, T) {
  const cles = [...Object.keys(T.contrats || {}),
    ...Object.keys(T.maintenanceWeb || {}).map((k) => `maintenance-${k}`),
    ...(T.pro ? ['pro-ponctuel', ...Object.entries(T.pro).filter(([, v]) => v.unite === 'mois' || v.prix === null).map(([k]) => `pro-${k}`)] : [])];
  return rules.replace(/(&& d\.contrat in \[)[\s\S]*?(\])/, (m, a, b) => `${a}\n        ${cles.map((k) => `'${k}'`).join(', ')}\n      ${b}`);
}

// Termes du métier d'origine restant dans les pages publiques (rapport)
export const TERMES_INFORMATIQUE = /\b(?:informatiques?|ordinateurs?|PC|Windows|Wi-?Fi|virus|logiciels?|imprimantes?|smartphones?|tablettes?|antivirus|malwares?)\b/gi;
