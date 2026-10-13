/**
 * interface.js - Tout ce qui touche au DOM.
 *
 * Séparation volontaire : regles.js ne fait que calculer, interface.js ne
 * fait qu'afficher. Aucune logique de jeu ici.
 *
 * Deux règles de sécurité appliquées partout : le texte coming d'un fichier
 * de données est inséré via textContent (jamais innerHTML), et les valeurs
 * numériques sont vérifiées avant d'être utilisées dans une classe CSS.
 */

const Interface = (() => {
  /** Crée un élément avec classe, texte et attributs. */
  function creer(balise, classes = {}, texte = null) {
    const el = document.createElement(balise);
    for (const [nom, valeur] of Object.entries(classes)) {
      if (valeur) el.classList.add(nom);
    }
    if (texte !== null && texte !== undefined) {
      el.textContent = texte;
    }
    return el;
  }

  /** Vide un conteneur. */
  function vider(el) {
    while (el && el.firstChild) el.removeChild(el.firstChild);
  }

  // --- Carte --------------------------------------------------------------

  /**
   * Construit l'affichage d'une carte.
   *
   * @param {object} carte
   * @param {object} options
   *   - taille : 'normale' | 'petite' | 'jouee'
   *   - cachee : n'affiche que le dos de la carte
   *   - libelles : { cle: 'Nom lisible' }
   *   - raretes : { cle: 'Nom lisible' }
   *   - survol : true pour animer au survol (mode duel)
   *   - jouable : true si on peut cliquer pour la poser
   *   - onJouer : fonction appelée au clic
   */
  function carte(carte, options = {}) {
    const {
      libelles = {},
      raretes = {},
      cachee = false,
      survol = false,
      jouable = false,
      onJouer = null,
      compacte = false,
      puissances = null,
      cote = null,
      pouvoirsUtilises = [],
      badgePouvoir = true,
    } = options;

    const el = creer('article', {
      carte: true,
      [`carte--${carte.rarete}`]: true,
      'carte--cachee': cachee,
      'carte--survol': survol,
      'carte--jouable': jouable,
      'carte--compacte': compacte,
    });
    el.dataset.id = carte.id;

    if (cachee) {
      const dos = creer('div', { 'carte__dos': true });
      dos.append(creer('span', { 'carte__dos-symbole': true }, '?'));
      // La main de l'adversaire reste anonyme : ni le nom ni la rareté ne
      // sont indiqués sur ses dos de carte, pour ne rien dévoiler à l'autre
      // joueur. Seule la main du joueur garde le nom en rappel.
      if (cote !== 'adversaire') {
        dos.append(creer('span', { 'carte__dos-nom': true }, carte.nom));
      }
      el.append(dos);
      return el;
    }

    // Visuel
    const visuel = creer('div', { 'carte__visuel': true });
    const img = creer('img', { 'carte__image': true });
    img.src = carte.image;
    img.alt = `Illustration de ${carte.nom}`;
    img.loading = 'lazy';
    visuel.append(img);
    el.append(visuel);

    // Titre
    const entete = creer('div', { 'carte__entete': true });
    entete.append(creer('h4', { 'carte__nom': true }, carte.nom));
    if (carte.titre) {
      entete.append(creer('p', { 'carte__titre': true }, carte.titre));
    }
    el.append(entete);

    // Attributs
    const liste = creer('ul', { 'carte__attributs': true });
    for (const [cle, valeur] of Object.entries(carte.attributs)) {
      const bonus = Regles.estBonus(carte, cle) ? carte.pouvoir.bonus : 0;
      const item = creer('li', { 'attribut': true });
      item.dataset.attribut = cle;
      if (bonus) item.classList.add('attribut--pouvoir');

      item.append(creer('span', { 'attribut__nom': true }, libelles[cle] || cle));

      const valeurEl = creer('span', { 'attribut__valeur': true });
      valeurEl.append(document.createTextNode(String(valeur + bonus)));
      if (bonus) {
        valeurEl.append(creer('span', { 'attribut__bonus': true }, ` +${bonus}`));
      }
      item.append(valeurEl);

      // Barre visuelle : purely décorative, aria-hidden.
      const barre = creer('span', { 'attribut__barre': true });
      const remplissage = creer('span', { 'attribut__remplissage': true });
      const pct = Math.max(2, Math.min(100, Math.round(((valeur + bonus) / 100) * 100)));
      remplissage.style.width = `${pct}%`;
      barre.append(remplissage);
      barre.setAttribute('aria-hidden', 'true');
      item.append(barre);

      liste.append(item);
    }
    el.append(liste);

    // Pouvoir
    if (carte.pouvoir) {
      const pouvoir = creer('div', { 'carte__pouvoir': true });
      pouvoir.append(
        creer('span', { 'carte__pouvoir-nom': true }, carte.pouvoir.nom)
      );
      pouvoir.append(
        creer(
          'span',
          { 'carte__pouvoir-effet': true },
          `+${carte.pouvoir.bonus} ${libelles[carte.pouvoir.attribut] || carte.pouvoir.attribut}`
        )
      );
      el.append(pouvoir);
    }

    // Pouvoir actif, déclenchable une fois par partie. Le badge est un
    // simple indicateur : quand un bouton d'activation est posé sur la
    // carte (jeu.js), on s'efface pour ne pas afficher deux fois le même
    // nom l'un sur l'autre.
    if (carte.pouvoir_actif && Array.isArray(puissances) && badgePouvoir) {
      const def = puissances.find((p) => p.cle === carte.pouvoir_actif);
      if (def) {
        const badge = creer(
          'span',
          { 'carte__pouvoir-actif': true },
          `${def.icone} ${def.nom}`
        );
        badge.title = def.description || '';
        const utilise = (pouvoirsUtilises || []).some(
          (p) => p.cote === cote && String(p.id) === String(carte.id)
        );
        if (utilise) badge.classList.add('carte__pouvoir-actif--utilise');
        el.append(badge);
      }
    }

    // Badge de rareté
    if (raretes[carte.rarete]) {
      el.append(creer('span', { 'carte__rarete': true }, raretes[carte.rarete]));
    }

    if (jouable && onJouer) {
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', `Jouer la carte ${carte.nom}`);
      const jouer = () => onJouer(carte);
      el.addEventListener('click', jouer);
      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          jouer();
        }
      });
    }

    return el;
  }

  // --- Comparaison de deux cartes ----------------------------------------

  /**
   * Affiche les deux cartes du tour en cours avec l'attribut comparé mis en
   * avant, et indique le gagnant.
   */
  function comparaison(tour, options) {
    const conteneur = creer('div', { 'comparaison': true });

    const dresser = (laCarte, cote, valeur, etiquette) => {
      const bloc = creer('div', { 'comparaison__bloc': true });
      bloc.append(carte(laCarte, { ...options, cote }));

      const ligne = creer('div', { 'comparaison__valeurs': true });
      ligne.append(creer('span', { 'comparaison__nom': true }, laCarte.nom));

      const gagne = tour.resultat === cote;
      const classe =
        tour.resultat === 'egalite'
          ? 'comparaison__valeur--egalite'
          : gagne
          ? 'comparaison__valeur--gagnant'
          : 'comparaison__valeur--perdant';
      ligne.append(creer('span', { [classe]: true }, String(valeur)));

      // Pouvoir actif déclenché ce tour par ce côté.
      const monPouvoir = (tour.pouvoirs || []).find((p) => p.cote === cote);
      if (monPouvoir) {
        const def = (options.puissances || []).find((p) => p.cle === monPouvoir.cle);
        ligne.append(
          creer(
            'span',
            { 'comparaison__pouvoir': true },
            def ? `${def.icone} ${def.nom}` : monPouvoir.cle
          )
        );
      }

      bloc.append(ligne);
      bloc.append(creer('p', { 'comparaison__etiquette': true }, etiquette));
      return bloc;
    };

    conteneur.append(
      dresser(tour.carteJoueur, 'joueur', tour.valeurJoueur, options.nomJoueur)
    );

    const milieu = creer('div', { 'comparaison__milieu': true });
    milieu.append(creer('span', { 'comparaison__attribut': true }, tour.libelle));
    if (tour.resultat === 'egalite') {
      milieu.append(creer('span', { 'comparaison__vs': true }, 'ÉGALITÉ'));
    } else {
      milieu.append(creer('span', { 'comparaison__vs': true }, 'VS'));
    }
    // Événement aléatoire du tour, s'il y en a un.
    if (tour.evenement) {
      const def = (options.evenements || []).find((e) => e.cle === tour.evenement);
      milieu.append(
        creer(
          'span',
          { 'comparaison__evenement': true },
          def ? `${def.icone} ${def.nom}` : tour.evenement
        )
      );
    }
    if (tour.points) {
      milieu.append(
        creer('span', { 'comparaison__points': true }, `+${tour.points} pts`)
      );
    }
    conteneur.append(milieu);

    conteneur.append(
      dresser(
        tour.carteAdversaire,
        'adversaire',
        tour.valeurAdversaire,
        options.nomAdversaire
      )
    );

    return conteneur;
  }

  // --- Barre de progression d'attributs -----------------------------------

  /**
   * Barre où chaque joueur clique sur l'attribut qu'il veut proposer.
   * Sert au joueur humain ; l'ordinateur n'utilise pas ce composant.
   */
  function barreAttributs(etat, libelles, onChoix) {
    const barre = creer('div', { 'attributs-barre': true });
    const carte = etat.joueurs[etat.chooser].main[0];
    if (!carte) return barre;

    for (const cle of Object.keys(carte.attributs)) {
      const bouton = creer('button', { 'attributs-barre__choix': true });
      bouton.type = 'button';
      bouton.dataset.attribut = cle;
      bouton.append(creer('span', { 'attributs-barre__nom': true }, libelles[cle] || cle));
      bouton.append(creer('span', { 'attributs-barre__valeur': true }, String(Regles.valeur(carte, cle))));
      bouton.addEventListener('click', () => onChoix(cle));
      barre.append(bouton);
    }
    return barre;
  }

  // --- Journal ------------------------------------------------------------

  function journal(entrees) {
    const liste = creer('ul', { 'journal__liste': true });
    for (const entree of entrees.slice(-14).reverse()) {
      const li = creer('li', { 'journal__ligne': true });
      li.append(creer('span', { 'journal__tour': true }, `T${entree.tour}`));
      li.append(document.createTextNode(entree.texte));
      liste.append(li);
    }
    return liste;
  }

  /** Bandeau annonçant l'événement aléatoire du tour en cours. */
  function evenementBandeau(evenement) {
    if (!evenement) return null;
    return creer(
      'p',
      { 'banniere-evenement': true },
      `${evenement.icone || ''} ${evenement.nom} — ${evenement.description || ''}`
    );
  }

  // --- Bandeau de score ---------------------------------------------------

  function bandeau(etat) {
    const barre = creer('div', { 'score-barre': true });

    for (const cote of Regles.COTES) {
      const joueur = etat.joueurs[cote];
      const bloc = creer('div', { 'score-barre__bloc': true, [`score-barre__bloc--${cote}`]: true });
      bloc.append(creer('span', { 'score-barre__nom': true }, joueur.nom));

      const chiffres = creer('div', { 'score-barre__chiffres': true });
      chiffres.append(
        creer('span', { 'score-barre__points': true }, String(etat.score[cote]))
      );
      chiffres.append(
        creer(
          'span',
          { 'score-barre__cartes': true },
          `${Regles.restant(joueur)} à jouer`
        )
      );
      bloc.append(chiffres);

      const detail = creer('div', { 'score-barre__detail': true });
      detail.append(creer('span', {}, `main ${joueur.main.length}`));
      detail.append(creer('span', {}, `paquet ${joueur.pioche.length}`));
      detail.append(creer('span', {}, `gagnées ${joueur.gagnees}`));
      if (etat.pot.length && cote === 'joueur') {
        detail.append(creer('span', { 'score-barre__pot': true }, `pot ${etat.pot.length}`));
      }
      bloc.append(detail);

      if (etat.gagnant === cote) {
        bloc.classList.add('score-barre__bloc--gagnant');
      }
      barre.append(bloc);
    }
    return barre;
  }

  // --- Écran de fin -------------------------------------------------------

  function finDePartie(etat, options) {
    const gagne = etat.gagnant === 'joueur';
    const voile = creer('div', { 'fin': true, 'fin--gagne': gagne, 'fin--perdu': !gagne });

    const boite = creer('div', { 'fin__boite': true });
    boite.append(creer('p', { 'fin__sur-titre': true }, 'Partie terminée'));
    boite.append(
      creer(
        'h2',
        { 'fin__titre': true },
        gagne ? 'Victoire !' : 'Défaite'
      )
    );
    boite.append(
      creer(
        'p',
        { 'fin__detail': true },
        `${etat.joueurs[etat.gagnant].nom} l'emporte en ${etat.totalTours} tour(s).`
      )
    );

    const stats = creer('dl', { 'fin__stats': true });
    const lignes = [
      ['Vos points', String(etat.score.joueur)],
      ['Points adverse', String(etat.score.adversaire)],
      ['Cartes en jeu', String(Regles.restant(etat.joueurs.joueur))],
      ['Cartes gagnées', String(etat.joueurs.joueur.gagnees)],
      ['Tours joués', String(etat.totalTours)],
    ];
    if (options.score !== undefined && options.score !== null) {
      lignes.push(['Score du tournoi', String(options.score)]);
    }
    if (options.rang) {
      lignes.push(['Classement', `${options.rang}`]);
    }
    for (const [cle, valeur] of lignes) {
      stats.append(creer('dt', {}, cle));
      stats.append(creer('dd', {}, valeur));
    }

    // Pièces gagnées : ligne mise en valeur quand la victoire en a rapporté.
    if (options.pieces > 0) {
      stats.append(creer('dt', { 'fin__pieces-titre': true }, 'Pièces gagnées'));
      stats.append(creer('dd', { 'fin__pieces': true }, `+${options.pieces}`));
    }
    boite.append(stats);

    if (options.sauvegardeRestaurable) {
      boite.append(
        creer(
          'p',
          { 'fin__note': true },
          'Cette partie avait été sauvegardée : elle a été remise à zéro.'
        )
      );
    }

    const actions = creer('div', { 'fin__actions': true });
    const rejouer = creer('button', { 'bouton': true, 'bouton--principal': true }, 'Rejouer');
    rejouer.type = 'button';
    rejouer.addEventListener('click', options.onRejouer);
    actions.append(rejouer);

    const accueil = creer('button', { 'bouton': true }, 'Menu');
    accueil.type = 'button';
    accueil.addEventListener('click', () => {
      window.location.href = 'index.html';
    });
    actions.append(accueil);

    boite.append(actions);
    voile.append(boite);
    return voile;
  }

  return { creer, vider, carte, comparaison, barreAttributs, journal, evenementBandeau, bandeau, finDePartie };
})();
