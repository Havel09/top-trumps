/**
 * collection.js — Galerie des 32 cartes, avec filtre par rareté.
 */

(() => {
  const $ = (id) => document.getElementById(id);

  let cartes = [];
  let raretes = {};
  let libelles = {};
  let puissances = [];
  let filtre = 'toutes';

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const [config, catalogue] = await Promise.all([Api.config(), Api.cartes()]);
      raretes = {};
      libelles = {};
      for (const r of config.jeu.raretes) raretes[r.cle] = r.nom;
      for (const a of config.jeu.attributs) libelles[a.cle] = a.nom;
      puissances = config.jeu.pouvoirs || [];
      cartes = catalogue.cartes;
    } catch (e) {
      $('grille').textContent = `Impossible de charger la collection : ${e.message}`;
      return;
    }

    $('nb-cartes').textContent = String(cartes.length);
    construireFiltres();
    afficher();
  });

  /** Un bouton par rareté réellement présente dans le jeu. */
  function construireFiltres() {
    const conteneur = document.querySelector('.filtres');
    const compte = {};
    for (const c of cartes) compte[c.rarete] = (compte[c.rarete] || 0) + 1;

    for (const rarete of Object.values(raretes).length
      ? Object.keys(raretes).filter((cle) => compte[cle])
      : []) {
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
    Interface.vider(grille);

    const visibles = cartes.filter((c) => filtre === 'toutes' || c.rarete === filtre);
    $('resume-collection').textContent =
      `${visibles.length} carte${visibles.length > 1 ? 's' : ''} affichée${visibles.length > 1 ? 's' : ''} sur ${cartes.length}.`;

    for (const carte of visibles) {
      const article = Interface.creer('article', { 'fiche': true });
      article.append(
        Interface.carte(carte, { libelles, raretes, puissances, compacte: true })
      );

      const description = Interface.creer('div', { 'fiche__texte': true });
      description.append(Interface.creer('p', { 'fiche__description': true }, carte.description));

      if (carte.pouvoir) {
        const pouvoir = Interface.creer('p', { 'fiche__pouvoir': true });
        pouvoir.append(
          Interface.creer('strong', {}, `${carte.pouvoir.nom} : `)
        );
        pouvoir.append(document.createTextNode(carte.pouvoir.texte));
        description.append(pouvoir);
      }

      if (carte.pouvoir_actif) {
        const def = puissances.find((p) => p.cle === carte.pouvoir_actif);
        if (def) {
          const actif = Interface.creer('p', { 'fiche__pouvoir-actif': true });
          actif.append(
            Interface.creer('strong', {}, `${def.icone} ${def.nom} : `)
          );
          actif.append(document.createTextNode(def.description));
          description.append(actif);
        }
      }

      article.append(description);
      grille.append(article);
    }
  }
})();
