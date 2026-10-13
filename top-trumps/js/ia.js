/**
 * ia.js - Le cerveau de l'ordinateur.
 *
 * L'IA ne voit jamais la main du joueur. Pour décider, elle ne dispose que
 * de trois choses :
 *   - sa propre main, qu'elle choisit librement ;
 *   - sa mémoire des cartes que le joueur a déjà révélées ;
 *   - la moyenne générale des cartes du jeu, comme valeur de repli.
 *
 * Principe de décision, toujours le même :
 *
 *   marge = (ma valeur sur l'attribut) - (valeur estimée chez l'adversaire)
 *
 * On retient le couple (carte, attribut) qui maximise la marge, puis on lui
 * retranche un « coût de réserve » : jouer sa carte la plus forte alors
 * qu'une autre suffit est une mauvaise idée. Ce coût est nul en mode
 * Novice et maximal en mode Oracle, ce qui est exactement la différence
 * entre « jouer au hasard » et « jouer aux points ».
 *
 * Le tirage au hasard est injectable : creerPensee() accepte un générateur
 * en dernier argument. C'est ce qui permet au banc d'essai tests/simuler.js
 * de rejouer exactement la même partie à partir d'une graine, et donc de
 * retrouver un échec au lieu de le voir s'évaporer.
 */

