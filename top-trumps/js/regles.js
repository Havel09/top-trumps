/**
 * regles.js - Moteur du jeu Top Trump.
 *
 * Ce fichier ne touche jamais au DOM : il ne fait que transformer un état en
 * un autre état. La logique reste ainsi au même endroit que la description
 * affichée sur la page « Règles », et elle est testable toute seule.
 *
 * DÉROULÉ D'UN TOUR - trois étapes, dans cet ordre :
 *
 *   1. attribut   le joueur qui a gagné le tour précédent choisit
 *                 l'attribut qui va être comparé ;
 *   2. selection  chaque joueur choisit à son tour la carte de sa main
 *                 qu'il veut jouer. Celui qui n'a pas choisi l'attribut
 *                 regarde en premier, pour qu'aucun des deux ne puisse
 *                 choisir sa carte en fonction de celle de l'autre ;
 *   3. reveal     on montre les deux cartes, on compare, on distribue.
 *
 * La phase en cours est dans etat.phase, et l'état global a cette forme :
 *
 *   {
 *     mode: 'ia' | 'duel',
 *     tailleMain, egaliteMax,
 *     libelles: { force: 'Force', ... },
 *     joueurs: { joueur:    { nom, main, gagnees, pioche },
 *                adversaire:{ nom, main, gagnees, pioche } },
 *     tour, totalTours,
 *     chooser: 'joueur' | 'adversaire',   qui choisit l'attribut
 *     aQuiLeTour: 'joueur' | 'adversaire', qui choisit sa carte
 *     carteJouee: { joueur, adversaire },  cartesposingnées ou null
 *     attributChoisi, egalites, pot, detruites,
 *     score: { joueur, adversaire },
 *     phase: 'attribut' | 'selection' | 'reveal' | 'fin',
 *     dernierTour, gagnant, journal
 *   }
 */

