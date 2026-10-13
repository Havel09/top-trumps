/**
 * galerie.js — Ma collection : cartes possédées en couleur, les manquantes
 * en silhouette, filtre par rareté et complétude.
 */

(() => {
  const $ = (id) => document.getElementById(id);

  let cartes = [];
  let raretes = {};
  let libelles = {};
  let puissances = [];
  let possedees = new Set();
  let filtre = 'toutes';

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const [config, catalogue, inventaire] = await Promise.all([
        Api.config(),
        Api.cartes(),
        Portefeuille.inventaire(),
      ]);
      raretes = {};
      libelles = {};
      for (const r of config.jeu.raretes) raretes[r.cle] = r.nom;
      for (const a of config.jeu.attributs) libelles[a.cle] = a.nom;
      puissances = config.jeu.pouvoirs || [];
      cartes = catalogue.cartes;
      possedees = new Set(Object.keys(inventaire.cartes || {}));
      Portefeuille.afficherSolde($('zone-solde'), inventaire.pieces);
    } catch (e) {
      $('grille').textContent = `Impossible de charger la galerie : ${e.message}`;
      return;
    }

    construireResume();
    construireFiltres();
    afficher();
  });

  /** Résumé : total possédé, complétude et répartition par rareté. */
  function construireResume() {
    const total = cartes.length;
    const parRarete = {};
    let possedeesTotal = 0;

    for (const c of cartes) {
      const possedee = possedees.has(String(c.id));
      if (possedee) possedeesTotal++;
      if (!parRarete[c.rarete]) parRarete[c.rarete] = { possedees: 0, total: 0 };
      parRarete[c.rarete].total++;
      if (possedee) parRarete[c.rarete].possedees++;
    }

    $('nb-cartes').textContent = String(total);
    $('nb-possedees').textContent = String(possedeesTotal);
    $('progression').textContent = `${Math.round((100 * possedeesTotal) / total)} %`;

    const range = $('resume-raretes');
    range.textContent = '';
    for (const [cle, compte] of Object.entries(parRarete)) {
      const nom = raretes[cle] || cle;
      range.append(
        Interface.creer(
          'span',
          { 'resume-raretes__item': true, [`resume-raretes__item--${cle}`]: true },
          `${nom} : ${compte.possedees}/${compte.total}`
        )
      );
    }
  }

  /** Un bouton par rareté réellement présente, comme la page collection. */
  function construireFiltres() {
    const conteneur = document.querySelector('.filtres');
    const compte = {};
    for (const c of cartes) compte[c.rarete] = (compte[c.rarete] || 0) + 1;

    for (const rarete of Object.keys(raretes).filter((cle) => compte[cle])) {
      const bouton = Interface.creer('button', { filtre: true }, `${raretes[rarete]} (${compte[rarete]})`);
      bouton.type = 'button';
      bouton.dataset.rarete = rarete;
      bouton.addEventListener('click', () => {
        filtre = rarete;
        for (const b of conteneur.querySelectorAll('.filtre')) {
          b.classList.toggle('est-actif', b.dataset.rarete === filtre);
        }
        afficher();
      });
      conteneur.append(bouton);
    }
  }

  function afficher() {
    const grille = $('grille');
    grille.textContent = '';

    for (const c of cartes) {
      if (filtre !== 'toutes' && c.rarete !== filtre) continue;

      const possedee = possedees.has(String(c.id));
      const el = Interface.carte(c, { libelles, raretes, puissances });

      if (possedee) {
        el.classList.add('carte--possedee');
        el.append(Interface.creer('span', { 'carte__possession': true }, 'En collection'));
      } else {
        el.classList.add('carte--manquante');
        const voile = Interface.creer('div', { 'carte__manquante': true });
        voile.append(Interface.creer('span', { 'carte__manquante-symbole': true }, '?'));
        voile.title = 'Carte à trouver dans un booster';
        el.append(voile);
      }
      grille.append(el);
    }
  }
})();