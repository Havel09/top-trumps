/**
 * jeu.js - Contrôleur d'une partie.
 *
 * C'est le chef d'orchestre : il demande les cartes au serveur, applique les
 * règles à chaque action du joueur ou de l'IA, et redessine la table.
 *
 * Le temps qui passe est géré par deux mécanismes distincts :
 *   - `enCours()`   : boucle qui enchaîne les étapes tant que personne
 *                     n'a à cliquer. Elle se met en pause d'elle-même
 *                     quand c'est au joueur humain de jouer ;
 *   - `attendre(ms)` : une simple temporisation, pour que le joueur voie ce
 *                     qui se passe au lieu de voir tout apparaître d'un coup.
 */

(() => {
  const CLE_JOUEUR = 'toptrumps-nom';
  const CLE_OPTIONS = 'toptrumps-options';
  const CLE_JETON = 'toptrumps-jeton';

  // --- État local de la page ---------------------------------------------

  let etat = null;      // état de la partie (cf. regles.js)
  let config = null;    // paramètres venus du serveur
  let catalogue = [];   // toutes les cartes, pour la mémoire de l'IA
  let pensee = null;    // état mental de l'IA
  let options = null;   // mode, niveau, noms des joueurs
  let occupe = false;   // bloque les clics pendant une animation
  let minuteur = null;  // temporisation en cours
  let jeton = null;     // identifiant de sauvegarde, propre au navigateur
  let aRestaure = false;

  let libelles = {};    // { force: 'Force', ... }
  let raretes = {};     // { commun: 'Commune', ... }
  let puissances = [];  // pouvoirs actifs du catalogue (jeu.pouvoirs)
  let evenements = [];  // événements aléatoires du catalogue (jeu.evenements)

  const $ = (id) => document.getElementById(id);

  // --- Démarrage ----------------------------------------------------------

  document.addEventListener('DOMContentLoaded', demarrer);

  async function demarrer() {
    try {
      config = await Api.config();
    } catch (e) {
      echec(e.message);
      return;
    }

    options = lireOptions();
    libelles = {};
    raretes = {};
    for (const a of config.jeu.attributs) libelles[a.cle] = a.nom;
    for (const r of config.jeu.raretes) raretes[r.cle] = r.nom;
    puissances = config.jeu.pouvoirs || [];
    evenements = config.jeu.evenements || [];

    if (!options.nomJoueur) options.nomJoueur = lirePreference(CLE_JOUEUR) || 'Joueur';

    preparerInterface();
    brancherEvenements();
    await verifierSauvegarde();
  }

  function lirePreference(cle) {
    try {
      return localStorage.getItem(cle);
    } catch (e) {
      return null;
    }
  }

  function ecrirePreference(cle, valeur) {
    try {
      localStorage.setItem(cle, valeur);
    } catch (e) {
      /* navigation privée : on continue sans mémoriser */
    }
  }

  function lireOptions() {
    const parDefaut = { mode: 'ia', niveau: 'normal', nomJoueur: '', nomAdversaire: '' };
    const brut = lirePreference(CLE_OPTIONS);
    if (!brut) return parDefaut;
    try {
      return { ...parDefaut, ...JSON.parse(brut) };
    } catch (e) {
      return parDefaut;
    }
  }

  /** Identifiant stable par navigateur, pour retrouver sa sauvegarde. */
  function jetonDeSession() {
    if (jeton) return jeton;
    let valeur = lirePreference(CLE_JETON);
    if (!valeur) {
      valeur = `J${Math.random().toString(36).slice(2, 8)}`;
      ecrirePreference(CLE_JETON, valeur);
    }
    jeton = valeur;
    return jeton;
  }

  function nomAdversaire() {
    return options.mode === 'duel' ? options.nomAdversaire || 'Joueur 2' : Ia.NIVEAUX[options.niveau].nom;
  }

  // --- Interface statique -------------------------------------------------

  function preparerInterface() {
    const titre = $('titre-partie');
    if (titre) {
      titre.textContent =
        options.mode === 'duel'
          ? 'Duel sur la même machine'
          : `Contre l'ordinateur - ${Ia.NIVEAUX[options.niveau].nom}`;
    }

    const qui = $('qui-joue');
    if (qui) qui.textContent = `${options.nomJoueur} contre ${nomAdversaire()}`;

    const aide = $('aide-tour');
    if (aide && options.mode === 'ia') {
      aide.textContent = Ia.NIVEAUX[options.niveau].description;
    }

    const cadreDuel = $('cadre-duel');
    if (cadreDuel) cadreDuel.hidden = options.mode !== 'duel';
  }

  function brancherEvenements() {
    const btnSon = $('btn-son');
    if (btnSon) {
      majBoutonSon();
      btnSon.addEventListener('click', () => {
        Son.basculer();
        majBoutonSon();
      });
    }

    // Le navigateur interdit le son avant la première interaction.
    document.addEventListener('pointerdown', () => Son.reveiller(), { once: true });
  }

  function brancher(id, action) {
    const el = $(id);
    if (el) el.addEventListener('click', action);
  }

  function majBoutonSon() {
    const btn = $('btn-son');
    if (!btn) return;
    const actif = Son.estActif();
    // Deux icônes SVG logées dans le bouton : la classe pilote celle qui
    // est visible, le libellé accompagne l'état.
    btn.classList.toggle('bouton--muet', !actif);
    btn.setAttribute('aria-pressed', String(actif));
    btn.setAttribute('aria-label', actif ? 'Couper le son' : 'Activer le son');
    const libelle = btn.querySelector('.bouton-son__libelle');
    if (libelle) libelle.textContent = actif ? 'Son' : 'Muet';
  }

  // --- Sauvegarde ---------------------------------------------------------

  async function verifierSauvegarde() {
    try {
      const reponse = await Api.restaurer(jetonDeSession());
      if (reponse.trouve && reponse.etat) {
        proposerReprise(reponse);
      } else {
        nouvellePartie();
      }
    } catch (e) {
      // La sauvegarde est un confort : son échec ne doit pas bloquer le jeu.
      nouvellePartie();
    }
  }

  function proposerReprise(reponse) {
    const bloc = $('sauvegarde');
    if (!bloc) {
      nouvellePartie();
      return;
    }
    bloc.hidden = false;
    $('sauvegarde-quand').textContent = new Date(reponse.date).toLocaleString('fr-FR');

    brancher('btn-reprendre', () => {
      bloc.hidden = true;
      reprendre(reponse.etat);
    });
    brancher('btn-ignorer', async () => {
      bloc.hidden = true;
      await Api.oublier(jetonDeSession()).catch(() => {});
      nouvellePartie();
    });
  }

  function reprendre(donnees) {
    try {
      etat = Regles.deserialiser(donnees, {
        evenements,
        evenementTous: (config && config.regles && config.regles.evenement_tous) || 0,
      });
      aRestaure = true;
      // On repart au début du tour sauvegardé : les cartes déjà posées
      // sont remises dans la main de leur joueur.
      message(`Partie reprise au tour ${etat.tour}.`);
      Interface.vider($('zone-fin'));
      dessiner();
      lancerBoucle(400);
    } catch (e) {
      message('Sauvegarde illisible - nouvelle partie.');
      nouvellePartie();
    }
  }

  let minuteurFlash = null;
  async function sauvegarder() {
    if (!etat || etat.phase === 'fin') return;
    try {
      await Api.sauvegarder(jetonDeSession(), Regles.serialiser(etat));
      const indic = $('indicateur-sauvegarde');
      if (!indic) return;
      indic.classList.add('est-visible');
      clearTimeout(minuteurFlash);
      minuteurFlash = setTimeout(() => indic.classList.remove('est-visible'), 1800);
    } catch (e) {
      /* sans conséquence : on continue sans sauvegarde */
    }
  }

  // --- Nouvelle partie ----------------------------------------------------

  async function nouvellePartie() {
    stopperBoucle();
    occupe = true;
    Interface.vider($('zone-fin'));
    message('Distribution des cartes…');

    let distribution;
    try {
      const [reponsePartie, reponseCartes] = await Promise.all([
        Api.nouvellePartie(options.mode, config.regles.main_initiale),
        Api.cartes(),
      ]);
      distribution = reponsePartie;
      catalogue = reponseCartes.cartes;
    } catch (e) {
      echec(e.message);
      return;
    }

    etat = Regles.creerPartie(distribution, {
      mode: options.mode,
      nomJoueur: options.nomJoueur,
      nomAdversaire: nomAdversaire(),
      egaliteMax: config.regles.egalite_max_consecutive,
      toursMax: config.regles.tours_max,
      evenementTous: config.regles.evenement_tous || 0,
      evenements,
      libelles,
    });

    if (options.mode === 'ia') {
      pensee = Ia.creerPensee(catalogue, config, options.niveau);
    }

    aRestaure = false;
    await Api.oublier(jetonDeSession()).catch(() => {});

    message(`Nouvelle partie. Tour 1 : à ${etat.joueurs[etat.chooser].nom} de jouer.`);
    Son.jouer('pioche');
    dessiner();
    occupe = false;
    lancerBoucle(350);
  }

  // --- Boucle de jeu -----------------------------------------------------

  function stopperBoucle() {
    if (minuteur) {
      clearTimeout(minuteur);
      minuteur = null;
    }
  }

  function lancerBoucle(delai) {
    stopperBoucle();
    minuteur = setTimeout(enCours, delai);
  }

  function attendre(ms) {
    return new Promise((resolve) => {
      stopperBoucle();
      minuteur = setTimeout(resolve, ms);
    });
  }

  /** Enchaîne les étapes tant que personne n'a à cliquer. */
  async function enCours() {
    minuteur = null;
    if (!etat) return;

    // Résoudre le tour peut clore la partie sur-le-champ : si le dernier
    // carte jouée est le déclencheur, il n'y a pas eu de phase « reveal »
    // et la boucle se serait arrêtée sans afficher la victoire. On la
    // remet ici sur les rails.
    if (etat.phase === 'fin') {
      await terminer();
      return;
    }

    try {
      switch (etat.phase) {
        case 'attribut':
          await etapeAttribut();
          break;
        case 'selection':
          await etapeSelection();
          break;
        case 'reveal':
          await reveler();
          break;
        default:
          break;
      }
    } catch (e) {
      occupe = false;
      message(`Erreur du jeu : ${e.message}`);
      console.error(e);
    }
  }

  /** Étape 1 : le vainqueur du tour précédent choisit l'attribut. */
  async function etapeAttribut() {
    const cote = etat.chooser;
    const humain = cote === 'joueur' || options.mode === 'duel';

    if (humain) {
      // En duel, le joueur humain tient les deux rôles : il clique.
      message(`${etat.joueurs[cote].nom} choisit l'attribut à comparer.`);
      occupe = false;
      dessiner();
      return;
    }

    message(`${etat.joueurs[cote].nom} réfléchit…`);
    occupe = true;
    dessiner();
    await attendre(700);

    const cle = Ia.choisirAttribut(etat, pensee, cote);
    Regles.choisirAttribut(etat, cote, cle);
    Son.jouer('clic');
    dessiner();
    await attendre(500);
    lancerBoucle(0);
  }

  /** Étape 2 : chacun pose la carte qu'il veut jouer. */
  async function etapeSelection() {
    const cote = etat.aQuiLeTour;
    if (!cote) return;

    const humain = cote === 'joueur' || options.mode === 'duel';

    if (humain) {
      message(
        `${etat.joueurs[cote].nom} choisit sa carte sur ${Regles.libelle(etat, etat.attributChoisi)}.`
      );
      occupe = false;
      dessiner();
      return;
    }

    message(`${etat.joueurs[cote].nom} choisit sa carte…`);
    occupe = true;
    dessiner();
    await attendre(650);

    const id = Ia.choisirCarte(etat, pensee, cote, etat.attributChoisi);
    if (id === null) {
      message(`${etat.joueurs[cote].nom} n'a plus de carte à jouer.`);
      lancerBoucle(0);
      return;
    }
    const pouvoir = Ia.choisirPouvoir(etat, pensee, cote, id, etat.attributChoisi);
    Regles.choisirCarte(etat, cote, id, pouvoir);
    if (pouvoir) Son.jouer('pouvoir');
    Son.jouer('pose');
    dessiner();
    await attendre(400);

    if (etat.phase === 'reveal') await reveler();
    else lancerBoucle(0);
  }

  /** Étape 3 : on montre le résultat, puis on passe au tour suivant. */
  async function reveler() {
    const tour = etat.dernierTour;

    if (tour) {
      if (options.mode === 'ia') Ia.apprendre(pensee, tour);

      if (tour.resultat === 'egalite') Son.jouer('egalite');
      else if (tour.resultat === 'joueur') Son.jouer('gagne');
      else Son.jouer('perdu');

      let texte =
        tour.resultat === 'egalite'
          ? `Égalité sur ${tour.libelle} ! Les cartes partent en pot.`
          : `${etat.joueurs[tour.resultat].nom} remporte le tour (${tour.libelle}).`;
      const noms = (tour.pouvoirs || []).map((p) => {
        const def = puissances.find((x) => x.cle === p.cle);
        return def ? def.nom : p.cle;
      });
      if (noms.length > 0) {
        texte += ` Pouvoir${noms.length > 1 ? 's' : ''} : ${noms.join(', ')}.`;
      }
      message(texte);
      dessiner(tour);
      await attendre(2300);
    }

    Regles.tourSuivant(etat);

    if (etat.phase === 'fin') {
      await terminer();
      return;
    }

    await sauvegarder();
    dessiner();
    lancerBoucle(250);
  }

  async function terminer() {
    let score = null;
    let rang = null;
    let pieces = 0;

    try {
      const reponse = await Api.enregistrerPartie({
        ...Regles.resume(etat),
        jeton: jetonDeSession(),
      });
      score = reponse.score;
      pieces = reponse.piecesGagnees || 0;
      const moi = reponse.classement && reponse.classement.moi;
      if (moi) rang = `${moi.rang}${moi.rang === 1 ? 'er' : 'e'}`;
    } catch (e) {
      // Le classement est secondaire : l'écran de fin s'affiche quand même.
      score = null;
    }

    await Api.oublier(jetonDeSession()).catch(() => {});

    Son.jouer(etat.gagnant === 'joueur' ? 'victoire' : 'defaite');
    message('Partie terminée.');

    Interface.vider($('zone-fin'));
    $('zone-fin').append(
      Interface.finDePartie(etat, {
        score,
        rang,
        pieces,
        sauvegardeRestaurable: aRestaure,
        onRejouer: () => nouvellePartie(),
      })
    );
    dessiner();
  }

  // --- Actions du joueur humain ------------------------------------------

  /**
   * Le joueur clique sur un attribut.
   * En duel il tient les deux rôles, donc c'est bien `etat.chooser` qui
   * décide de quel côté on enregistre le choix.
   */
  async function joueurChoisitAttribut(cle) {
    if (occupe || !etat || etat.phase !== 'attribut') return;
    const cote = options.mode === 'duel' ? etat.chooser : 'joueur';

    occupe = true;
    Son.jouer('clic');
    Regles.choisirAttribut(etat, cote, cle);
    dessiner();
    await attendre(350);
    lancerBoucle(0);
  }

  /** Le joueur clique sur une carte de sa main. */
  async function joueurJoueCarte(cote, id, pouvoirCle) {
    if (occupe || !etat || etat.phase !== 'selection') return;
    if (!Regles.doitChoisirCarte(etat, cote)) return;

    occupe = true;
    if (pouvoirCle) Son.jouer('pouvoir');
    Son.jouer('pose');
    try {
      Regles.choisirCarte(etat, cote, id, pouvoirCle);
    } catch (e) {
      occupe = false;
      message(e.message);
      return;
    }
    dessiner();
    await attendre(420);

    if (etat.phase === 'reveal') await reveler();
    else lancerBoucle(0);
  }

  // --- Rendu --------------------------------------------------------------

  const zoneScore = () => $('score');
  const zoneJournal = () => $('journal');

  function dessiner(tour = null) {
    if (!etat) return;

    Interface.vider(zoneScore());
    zoneScore().append(Interface.bandeau(etat));

    Interface.vider(zoneJournal());
    zoneJournal().append(Interface.journal(etat.journal));

    dessinerMains();
    dessinerCentre(tour);
    majEtiquetteDuel();
  }

  /**
   * Les deux mains.
   *
   * Règle de visibilité, valable pour les deux modes :
   *   - en duel, on ne voit sa main que lorsque c'est son tour de jouer ;
   *   - contre l'ordinateur, on voit toujours la sienne, et celle de
   *     l'ordinateur reste face cachée en permanence.
   */
  function dessinerMains() {
    const peutJouer = (cote) =>
      etat.phase === 'selection' &&
      Regles.doitChoisirCarte(etat, cote) &&
      (options.mode === 'duel' || cote === 'joueur');

    const visible = (cote) =>
      options.mode === 'duel'
        ? etat.phase !== 'fin' && etat.aQuiLeTour === cote
        // Contre l'ordinateur, sa main reste face cachée en permanence :
        // la deviner fait partie du jeu.
        : cote === 'joueur';

    /** Construit une carte de main, avec son bouton de pouvoir si possible. */
    const construire = (laCarte, cote) => {
      const peutActiver =
        peutJouer(cote) &&
        !occupe &&
        Regles.pouvoirDisponible(etat, cote, laCarte);

      const el = Interface.carte(laCarte, {
        libelles,
        raretes,
        puissances,
        cote,
        pouvoirsUtilises: etat.pouvoirsUtilises,
        compacte: true,
        // Le bouton d'activation tient lieu de badge quand le pouvoir est
        // disponible ; le badge ne réapparaît qu'une fois le pouvoir usé.
        badgePouvoir: !peutActiver,
        cachee: !visible(cote),
        survol: peutJouer(cote) && !occupe,
        jouable: peutJouer(cote) && !occupe,
        onJouer: (c) => joueurJoueCarte(cote, c.id),
      });

      if (peutActiver) {
        const def = puissances.find((p) => p.cle === laCarte.pouvoir_actif);
        // Le catalogue garantit que def existe ; sans icône connue, le
        // bouton garde un simple texte, pas d'émoticône de secours.
        const libelle = def ? `${def.icone} ${def.nom}` : 'Pouvoir';
        const bouton = Interface.creer(
          'button',
          { 'carte__pouvoir-bouton': true },
          libelle
        );
        bouton.type = 'button';
        bouton.title = (def && def.description) || 'Déclencher le pouvoir de la carte';
        bouton.setAttribute('aria-label', `Déclencher le pouvoir de ${laCarte.nom}`);
        bouton.addEventListener('click', () => {
          joueurJoueCarte(cote, laCarte.id, laCarte.pouvoir_actif);
        });
        el.append(bouton);
      }
      return el;
    };

    // Main du joueur 1
    const zone1 = $('main-joueur');
    majTitreMain($('titre-main-joueur'), etat.joueurs.joueur, visible('joueur'));
    Interface.vider(zone1);
    for (const laCarte of etat.joueurs.joueur.main) {
      zone1.append(construire(laCarte, 'joueur'));
    }

    // Main du joueur 2 / de l'ordinateur
    const zone2 = $('main-adversaire');
    majTitreMain($('titre-main-adversaire'), etat.joueurs.adversaire, visible('adversaire'));
    Interface.vider(zone2);
    for (const laCarte of etat.joueurs.adversaire.main) {
      zone2.append(construire(laCarte, 'adversaire'));
    }
  }

  function dessinerCentre(tour) {
    const zone = $('tableau');
    Interface.vider(zone);

    const contexte = {
      libelles,
      raretes,
      puissances,
      evenements,
      nomJoueur: etat.joueurs.joueur.nom,
      nomAdversaire: etat.joueurs.adversaire.nom,
    };

    if (tour) {
      zone.append(Interface.comparaison(tour, contexte));
      return;
    }

    // Événement aléatoire du tour en cours, annoncé en tête de table.
    const bandeau = Interface.evenementBandeau(etat.evenement);
    if (bandeau) zone.append(bandeau);

    const aHumainChoisiAttribut =
      etat.phase === 'attribut' && !occupe && (options.mode === 'duel' || etat.chooser === 'joueur');

    zone.append(Interface.creer('p', { consigne: true }, consigneCourante()));

    if (aHumainChoisiAttribut) {
      zone.append(Interface.barreAttributs(etat, libelles, joueurChoisitAttribut));
    }
  }

  /**
   * Titre d'une main : le nom du joueur et le nombre de cartes qu'il lui
   * reste. En duel, une main qui n'est pas en cours de jeu est signalée
   * comme masquée, sinon le joueur ne comprendrait pas pourquoi elle
   * n'affiche qu'un dos de carte.
   */
  function majTitreMain(el, joueur, montee) {
    if (!el) return;
    const nombre = `${joueur.main.length} carte${joueur.main.length > 1 ? 's' : ''}`;
    el.textContent = montee
      ? `Main de ${joueur.nom} (${nombre})`
      : `Main de ${joueur.nom} (${nombre}, masquee)`;
  }

  function majEtiquetteDuel() {
    const el = $('tour-debouche');
    if (!el) return;
    if (etat.phase === 'attribut') {
      el.textContent = `${etat.joueurs[etat.chooser].nom} choisit l'attribut`;
    } else if (etat.phase === 'selection') {
      el.textContent = `${etat.joueurs[etat.aQuiLeTour].nom} choisit sa carte`;
    } else if (etat.phase === 'reveal') {
      el.textContent = 'Résultat du tour';
    } else {
      el.textContent = 'Partie terminée';
    }
  }

  function consigneCourante() {
    switch (etat.phase) {
      case 'attribut':
        return options.mode === 'duel'
          ? `À ${etat.joueurs[etat.chooser].nom} de choisir l'attribut à comparer.`
          : 'Choisissez l\'attribut qui sera comparé pendant ce tour.';
      case 'selection':
        return `Tour ${etat.tour} - ${etat.joueurs[etat.aQuiLeTour].nom} joue sur ` +
          `${Regles.libelle(etat, etat.attributChoisi)}.`;
      case 'reveal':
        return 'Résultat du tour…';
      default:
        return 'Partie terminée.';
    }
  }

  // --- Divers ------------------------------------------------------------

  function message(texte) {
    const el = $('message');
    if (el) el.textContent = texte;
  }

  function echec(texte) {
    const el = $('erreur');
    if (el) {
      el.hidden = false;
      el.textContent = texte;
    }
    const principal = $('contenu');
    if (principal) principal.hidden = true;
  }
})();