const Ia = (() => {
  const NIVEAUX = {
    facile: {
      cle: 'facile',
      nom: 'Novice',
      description: 'Joue surtout au hasard et propose son meilleur attribut sans rien prévoir.',
      hasardAttribut: 0.70,
      hasardCarte: 0.60,
      // Nombre de choix plausibles que l'IA peut faire à la place du
      // meilleur : 1 signifie « jamais d'erreur ».
      imprecisions: 0,
      // Confiance du niveau à déclencher un pouvoir au bon moment.
      sagesse: 0.45,
      memorise: false,
      reserve: 0,
      profondeur: 0,
    },
    normal: {
      cle: 'normal',
      nom: 'Tacticien',
      description: 'Estime la main adverse et joue ses points forts.',
      hasardAttribut: 0.20,
      hasardCarte: 0.15,
      imprecisions: 0.12,
      sagesse: 0.80,
      memorise: true,
      reserve: 0.20,
      profondeur: 0,
    },
    difficile: {
      cle: 'difficile',
      nom: 'Oracle',
      description: 'Suit le paquet de près, réserve ses meilleures cartes et anticipe les tours suivants.',
      hasardAttribut: 0.05,
      hasardCarte: 0.03,
      // Un adversaire imbattable n'est pas un bon jeu : même le meilleur
      // joueur se trompe. L'Oracle choisit donc son second choix une fois
      // sur douze, ce qui suffit à laisser une vraie chance au concurrent.
      imprecisions: 0.085,
      sagesse: 0.95,
      memorise: true,
      reserve: 0.60,
      profondeur: 1,
    },
  };

  /**
   * Prépare l'état mental de l'IA pour une partie.
   *
   * @param {Array}    catalogue toutes les cartes du jeu
   * @param {object}   config    réponse de Api.config()
   * @param {string}   niveau    'facile' | 'normal' | 'difficile'
   * @param {Function} [alea]    générateur de hasard ; Math.random par défaut
   */
  function creerPensee(catalogue, config, niveau = 'normal', alea = Math.random) {
    const attributs = (config.jeu && config.jeu.attributs) || [];

    // Moyenne générale de chaque attribut sur l'ensemble du jeu : c'est la
    // valeur que l'IA attribue à une carte qu'elle n'a jamais vue.
    const moyennes = {};
    for (const a of attributs) {
      const somme = catalogue.reduce((s, c) => s + Regles.valeur(c, a.cle), 0);
      moyennes[a.cle] = catalogue.length ? somme / catalogue.length : 50;
    }

    return {
      catalogue,
      config,
      attributs,
      moyennes,
      niveau: NIVEAUX[niveau] || NIVEAUX.normal,
      niveauCle: niveau,
      alea,
      // id -> carte, uniquement en mode qui mémorise : ne contient que
      // les cartes que la règle anti-boucle a sorties de la partie.
      revelees: new Map(),
      historique: [],
    };
  }

  /** Retient les cartes que la règle anti-boucle a sorties de la partie. */
  function memoriser(pensee, carte) {
    if (!carte || !pensee.niveau.memorise) return;
    if (pensee.revelees.has(carte.id)) return;
    // Les cartes détruites ne sont plus à personne : les retirer du
    // décompte évite de les compter comme appartenant à l'adversaire.
    pensee.revelees.set(carte.id, carte);
  }

  /**
   * Valeur estimée chez l'adversaire pour un attribut donné.
   *
   * Le raisonnement est plus simple qu'il n'y paraît : l'IA connaît
   * exactement les cartes qu'elle possède - sa main et son paquet - et elle
   * sait qu'aucune autre ne peut être apparue. Tout le reste du catalogue
   * appartient donc à l'adversaire. Il n'y a rien à deviner : la main
   * adverse se déduit par soustraction.
   *
   * C'est une information que l'IA a légitimement le droit d'utiliser -
   * elle ne regarde jamais la main adverse, seulement la sienne et la liste
   * publique des cartes.
   *
   * Sans mémoire (mode Novice), l'IA se rabat sur la moyenne générale du
   * jeu : c'est exactement ce qui la rend facile à battre.
   *
   * @param {object} pensee
   * @param {string} cle   attribut concerné
   * @param {object} etat  état de la partie
   * @param {string} cote  côté que l'IA joue
   */
  function estimerAdversaire(pensee, cle, etat, cote) {
    const repli = pensee.moyennes[cle] ?? 50;
    if (!pensee.niveau.memorise) return repli;

    const joueur = etat.joueurs[cote];
    const miennes = new Set();
    for (const carte of joueur.main) miennes.add(carte.id);
    for (const carte of joueur.pioche) miennes.add(carte.id);
    // Les cartes du pot sont encore en jeu : elles ne sont à personne.
    for (const carte of etat.pot) miennes.add(carte.id);

    let somme = 0;
    let nombre = 0;
    for (const carte of pensee.catalogue) {
      if (miennes.has(carte.id) || pensee.revelees.has(carte.id)) continue;
      somme += Regles.valeur(carte, cle);
      nombre++;
    }
    // Si la règle anti-boucle a vidé la partie, il ne reste personne à
    // estimer : on retombe sur la moyenne générale.
    return nombre > 0 ? somme / nombre : repli;
  }

  /**
   * Note tous les couples (carte, attribut) possibles et les renvoie classés,
   * du meilleur au moins bon.
   *
   * @param {Array}  main   cartes dans la main de l'IA
   * @param {string|null} cle attribut imposé, ou null pour tous les chercher
   * @param {object} pensee
   * @param {object} etat    état de la partie
   * @param {string} cote    côté que l'IA joue
   * @returns {Array<{carte, cle, valeur, estimation, marge, score}>}
   */
  function candidats(main, cle, pensee, etat, cote) {
    if (main.length === 0) return [];

    const cles = cle ? [cle] : pensee.attributs.map((a) => a.cle);
    const liste = [];

    for (const c of cles) {
      const estimation = estimerAdversaire(pensee, c, etat, cote);
      const valeurs = main.map((carte) => Regles.valeur(carte, c));
      const meilleureValeur = Math.max(...valeurs);

      main.forEach((carte, i) => {
        const valeur = valeurs[i];
        const marge = valeur - estimation;
        let score = marge;

        // Le pouvoir rend le coup un peu plus sûr : petit bonus.
        if (Regles.estBonus(carte, c)) {
          score += 2 * pensee.niveau.reserve;
        }
        // Réserve : jouer sa carte nettement supérieure aux autres de la
        // main « consomme » un potentiel qu'on aurait pu garder.
        score -= Math.max(0, valeur - meilleureValeur) * pensee.niveau.reserve;
        // Profondeur 1 : un gain énorme autorise à jouer plus léger et à
        // conserver l'excellente carte pour le tour suivant.
        if (pensee.niveau.profondeur > 0 && marge > 45) {
          score += 8;
        }
        liste.push({ carte, cle: c, valeur, estimation, marge, score });
      });
    }

    liste.sort((a, b) => b.score - a.score);
    return liste;
  }

  /**
   * Le meilleur choix du classement, ou - de temps en temps - l'un de ses
   * rivaux directs.
   *
   * C'est ce qui empêche l'ordinateur d'être imbattable : un joueur qui
   * fait le bon calcul à chaque tour, et que l'IA reproduit presque
   * exactement, ne disposerait d'aucune marge. Ici, l'IA se trompe
   * réellement une fois sur douze.
   *
   * @param {Array}  classement  candidats triés, du meilleur au moins bon
   * @param {object} pensee
   * @param {number} [profondeur] nombre de choix acceptables (1 = jamais d'erreur)
   * @returns {object} le candidat retenu
   */
  function choisirDans(classement, pensee, profondeur = 1) {
    const nombre = Math.min(profondeur, classement.length);
    if (nombre <= 1) return classement[0];
    return classement[Math.floor(pensee.alea() * nombre)];
  }

  /**
   * Probabilité d'erreur du niveau courant.
   *
   * Le nombre de rivaux acceptables augmente avec l'imprécision : à 0,085,
   * l'IA choisit son second choix dans un cas sur douze environ.
   */
  function profondeurErreur(pensee) {
    const taux = pensee.niveau.imprecisions || 0;
    if (taux <= 0) return 1;
    if (pensee.alea() >= taux) return 1;
    return 2 + Math.floor(pensee.alea() * 2);
  }

  /** Attribut que l'IA propose pour ce tour. */
  function choisirAttribut(etat, pensee, cote) {
    const main = etat.joueurs[cote].main;
    const cles = pensee.attributs.map((a) => a.cle);
    if (main.length === 0 || cles.length === 0) return cles[0] ?? null;

    // Mode novice : majoritairement au hasard.
    if (pensee.alea() < pensee.niveau.hasardAttribut) {
      return cles[Math.floor(pensee.alea() * cles.length)];
    }

    const classement = candidats(main, null, pensee, etat, cote);
    if (classement.length === 0) return cles[0];

    // Le classement porte sur les couples (carte, attribut) : on ne garde
    // qu'un candidat par attribut, sinon on tirerait deux fois le même.
    const vus = new Set();
    const parAttribut = [];
    for (const candidat of classement) {
      if (vus.has(candidat.cle)) continue;
      vus.add(candidat.cle);
      parAttribut.push(candidat);
    }
    return choisirDans(parAttribut, pensee, profondeurErreur(pensee)).cle;
  }

  /** Carte que l'IA pose, l'attribut étant déjà fixé. */
  function choisirCarte(etat, pensee, cote, attribut) {
    const main = etat.joueurs[cote].main;
    if (main.length === 0) return null;

    const cle = attribut || etat.attributChoisi;

    // Mode novice : majoritairement au hasard.
    if (pensee.alea() < pensee.niveau.hasardCarte) {
      return main[Math.floor(pensee.alea() * main.length)].id;
    }

    const classement = candidats(main, cle, pensee, etat, cote);
    if (classement.length === 0) return null;

    // Incapable de gagner sur cet attribut, l'IA pose sa carte la plus
    // faible : elle sacrifie ce qui compte le moins.
    if (pensee.niveau.profondeur > 0 && classement[0].marge < 0) {
      return classement[classement.length - 1].carte.id;
    }
    return choisirDans(classement, pensee, profondeurErreur(pensee)).carte.id;
  }

  /** Consigne à l'IA de retenir ce que le tour qui vient d'être joué lui apprend. */
  function apprendre(pensee, tour) {
    if (!tour) return;
    // Seules les cartes réellement sorties du jeu sont mises de côté : les
    // autres ont été vues, mais elles sont redevenues jouables et ont donc
    // quitté le décompte de la main adverse.
    for (const carte of tour.cartesDetruites || []) {
      memoriser(pensee, carte);
    }
    if (pensee.niveau.profondeur > 0) {
      pensee.historique.push({
        attribut: tour.attribut,
        resultat: tour.resultat,
        marge: tour.valeurJoueur - tour.valeurAdversaire,
      });
      if (pensee.historique.length > 30) pensee.historique.shift();
    }
  }

  /**
   * Pouvoir actif que l'IA déclenche avec la carte qu'elle vient de choisir.
   *
   * L'IA ne déclenche un pouvoir que lorsqu'il change réellement l'issue
   * probable du tour (ou qu'il en profite) ; la « sagesse » du niveau
   * introduit l'hésitation, pour qu'aucun niveau ne soit infaillible.
   *
   * @returns {string|null} clé du pouvoir, ou null pour jouer sans.
   */
  function choisirPouvoir(etat, pensee, cote, carteId, attribut) {
    const main = etat.joueurs[cote].main;
    const carte = main.find((c) => String(c.id) === String(carteId));
    const cle = Regles.pouvoirDisponible(etat, cote, carte);
    if (!cle) return null;
    if (!carte) return null;

    const estime = estimerAdversaire(pensee, attribut, etat, cote);
    const valeur = Regles.valeur(carte, attribut);
    const marge = valeur - estime;

    let opportun = false;
    switch (cle) {
      case 'double':
        // Retourne une perte en victoire en doublant la mise.
        opportun = valeur < estime && valeur * 2 >= estime;
        break;
      case 'retournement':
        // On s'apprête à perdre : autant se retourner.
        opportun = marge < 0;
        break;
      case 'vol':
        // On s'apprête à gagner : on en profite pour voler.
        opportun = marge >= 0;
        break;
      case 'egalite':
        opportun = Math.abs(marge) <= 3;
        break;
      case 'contre':
        // « Contre-offensive » inverse la comparaison : la plus faible
        // l'emporte. Idéal quand la carte se situe sous l'estime adverse.
        opportun = marge < 0;
        break;
      case 'egide':
        // « Égide » sauve la carte d'une défaite : inutile de la gaspiller
        // sur une carte quelconque, mais précieuse sur une carte rare.
        {
          const totale = Object.values(carte.attributs).reduce((s, v) => s + v, 0);
          opportun = marge < 0 && totale >= 330;
        }
        break;
      default:
        opportun = false;
    }
    if (!opportun) return null;

    // Les niveaux ne saisissent pas l'occasion avec la même confiance.
    if (pensee.alea() >= (pensee.niveau.sagesse || 0)) return null;
    return cle;
  }

  return {
    NIVEAUX,
    creerPensee,
    memoriser,
    choisirAttribut,
    choisirCarte,
    choisirPouvoir,
    choisirDans,
    profondeurErreur,
    apprendre,
    estimerAdversaire,
    candidats,
  };
})();