const Regles = (() => {
  const COTES = ['joueur', 'adversaire'];
  const AUTRE = { joueur: 'adversaire', adversaire: 'joueur' };

  // --- Lecture d'une carte -----------------------------------------------

  /** Valeur d'un attribut, bonus du pouvoir inclus. */
  function valeur(carte, cle) {
    if (!carte) return 0;
    const base = carte.attributs[cle] ?? 0;
    const bonus = carte.pouvoir && carte.pouvoir.attribut === cle ? carte.pouvoir.bonus : 0;
    return base + bonus;
  }

  /** Valeur brute, sans le bonus du pouvoir. */
  function valeurBrute(carte, cle) {
    return carte ? carte.attributs[cle] ?? 0 : 0;
  }

  /** Le pouvoir de cette carte s'applique-t-il à cet attribut ? */
  function estBonus(carte, cle) {
    return Boolean(carte && carte.pouvoir && carte.pouvoir.attribut === cle);
  }

  /**
   * Cartes encore en jeu : ce qu'il reste en main et dans le paquet.
   *
   * C'est ce nombre qui décide de la fin de partie. Il n'existe pas de
   * troisième pile : les cartes gagnées rejoignent le paquet du vainqueur,
   * donc tout ce que possède un joueur est encore jouable. Sans cela, les
   * deux camps tomberoient à court de cartes au même tour exact, et la
   * partie ne pourrait pas désigner de vainqueur.
   */
  function restant(joueur) {
    return joueur.main.length + joueur.pioche.length;
  }

  /** Mélange en place. Le générateur est injectable pour les tests. */
  function melanger(tableau, alea = Math.random) {
    for (let i = tableau.length - 1; i > 0; i--) {
      const j = Math.floor(alea() * (i + 1));
      [tableau[i], tableau[j]] = [tableau[j], tableau[i]];
    }
    return tableau;
  }

  // --- Journal ------------------------------------------------------------

  function journaliser(etat, texte) {
    etat.journal.push({ texte, tour: etat.totalTours });
    if (etat.journal.length > 60) etat.journal.shift();
    return texte;
  }

  /**
   * Le paquet face caché d'un côté, dans l'ordre où il sera pioché.
   *
   * Le contenu transite par le navigateur - il faut bien pouvoir piocher -
   * mais l'interface ne le rend jamais : la main adverse reste invisible.
   */
  function paquetDe(distribution, cote) {
    const brut = distribution?.joueurs?.[cote]?.pioche;
    return Array.isArray(brut) ? brut.slice() : [];
  }

  function libelle(etat, cle) {
    if (etat.libelles && etat.libelles[cle]) return etat.libelles[cle];
    return cle.charAt(0).toUpperCase() + cle.slice(1);
  }

  /**
   * Les attributs comparables, déduits des libellés du serveur et, à défaut,
   * des cartes réellement distribuées. Sans cette liste, une clé arbitraire
   * pourrait être acceptée par erreur et affichée « undefined ».
   */
  function attributsConnus(libelles, distribution) {
    const cles = Object.keys(libelles || {});
    if (cles.length > 0) return cles;

    const trouvees = new Set();
    for (const cote of COTES) {
      const paquet = distribution?.joueurs?.[cote];
      if (!paquet) continue;
      for (const carte of paquet.main || []) {
        for (const cle of Object.keys(carte.attributs || {})) trouvees.add(cle);
      }
    }
    return [...trouvees];
  }

  // --- Création et pioche -------------------------------------------------

  /**
   * Construit l'état d'une partie à partir d'une distribution du serveur.
   *
   * @param {object} distribution réponse de Api.nouvellePartie()
   * @param {object} options { mode, nomJoueur, nomAdversaire,
   *                           egaliteMax, libelles, premierCote }
   */
  function creerPartie(distribution, options = {}) {
    const mode = options.mode || 'ia';
    const nomAdversaire =
      options.nomAdversaire || (mode === 'duel' ? 'Joueur 2' : 'Ordinateur');

    const etat = {
      mode,
      libelles: options.libelles || {},
      // La liste des attributs que l'on a le droit de comparer. Elle est
      // déduite des libellés fournis par le serveur ; à défaut, on accepte
      // les attributs présents sur les cartes distribuées.
      attributs: attributsConnus(options.libelles, distribution),
      tailleMain: distribution.main_initiale || 4,
      egaliteMax: options.egaliteMax ?? 3,
      toursMax: options.toursMax ?? 60,
      // Un événement aléatoire s'abat sur la table tous les `evenementTous`
      // tours, pour un seul tour. 0 désactive les événements.
      evenementTous: options.evenementTous ?? 0,
      evenements: Array.isArray(options.evenements) ? options.evenements : [],
      evenementsRestants: [],
      evenement: null,
      // Pouvoir actif déclaré par chaque camp en posant sa carte, ou null.
      declare: { joueur: null, adversaire: null },
      // Pouvoirs déjà dépensés dans la partie : { cote, id, cle }.
      pouvoirsUtilises: [],
      // Générateur de hasard des événements, injectable pour les tests.
      tirAlea: options.alea || Math.random,

      joueurs: {
        joueur: {
          nom: options.nomJoueur || 'Joueur',
          main: distribution.joueurs.joueur.main.slice(),
          // Le paquet face caché : il contient le reste de la carte du
          // joueur, puis les cartes qu'il gagne au fil de la partie.
          // L'interface n'en montre jamais le contenu.
          pioche: paquetDe(distribution, 'joueur'),
          // Compteur purement indicatif : combien de cartes ce joueur a
          // emportées depuis le début de la partie.
          gagnees: 0,
        },
        adversaire: {
          nom: nomAdversaire,
          main: distribution.joueurs.adversaire.main.slice(),
          pioche: paquetDe(distribution, 'adversaire'),
          gagnees: 0,
        },
      },

      tour: 1,
      totalTours: 0,
      // Au premier tour, le choix de l'attribut est tiré au sort.
      chooser: options.premierCote || (Math.random() < 0.5 ? 'joueur' : 'adversaire'),
      aQuiLeTour: null,
      carteJouee: { joueur: null, adversaire: null },
      attributChoisi: null,
      egalites: 0,
      pot: [],
      // Cartes définitivement retirées de la partie par la règle anti-boucle.
      // Ce compteur n'est pas décoratif : il permet de vérifier que les
      // seules cartes qui quittent le jeu sont celles de la règle, et non
      // une perte accidentelle (voir tests/simuler.js, invariant I1).
      detruites: 0,
      score: { joueur: 0, adversaire: 0 },
      phase: 'attribut',
      dernierTour: null,
      gagnant: null,
      journal: [],
      debut: Date.now(),
    };

    journaliser(
      etat,
      `Tour 1 : ${etat.joueurs[etat.chooser].nom} choisit l'attribut à comparer.`
    );
    preparerEvenementTour(etat);
    return etat;
  }

  /**
   * Pioche jusqu'à remplir la main. Renvoie les cartes piochées.
   *
   * Les cartes tirées vont bien dans la main : sans cela la boucle
   * continuerait de vider le paquet sans jamais reformer la main, et chaque
   * partie se terminerait au bout de quatre tours.
   */
  function piocher(etat, cote) {
    const joueur = etat.joueurs[cote];
    const piochees = [];
    while (joueur.main.length < etat.tailleMain && joueur.pioche.length > 0) {
      const carte = joueur.pioche.shift();
      // Une sauvegarde ancienne peut contenir des emplacements vides : on
      // les ignore au lieu de polluer la main.
      if (!carte) continue;
      joueur.main.push(carte);
      piochees.push(carte);
    }
    return piochees;
  }

  // --- Événements ---------------------------------------------------------

  /**
   * Tire le prochain événement : on pioche dans le paquet mélangé, et on le
   * reconstruit (remélangé) une fois épuisé. Renvoie null s'il n'y en a pas.
   */
  function tirerEvenement(etat) {
    if (!Array.isArray(etat.evenements) || etat.evenements.length === 0) return null;
    if (!Array.isArray(etat.evenementsRestants) || etat.evenementsRestants.length === 0) {
      etat.evenementsRestants = melanger(etat.evenements.slice(), etat.tirAlea);
    }
    return etat.evenementsRestants.pop() || null;
  }

  /**
   * Prépare l'événement du tour en cours : tiré tous les `evenementTous`
   * tours, il reste actif pour tout le tour et s'efface au suivant.
   */
  function preparerEvenementTour(etat) {
    if (!etat.evenementTous || etat.evenementTous <= 0) {
      etat.evenement = null;
      return;
    }
    if ((etat.tour - 1) % etat.evenementTous !== 0) {
      etat.evenement = null;
      return;
    }
    const evenement = tirerEvenement(etat);
    etat.evenement = evenement;
    if (evenement) {
      journaliser(
        etat,
        `Événement : ${evenement.icone || ''} ${evenement.nom} — ${evenement.description || ''}`
      );
    }
  }

  // --- Étape 1 : l'attribut -----------------------------------------------

  /** L'attribut a-t-il déjà été choisi pour ce tour ? */
  function peutChoisirAttribut(etat, cote) {
    return etat.phase === 'attribut' && etat.chooser === cote;
  }

  /**
   * Enregistre l'attribut choisi et passe à la sélection des cartes.
   * Celui qui n'a pas choisi l'attribut regarde en premier.
   */
  function choisirAttribut(etat, cote, cle) {
    if (!peutChoisirAttribut(etat, cote)) {
      throw new Error(`Ce n'est pas à ${etat.joueurs[cote].nom} de choisir l'attribut.`);
    }
    if (!etat.attributs.includes(cle)) {
      throw new Error(`Attribut inconnu : « ${cle} ».`);
    }
    if (etat.joueurs[cote].main.length === 0) {
      // Ne devrait jamais arriver : verifierFin() clôt la partie dès qu'un
      // côté n'a plus une seule carte à jouer. Si ce garde se déclenche,
      // c'est que l'état a été altéré en cours de route.
      throw new Error(`${etat.joueurs[cote].nom} n'a plus aucune carte à jouer.`);
    }

    // La carte servant de témoin au journal : celle du joueur qui choisit.
    const carte = etat.joueurs[cote].main[0];
    etat.attributChoisi = cle;
    etat.aQuiLeTour = AUTRE[cote];
    etat.phase = 'selection';

    journaliser(
      etat,
      `${etat.joueurs[cote].nom} choisit ${libelle(etat, cle)} ` +
      `(${valeur(carte, cle)} sur sa carte).`
    );
    return etat;
  }

  // --- Étape 2 : la carte --------------------------------------------------

  /** Ce côté a-t-il encore à choisir sa carte ? */
  function doitChoisirCarte(etat, cote) {
    return etat.phase === 'selection' && etat.aQuiLeTour === cote;
  }

  /**
   * Pouvoir actif encore disponible sur une carte pour ce côté, ou null.
   * Un pouvoir ne se déclenche qu'une fois par carte et par partie.
   */
  function pouvoirDisponible(etat, cote, carte) {
    if (!carte || !carte.pouvoir_actif) return null;
    const deja = etat.pouvoirsUtilises.some(
      (p) => p.cote === cote && String(p.id) === String(carte.id)
    );
    return deja ? null : carte.pouvoir_actif;
  }

  /**
   * Enregistre la carte jouée par un côté.
   *
   * @param {string} pouvoirCle pouvoir actif déclenché avec cette carte
   *   (une fois par partie), ou null pour jouer sans pouvoir.
   * Quand les deux cartes sont posées, le tour est résolu d'un coup et la
   * partie passe en phase « reveal ».
   */
  function choisirCarte(etat, cote, carteId, pouvoirCle) {
    if (!doitChoisirCarte(etat, cote)) {
      throw new Error(`Ce n'est pas au tour de ${etat.joueurs[cote].nom} de jouer une carte.`);
    }

    const main = etat.joueurs[cote].main;
    // La comparaison passe par String() : un identifiant venu du DOM peut
    // arriver en texte alors que celui de la carte est un nombre.
    const index = main.findIndex((c) => String(c.id) === String(carteId));
    if (index === -1) {
      throw new Error("Cette carte n'est pas dans votre main.");
    }

    // On range la carte entière, pas son identifiant : c'est elle qu'il
    // faut pouvoir lire et retourner au moment de la comparaison.
    const carte = main[index];

    if (pouvoirCle) {
      if (!carte.pouvoir_actif || carte.pouvoir_actif !== pouvoirCle) {
        throw new Error(`${carte.nom} ne peut pas déclencher ce pouvoir.`);
      }
      const deja = etat.pouvoirsUtilises.some(
        (p) => p.cote === cote && String(p.id) === String(carte.id)
      );
      if (deja) {
        throw new Error(`${carte.nom} a déjà utilisé son pouvoir.`);
      }
      etat.pouvoirsUtilises.push({ cote, id: carte.id, cle: pouvoirCle });
      etat.declare[cote] = pouvoirCle;
      journaliser(
        etat,
        `${etat.joueurs[cote].nom} déclenche un pouvoir avec ${carte.nom} !`
      );
    }

    main.splice(index, 1);
    etat.carteJouee[cote] = carte;

    // L'autre côté a-t-il déjà posé sa carte ? Si oui le tour se résout.
    if (etat.carteJouee[AUTRE[cote]]) {
      resoudreTour(etat);
    } else {
      etat.aQuiLeTour = AUTRE[cote];
    }
    return etat;
  }

  // --- Étape 3 : la résolution --------------------------------------------

  /** Points gagnés par un tour remporté. */
  function pointsDuTour(valeurComparee, carteGagnante) {
    return 10 + Math.round(valeurComparee / 10) + (carteGagnante?.pouvoir?.bonus || 0);
  }

  /** Range les cartes en jeu au bas du paquet du vainqueur. */
  function attribuerPaquet(etat, cote, cartes) {
    const joueur = etat.joueurs[cote];
    for (const carte of cartes) {
      joueur.pioche.push(carte);
      joueur.gagnees++;
    }
  }

  /** Clôture : désigne le vainqueur et met fin à la partie. */
  function verifierFin(etat) {
    const resteJoueur = restant(etat.joueurs.joueur);
    const resteAdversaire = restant(etat.joueurs.adversaire);
    if (resteJoueur > 0 && resteAdversaire > 0) return null;

    // Les cartes encore en attente dans le pot reviennent au survivant.
    if (etat.pot.length > 0) {
      attribuerPaquet(etat, resteJoueur > 0 ? 'joueur' : 'adversaire', etat.pot);
      etat.pot = [];
    }

    etat.gagnant = resteJoueur > 0 ? 'joueur' : 'adversaire';
    etat.phase = 'fin';
    journaliser(
      etat,
      `Partie terminée en ${etat.totalTours} tour(s) : ${etat.joueurs[etat.gagnant].nom} gagne !`
    );
    return etat.gagnant;
  }

  /**
   * Filet de sécurité : au bout de `toursMax` tours, la partie s'arrête et
   * le meilleur score l'emporte.
   *
   * Les cartes gagnées remettant le jeu en circulation, on ne peut pas
   * garantir qu'un camp finira par manquer de cartes : sans cette limite,
   * une alternance de victoires ferait durer la partie indéfiniment.
   * L'arbitre est donc appelé, et il n'a lieu en pratique que très rarement.
   */
  function verifierPoussier(etat) {
    if (etat.phase === 'fin' || etat.totalTours < etat.toursMax) return null;

    let cote;
    if (etat.score.joueur !== etat.score.adversaire) {
      cote = etat.score.joueur > etat.score.adversaire ? 'joueur' : 'adversaire';
    } else if (restant(etat.joueurs.joueur) !== restant(etat.joueurs.adversaire)) {
      // Points ex æquo : celui qui possède le plus de cartes l'emporte.
      cote = restant(etat.joueurs.joueur) > restant(etat.joueurs.adversaire) ? 'joueur' : 'adversaire';
    } else {
      // Dernier recours : celui qui avait la main.
      cote = etat.chooser;
    }

    if (etat.pot.length > 0) {
      attribuerPaquet(etat, cote, etat.pot);
      etat.pot = [];
    }

    etat.gagnant = cote;
    etat.phase = 'fin';
    etat.arbitre = true;
    journaliser(
      etat,
      `Limite de ${etat.toursMax} tours atteinte : l'arbitre déclare ` +
        `${etat.joueurs[cote].nom} vainqueur (${etat.score[cote]} points).`
    );
    return cote;
  }

  /**
   * Valeur effectivement comparée : la valeur de la carte, doublée par le
   * pouvoir « Coup décisif » et/ou par l'événement « Vent de chance ».
   */
  function valeurEffective(etat, cote, carte, cle) {
    let v = valeur(carte, cle);
    if (etat.declare[cote] === 'double') v *= 2;
    if (etat.evenement && etat.evenement.cle === 'chance' && etat.chooser === cote) {
      v *= 2;
    }
    return v;
  }

  /**
   * Sens de la comparaison de ce tour.
   *
   * Normalement, la valeur la plus haute l'emporte. Le pouvoir
   * « Contre-offensive » et l'événement « Sort retourné » inversent chacun
   * ce sens une fois : deux inversions s'annulent, comme deux négations.
   * Renvoie true quand c'est la valeur la plus faible qui doit gagner.
   */
  function sensInverse(etat) {
    let inversions = 0;
    if (etat.evenement && etat.evenement.cle === 'inversion') inversions++;
    for (const cote of COTES) {
      if (etat.declare[cote] === 'contre') inversions++;
    }
    return inversions % 2 === 1;
  }

  /** Compare les deux cartes et met à jour l'état. */
  function resoudreTour(etat) {
    const cle = etat.attributChoisi;
    const carteJ = etat.carteJouee.joueur;
    const carteA = etat.carteJouee.adversaire;

    const vJ = valeurEffective(etat, 'joueur', carteJ, cle);
    const vA = valeurEffective(etat, 'adversaire', carteA, cle);

    let resultat;
    if (sensInverse(etat)) {
      // « Sort retourné » ou « Contre-offensive » : la plus faible gagne.
      if (vJ !== vA) resultat = vJ < vA ? 'joueur' : 'adversaire';
      else resultat = 'egalite';
    } else if (vJ > vA) {
      resultat = 'joueur';
    } else if (vA > vJ) {
      resultat = 'adversaire';
    } else {
      resultat = 'egalite';
    }

    // Pouvoirs déclarés au moment de poser la carte.
    if (resultat !== 'egalite') {
      const perdant = AUTRE[resultat];
      // « Renversement » : une défaite devient une victoire.
      if (etat.declare[perdant] === 'retournement') resultat = perdant;
    } else {
      const reclamantes = COTES.filter((cote) => etat.declare[cote] === 'egalite');
      // « Ruse du faible » : une égalité devient une victoire (un seul
      // reclamant, sinon on ne peut pas trancher).
      if (reclamantes.length === 1) resultat = reclamantes[0];
    }

    const pouvoirsDeTour = COTES
      .filter((cote) => etat.declare[cote])
      .map((cote) => ({ cote, cle: etat.declare[cote] }));

    // Cartes en jeu : les deux du tour, plus le pot éventuel. Le pot n'est
    // vidé que par les branches qui le consomment (victoire ou série
    // d'égalités) : l'événement « Oubliettes » le laisse intact.
    const enJeu = [carteJ, carteA, ...etat.pot];

    let gain = null;
    // Cartes réellement retirées de la partie par la règle anti-boucle.
    // Vides la plupart du temps ; l'interface s'en sert pour annoncer au
    // joueur que ses cartes ont disparu, et le banc d'essai pour vérifier
    // qu'aucune autre carte ne s'évapore.
    let cartesDetruites = [];
    if (resultat === 'egalite') {
      if (etat.evenement && etat.evenement.cle === 'oubliette') {
        // « Oubliettes » : les deux cartes du tour sont avalées, le pot
        // reste intact et la série d'égalités n'avance pas.
        etat.detruites = (etat.detruites || 0) + 2;
        cartesDetruites = [carteJ, carteA];
        journaliser(
          etat,
          `Égalité avalée par les oubliettes (${vJ} – ${vA}) : ` +
          `les deux cartes sont détruites, le pot reste intact.`
        );
      } else {
        etat.egalites++;
        etat.pot = enJeu;
        journaliser(
          etat,
          `Égalité sur ${libelle(etat, cle)} (${vJ} – ${vA}) : ` +
          `${enJeu.length} cartes partent en pot.`
        );

        if (etat.egalites >= etat.egaliteMax) {
          // Règle anti-boucle : sans elle, une série d'égalités pourrait
          // faire durer la partie indéfiniment. Ces cartes-là quittent
          // vraiment la partie ; le compteur permet de le vérifier.
          journaliser(
            etat,
            `${etat.egaliteMax} égalités d'affilée : les ${enJeu.length} cartes ` +
            `du pot sont détruites.`
          );
          etat.detruites = (etat.detruites || 0) + enJeu.length;
          cartesDetruites = enJeu;
          etat.pot = [];
          etat.egalites = 0;
        }
        // En cas d'égalité, personne ne change : celui qui avait choisi
        // l'attribut le choisit aussi pour le tour suivant.
        journaliser(
          etat,
          `${etat.joueurs[etat.chooser].nom} garde la main pour le tour suivant.`
        );
      }
    } else {
      const coteGagnant = resultat;
      const cotePerdant = AUTRE[coteGagnant];
      // « Égide » : le perdant garde sa carte, qui revient dans sa main au
      // lieu de rejoindre le paquet du vainqueur. Le tour et les points
      // restent au vainqueur ; seule la carte est sauvée.
      let butin = enJeu;
      if (etat.declare[cotePerdant] === 'egide') {
        const sauvee = cotePerdant === 'joueur' ? carteJ : carteA;
        butin = enJeu.filter((c) => c !== sauvee);
        etat.joueurs[cotePerdant].main.unshift(sauvee);
        journaliser(
          etat,
          `${etat.joueurs[cotePerdant].nom} abrite sa carte (Égide) : ` +
          `${sauvee.nom} revient dans sa main.`
        );
      }
      // Le vainqueur prend les cartes en jeu et les glisse au bas de son
      // propre paquet, face cachée. Une carte perdue n'est donc jamais
      // éliminée : elle peut revenir en jeu dès qu'il pioche.
      attribuerPaquet(etat, coteGagnant, butin);
      etat.pot = [];

      // « Grand larcin » : le vainqueur vole la première carte du paquet
      // adverse et la glisse tout en haut du sien pour la piocher bientôt.
      if (etat.declare[coteGagnant] === 'vol') {
        const volee = etat.joueurs[AUTRE[coteGagnant]].pioche.shift();
        if (volee) {
          etat.joueurs[coteGagnant].pioche.unshift(volee);
          journaliser(
            etat,
            `${etat.joueurs[coteGagnant].nom} vole ${volee.nom} ` +
            `à ${etat.joueurs[AUTRE[coteGagnant]].nom} !`
          );
        } else {
          journaliser(etat, 'Le paquet adverse est vide : rien à voler.');
        }
      }

      const carteGagnante = coteGagnant === 'joueur' ? carteJ : carteA;
      let points = pointsDuTour(Math.max(vJ, vA), carteGagnante);
      if (etat.evenement && etat.evenement.cle === 'fortune') {
        // « Pacte de victoire » : le vainqueur empoche le double.
        points *= 2;
      }
      etat.score[coteGagnant] += points;
      etat.egalites = 0;
      gain = points;

      const haut = coteGagnant === 'joueur' ? vJ : vA;
      const bas = coteGagnant === 'joueur' ? vA : vJ;
      journaliser(
        etat,
        `${etat.joueurs[coteGagnant].nom} gagne le tour sur ${libelle(etat, cle)} ` +
        `(${haut} contre ${bas}) - +${points} points.`
      );
      // Le gagnant choisit l'attribut du tour suivant.
      etat.chooser = coteGagnant;
    }

    etat.totalTours++;
    piocher(etat, 'joueur');
    piocher(etat, 'adversaire');

    etat.dernierTour = {
      attribut: cle,
      libelle: libelle(etat, cle),
      carteJoueur: carteJ,
      carteAdversaire: carteA,
      valeurJoueur: vJ,
      valeurAdversaire: vA,
      resultat,
      cartesEnJeu: enJeu.length,
      cartesDetruites,
      points: gain,
      pouvoirs: pouvoirsDeTour,
      evenement: etat.evenement ? etat.evenement.cle : null,
    };

    verifierFin(etat);
    if (etat.phase !== 'fin') {
      verifierPoussier(etat);
    }

    if (etat.phase !== 'fin') {
      etat.phase = 'reveal';
      etat.tour++;
    }
    return etat.dernierTour;
  }

  /** Appelé après l'animation de révélation : enchaîne sur le tour suivant. */
  function tourSuivant(etat) {
    if (etat.phase === 'fin') return etat;
    etat.carteJouee = { joueur: null, adversaire: null };
    etat.attributChoisi = null;
    etat.aQuiLeTour = null;
    etat.dernierTour = null;
    etat.mainSauvee = null;
    etat.declare = { joueur: null, adversaire: null };
    etat.phase = 'attribut';
    preparerEvenementTour(etat);
    return etat;
  }

  // --- Fin de partie ------------------------------------------------------

  /** Résumé d'une partie terminée, envoyé au serveur pour le classement. */
  function resume(etat) {
    return {
      joueur: etat.joueurs.joueur.nom,
      adversaire: etat.joueurs.adversaire.nom,
      mode: etat.mode,
      tours: etat.totalTours,
      victoire: etat.gagnant === 'joueur',
      // Cartes encore jouables : c'est cette valeur que le barème du
      // serveur récompense, pas le nombre de cartes gagnées.
      cartesRestantes: restant(etat.joueurs.joueur),
      // Combien de cartes la règle anti-boucle a sorties de la partie.
      detruites: etat.detruites || 0,
      duree: Math.round((Date.now() - etat.debut) / 1000),
      points: etat.score.joueur,
    };
  }

  // --- Sauvegarde ---------------------------------------------------------

  /** Instantané sérialisable de l'état. */
  function serialiser(etat) {
    return {
      mode: etat.mode,
      libelles: etat.libelles,
      attributs: etat.attributs,
      tailleMain: etat.tailleMain,
      egaliteMax: etat.egaliteMax,
      toursMax: etat.toursMax,
      joueurs: {
        joueur: {
          nom: etat.joueurs.joueur.nom,
          main: etat.joueurs.joueur.main,
          gagnees: etat.joueurs.joueur.gagnees,
          // Le contenu du paquet est sauvegardé : sans lui, la partie
          // reprise ne pourrait plus piocher.
          pioche: etat.joueurs.joueur.pioche,
        },
        adversaire: {
          nom: etat.joueurs.adversaire.nom,
          main: etat.joueurs.adversaire.main,
          gagnees: etat.joueurs.adversaire.gagnees,
          pioche: etat.joueurs.adversaire.pioche,
        },
      },
      tour: etat.tour,
      totalTours: etat.totalTours,
      chooser: etat.chooser,
      carteJouee: etat.carteJouee,
      attributChoisi: etat.attributChoisi,
      egalites: etat.egalites,
      pot: etat.pot,
      detruites: etat.detruites || 0,
      score: etat.score,
      phase: etat.phase,
      dernierTour: etat.dernierTour,
      gagnant: etat.gagnant,
      journal: etat.journal,
      declare: etat.declare || { joueur: null, adversaire: null },
      pouvoirsUtilises: etat.pouvoirsUtilises || [],
      evenement: etat.evenement || null,
      evenementsRestants: etat.evenementsRestants || [],
      evenementTous: etat.evenementTous || 0,
    };
  }

  /** Reconstruit un état depuis une sauvegarde. */
  function deserialiser(brut, options = {}) {
    const donnees = typeof brut === 'string' ? JSON.parse(brut) : brut;
    if (!donnees || !donnees.joueurs) {
      throw new Error('Sauvegarde illisible.');
    }

    const etat = { ...donnees, debut: Date.now() };
    for (const cote of COTES) {
      const brut2 = donnees.joueurs[cote];
      etat.joueurs[cote] = {
        nom: brut2.nom,
        main: Array.isArray(brut2.main) ? brut2.main : [],
        // Une ancienne sauvegarde portait un tableau de cartes gagnées :
        // on le réintègre au paquet, où il doit vivre désormais.
        pioche: Array.isArray(brut2.pioche)
          ? brut2.pioche.slice()
          : (Array.isArray(brut2.gagnees) ? brut2.gagnees.slice() : []),
        gagnees: Number.isInteger(brut2.gagnees)
          ? brut2.gagnees
          : Array.isArray(brut2.gagnees) ? brut2.gagnees.length : 0,
      };
    }

    // Une sauvegarde peut dater d'une version antérieure : on rebouplit ce
    // qui manquerait plutôt que de laisser un champ à undefined.
    if (!Array.isArray(etat.attributs) || etat.attributs.length === 0) {
      etat.attributs = attributsConnus(etat.libelles, { joueurs: etat.joueurs });
    }
    etat.tailleMain = etat.tailleMain || 4;
    etat.egaliteMax = etat.egaliteMax ?? 3;
    etat.toursMax = etat.toursMax ?? 60;
    etat.detruites = Number.isInteger(etat.detruites) ? etat.detruites : 0;
    // Pouvoirs et événements : les vieilles sauvegardes n'en ont pas.
    etat.declare = { joueur: null, adversaire: null };
    etat.pouvoirsUtilises = Array.isArray(donnees.pouvoirsUtilises)
      ? donnees.pouvoirsUtilises
      : [];
    etat.evenementTous = Number.isInteger(donnees.evenementTous)
      ? donnees.evenementTous
      : (options.evenementTous ?? 0);
    etat.evenements = Array.isArray(options.evenements)
      ? options.evenements
      : (Array.isArray(donnees.evenements) ? donnees.evenements : []);
    etat.evenementsRestants = Array.isArray(donnees.evenementsRestants)
      ? donnees.evenementsRestants
      : [];
    etat.evenement = donnees.evenement || null;
    etat.tirAlea = options.alea || Math.random;

    // On repart proprement au début du tour sauvegardé.
    etat.carteJouee = { joueur: null, adversaire: null };
    etat.dernierTour = null;
    etat.aQuiLeTour = null;
    if (etat.phase !== 'fin') {
      etat.phase = 'attribut';
      // Filet de sécurité : si la partie sauvée était déjà terminée, elle
      // doit le redevenir immédiatement plutôt que de bloquer sur un choix.
      verifierFin(etat);
    }
    return etat;
  }

  return {
    COTES,
    AUTRE,
    valeur,
    valeurBrute,
    estBonus,
    restant,
    melanger,
    libelle,
    journaliser,
    creerPartie,
    piocher,
    peutChoisirAttribut,
    choisirAttribut,
    doitChoisirCarte,
    pouvoirDisponible,
    choisirCarte,
    valeurEffective,
    resoudreTour,
    tourSuivant,
    verifierFin,
    verifierPoussier,
    resume,
    serialiser,
    deserialiser,
  };
})();
