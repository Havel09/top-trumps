/**
 * simuler.js — Banc d'essai du moteur de jeu, sans navigateur.
 *
 * Le but n'est pas de verifier que le code « marche » une fois, mais
 * qu'il ne peut pas se mettre a boucler, perdre une carte ou se retrouver
 * dans un etat impossible, quelle que soit la serie de hasard tiree.
 *
 * On recharge les vrais fichiers js/regles.js et js/ia.js dans un contexte
 * isole, on fabrique une distribution qui imite exactement ce que renvoie
 * php/Partie.php, puis on joue des milliers de parties completes en
 * appelant, a chaque etape, exactement les fonctions que l'interface
 * appelle.
 *
 * Les invariants verifies apres chaque action :
 *
 *   I1  conservation  aucune carte ne disparait ni n'est dupliquee, hormis
 *                     celles que la regle anti-boucle detruit a-troit ;
 *   I2  unicite       les deux mains ne se recouvrent jamais ;
 *   I3  main          les mains ne depassent jamais la taille initiale et
 *                     ne sont jamais vides quand un choix est demande ;
 *   I4  tours         le compteur avance d'exactement un cran par tour ;
 *   I5  egalite       les egalites d'affilee detruisent bien le pot ;
 *   I6  fin           la partie se termine avec un vainqueur non nul.
 *
 * Lancement :  node tests/simuler.js [parties par configuration]
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RACINE = path.resolve(__dirname, '..');
const COTES = ['joueur', 'adversaire'];
const MAX_TOURS = 400; // garde-fou : au-dela, c'est le moteur qui boucle

// ---------------------------------------------------------------------------
// Chargement du moteur dans un contexte isole
// ---------------------------------------------------------------------------

/**
 * Les deux fichiers definissent des `const` de premier niveau : dans un
 * contexte VM ils vivent dans l'environnement lexical global, pas sur
 * l'objet global. Il faut donc les recuperer par une expression evaluee
 * dans ce meme contexte.
 */
function chargerMoteur() {
  const contexte = vm.createContext({});
  for (const nom of ['regles.js', 'ia.js']) {
    const source = fs.readFileSync(path.join(RACINE, 'js', nom), 'utf8');
    vm.runInContext(source, contexte, { filename: nom });
  }
  return vm.runInContext('({ Regles, Ia })', contexte);
}

const { Regles, Ia } = chargerMoteur();

const donnees = JSON.parse(
  fs.readFileSync(path.join(RACINE, 'data', 'cartes.json'), 'utf8')
);

const CATALOGUE = donnees.cartes;
const REGLES = donnees.regles;
const CONFIG = { jeu: donnees.jeu, regles: REGLES };
const TOTAL_CARTES = CATALOGUE.length;
// Une partie ne met en jeu que les cartes réellement distribuées : le
// reste de la collection reste au placard.
const CARTES_EN_JEU = Math.min(
  TOTAL_CARTES,
  2 * REGLES.cartes_par_joueur
);
const CLES_ATTRIBUTS = donnees.jeu.attributs.map((a) => a.cle);
const LIBELLES = {};
for (const a of donnees.jeu.attributs) LIBELLES[a.cle] = a.nom;

// ---------------------------------------------------------------------------
// Aleatoire deterministe : une graine, un echec reproductible
// ---------------------------------------------------------------------------

/** mulberry32 — rapide, correct, et reproductible d'une graine a l'autre. */
function generateur(graine) {
  let etat = graine >>> 0;
  return function alea() {
    etat = (etat + 0x6d2b79f5) >>> 0;
    let t = etat;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// Faux serveur : la meme distribution que php/Partie.php::distribuer()
// ---------------------------------------------------------------------------

/**
 * Imite fidelement le serveur : il melange, il coupe en deux paquets de
 * `cartes_par_joueur` cartes, et il ne renvoie que la main visible plus le
 * nombre de cartes restantes — jamais leur contenu.
 */
function distribuer(alea) {
  const parJoueur = REGLES.cartes_par_joueur;
  const melange = Regles.melanger(CATALOGUE.slice(), alea);

  const paquets = [];
  for (let i = 0; i < melange.length; i += parJoueur) {
    paquets.push(melange.slice(i, i + parJoueur));
  }

  const joueurs = {};
  COTES.forEach((nom, index) => {
    const paquet = paquets[index] || [];
    joueurs[nom] = {
      main: paquet.slice(0, REGLES.main_initiale),
      pioche: paquet.slice(REGLES.main_initiale),
    };
  });

  return { mode: 'ia', joueurs, main_initiale: REGLES.main_initiale };
}

// ---------------------------------------------------------------------------
// Controle des invariants
// ---------------------------------------------------------------------------

const erreurs = [];
let verifications = 0;

function verifier(ou, condition, code) {
  verifications++;
  if (!condition) {
    erreurs.push(`${ou} : ${code}`);
  }
}

/** I1 + I2 : chaque carte du jeu se trouve exactement une fois. */
function controlerConservation(etat, ou) {
  const vues = new Map();
  const ajouter = (carte) => {
    if (carte) vues.set(carte.id, (vues.get(carte.id) || 0) + 1);
  };

  for (const cote of COTES) {
    for (const carte of etat.joueurs[cote].main) ajouter(carte);
    for (const carte of etat.joueurs[cote].pioche) ajouter(carte);
  }
  for (const carte of etat.pot) ajouter(carte);

  // Entre la resolution et tourSuivant(), etat.carteJouee pointe encore
  // sur les cartes posees : celles-ci sont deja comptables dans le pot ou
  // dans le paquet du vainqueur. On ne les recompte que si elles y sont
  // absentes, ce qui couvrirait une carte disparue. Les cartes que la
  // regle anti-boucle vient de detruire, elles, ont bien disparu.
  const detruitesCeTour = new Set(
    ((etat.dernierTour && etat.dernierTour.cartesDetruites) || []).map((c) => c.id)
  );
  for (const cote of COTES) {
    const carte = etat.carteJouee[cote];
    if (carte && !vues.has(carte.id) && !detruitesCeTour.has(carte.id)) {
      ajouter(carte);
    }
  }

  const doubles = [...vues.entries()]
    .filter(([, n]) => n > 1)
    .map(([id]) => id);
  verifier(
    ou,
    doubles.length === 0,
    `I2 carte(s) dupliquee(s) : ${doubles.join(', ')}`
  );

  // Seule la regle anti-boucle a le droit de faire disparaitre des cartes :
  // elle en compte chacune, ce qui rend la perte impossible a confondre
  // avec un oubli du moteur.
  const detruites = etat.detruites || 0;
  const attendu = CARTES_EN_JEU - detruites;
  verifier(
    ou,
    vues.size === attendu,
    `I1 conservation : ${vues.size} carte(s) comptee(s) au lieu de ${attendu}` +
      (process.env.DEBUG_CONSO
        ? ` | main=${COTES.map((c) => etat.joueurs[c].main.length)}` +
          ` pioche=${COTES.map((c) => etat.joueurs[c].pioche.length)}` +
          ` pot=${etat.pot.length} detruites=${detruites}` +
          ` jouees=${COTES.map((c) => (etat.carteJouee[c] ? etat.carteJouee[c].id : '-'))}`
        : '')
  );
}

/** I3 : la forme de l'etat est toujours jouable. */
function controlerEtat(etat, ou) {
  for (const cote of COTES) {
    const main = etat.joueurs[cote].main;
    verifier(
      ou,
      main.length <= etat.tailleMain,
      `I3 main de ${cote} : ${main.length} > ${etat.tailleMain}`
    );
    const vus = new Set(main.map((c) => c.id));
    verifier(ou, vus.size === main.length, `I2 doublon dans la main de ${cote}`);
  }

  if (etat.phase === 'selection') {
    verifier(ou, etat.attributChoisi !== null, 'I3 selection sans attribut');
    verifier(
      ou,
      COTES.includes(etat.aQuiLeTour),
      `I3 selection sans joueur valide : ${etat.aQuiLeTour}`
    );
  }
  if (etat.phase === 'attribut') {
    verifier(
      ou,
      COTES.includes(etat.chooser),
      `I3 chooser invalide : ${etat.chooser}`
    );
  }
  if (etat.phase === 'fin') {
    verifier(
      ou,
      COTES.includes(etat.gagnant),
      `I6 fin sans vainqueur : ${etat.gagnant}`
    );
  }

  // I7 : un pouvoir actif ne se déclenche qu'une fois par carte et par partie.
  const pouvoirsVus = new Set();
  for (const p of etat.pouvoirsUtilises || []) {
    const marron = `${p.cote}:${p.id}`;
    verifier(
      ou,
      !pouvoirsVus.has(marron),
      `I7 pouvoir utilise deux fois : ${marron}`
    );
    pouvoirsVus.add(marron);
  }
}

// ---------------------------------------------------------------------------
// Un tour, joue comme l'interface le joue
// ---------------------------------------------------------------------------

/**
 * Joue un tour complet en appelant exactement les memes fonctions que
 * js/jeu.js : choisirAttribut, choisirCarte pour chacun, puis tourSuivant
 * apres la revelation.
 *
 * @param {object}   etat    etat en cours
 * @param {object}   pensees { joueur: pensee IA, adversaire: pensee IA }
 * @param {string}   ou      prefixe pour les messages d'erreur
 * @param {object}   bilan   compteur partage
 */
function jouerUnTour(etat, pensees, ou, bilan) {
  const toursAvant = etat.totalTours;
  const egalitesAvant = etat.egalites;
  const potAvant = etat.pot.length;
  const detruitesAvant = etat.detruites || 0;
  // L'événement du tour en cours, capturé avant la résolution.
  const evenementCle = etat.evenement ? etat.evenement.cle : null;

  // --- Etape 1 : l'attribut -----------------------------------------------
  const chooser = etat.chooser;
  const cle = Ia.choisirAttribut(etat, pensees[chooser], chooser);
  verifier(
    `${ou} attribut`,
    CLES_ATTRIBUTS.includes(cle),
    `I3 attribut inconnu propose : ${cle}`
  );
  Regles.choisirAttribut(etat, chooser, cle);
  controlerEtat(etat, `${ou} attribut`);

  // --- Etape 2 : les deux cartes -----------------------------------------
  // L'ordre compte : le moteur fait jouer en premier celui qui n'a PAS
  // choisi l'attribut. L'interface fait pareil, donc le test aussi.
  for (const cote of [Regles.AUTRE[chooser], chooser]) {
    verifier(
      `${ou} selection`,
      Regles.doitChoisirCarte(etat, cote),
      `I3 ${cote} ne devrait pas avoir la main`
    );
    const id = Ia.choisirCarte(etat, pensees[cote], cote, etat.attributChoisi);
    verifier(
      `${ou} selection`,
      etat.joueurs[cote].main.some((c) => c.id === id),
      `I3 ${cote} joue une carte absente de sa main : ${id}`
    );
    const pouvoir = Ia.choisirPouvoir(etat, pensees[cote], cote, id, etat.attributChoisi);
    Regles.choisirCarte(etat, cote, id, pouvoir);
    if (pouvoir) {
      const dernier = etat.pouvoirsUtilises[etat.pouvoirsUtilises.length - 1];
      verifier(
        `${ou} selection`,
        Boolean(dernier) &&
          dernier.cote === cote &&
          String(dernier.id) === String(id) &&
          dernier.cle === pouvoir,
        `I7 pouvoir mal enregistre : ${pouvoir}`
      );
      verifier(
        `${ou} selection`,
        etat.declare[cote] === pouvoir,
        'I7 pouvoir non declare par le moteur'
      );
    }
    controlerEtat(etat, `${ou} selection`);
  }

  // --- Etape 3 : la resolution -------------------------------------------
  const tour = etat.dernierTour;
  verifier(`${ou} resoudre`, tour !== null, 'I4 aucun tour resolu');
  verifier(
    `${ou} resoudre`,
    etat.totalTours === toursAvant + 1,
    `I4 totalTours : ${etat.totalTours} au lieu de ${toursAvant + 1}`
  );
  verifier(
    `${ou} resoudre`,
    etat.phase === 'reveal' || etat.phase === 'fin',
    `I3 phase inattendue : ${etat.phase}`
  );

  for (const cote of COTES) Ia.apprendre(pensees[cote], tour);

  // L'événement qui a pesé sur ce tour est bien celui annoncé au départ.
  verifier(
    `${ou} resoudre`,
    (tour.evenement || null) === evenementCle,
    'I7 l evenement du tour a change en cours de route'
  );

  // I5 : la regle anti-boucle. Sur une egalite, les cartes posees et le
  // pot se disputent au tour suivant ; au bout de egaliteMax egalites
  // d'affilee, tout est detruit. L'événement « Oubliettes » avale les deux
  // cartes du tour sans toucher au pot ni à la série d'égalités.
  if (tour.resultat === 'egalite') {
    bilan.egalites++;
    if (tour.evenement === 'oubliette') {
      bilan.oubliettes++;
      verifier(
        `${ou} egalite`,
        // En pleine partie, le pot reste intact ; quand la partie se
        // termine ce tour-là, verifierFin remet le pot au survivant, comme
        // il le fait pour n'importe quelle fin par épuisement des cartes.
        etat.pot.length === potAvant || etat.phase === 'fin',
        `I5 oubliette : le pot bouge (${etat.pot.length} au lieu de ${potAvant})`
      );
      verifier(
        `${ou} egalite`,
        etat.egalites === egalitesAvant,
        'I5 oubliette : le compteur d egalites avance'
      );
      verifier(
        `${ou} egalite`,
        etat.detruites === detruitesAvant + 2,
        `I1 oubliette : detruites = ${etat.detruites} au lieu de ${detruitesAvant + 2}`
      );
      verifier(
        `${ou} egalite`,
        etat.chooser === chooser,
        `I4 oubliette : le choix de l attribut change (${chooser} -> ${etat.chooser})`
      );
    } else if (egalitesAvant + 1 >= etat.egaliteMax) {
      bilan.potsDetruits++;
      verifier(`${ou} egalite`, etat.pot.length === 0, `I5 le pot aurait du etre detruit (${etat.pot.length})`);
      verifier(`${ou} egalite`, etat.egalites === 0, 'I5 compteur d egalites non remis a zero');
      // Seules les deux cartes du tour et le pot précédent peuvent avoir
      // disparu : la règle anti-boucle doit compter chacune d'elles.
      verifier(
        `${ou} egalite`,
        etat.detruites === detruitesAvant + 2 + potAvant,
        `I1 le compteur de cartes detruites vaut ${etat.detruites} au lieu de ${detruitesAvant + 2 + potAvant}`
      );
    } else {
      verifier(
        `${ou} egalite`,
        etat.egalites === egalitesAvant + 1,
        `I5 compteur d egalites : ${etat.egalites} au lieu de ${egalitesAvant + 1}`
      );
      // En cas d'egalite, personne ne change : celui qui avait choisi
      // l'attribut le choisit aussi pour le tour suivant.
      verifier(
        `${ou} egalite`,
        etat.chooser === chooser,
        `I4 le choix de l attribut change apres une egalite (${chooser} -> ${etat.chooser})`
      );
    }
  } else {
    verifier(`${ou} egalite`, etat.pot.length === 0, 'I5 pot non vide apres un tour decisif');
    verifier(`${ou} egalite`, etat.egalites === 0, 'I5 compteur d egalites non remis a zero');
    verifier(
      `${ou} egalite`,
      (etat.detruites || 0) === detruitesAvant,
      'I1 des cartes ont disparu hors de la regle anti-boucle'
    );
    verifier(
      `${ou} egalite`,
      etat.chooser === tour.resultat,
      `I4 le choix revient a ${etat.chooser} alors que ${tour.resultat} a gagne`
    );
  }

  if (etat.phase === 'fin') return;

  controlerConservation(etat, `${ou} resoudre`);
  Regles.tourSuivant(etat);
  controlerEtat(etat, `${ou} suivant`);

  // I7 : l'événement du tour suivant n'est tiré qu'aux tours de cadence.
  if (etat.evenementTous && etat.evenementTous > 0) {
    if ((etat.tour - 1) % etat.evenementTous !== 0) {
      verifier(
        `${ou} suivant`,
        etat.evenement === null,
        'I7 evenement tire hors cadence'
      );
    } else {
      verifier(
        `${ou} suivant`,
        etat.evenement === null ||
          donnees.jeu.evenements.some((e) => e.cle === etat.evenement.cle),
        `I7 evenement inconnu : ${etat.evenement ? etat.evenement.cle : '-'}`
      );
    }
  }
  // Le pouvoir déclaré d'un tour est oublié dès le suivant.
  verifier(
    `${ou} suivant`,
    etat.declare.joueur === null && etat.declare.adversaire === null,
    'I7 declare non remis a zero entre deux tours'
  );

  // Quand un paquet n'est pas vide, la main doit avoir ete reapprovisionnee.
  for (const cote of COTES) {
    if (etat.joueurs[cote].pioche.length > 0) {
      verifier(
        `${ou} suivant`,
        etat.joueurs[cote].main.length === etat.tailleMain,
        `I3 main de ${cote} a ${etat.joueurs[cote].main.length} alors que le paquet n'est pas vide`
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Une partie complete
// ---------------------------------------------------------------------------

/**
 * Joue une partie complete.
 *
 * Les deux camps sont toujours pilotes par une IA : c'est le moyen le plus
 * rapide de faire tourner des milliers de parties, et cela exerce exactement
 * le meme moteur que des clics humains. Pour estimer l'experience reelle du
 * joueur, le camp « joueur » regle son niveau independamment : c'est ainsi
 * qu'on peut comparer un joueur moyen contre l'Oracle.
 *
 * @param {string} mode          'ia' | 'duel'
 * @param {string} niveauJoueur  niveau de l'IA qui pilote le camp joueur
 * @param {string} niveauAdv     niveau de l'IA qui pilote le camp adverse
 * @param {string} etiquette     nom lisible de la configuration
 */
function simulerPartie(mode, niveauJoueur, niveauAdv, etiquette, graine, bilan) {
  // Chaque consommateur de hasard a son propre flux, dérivé de la graine.
  // Un flux unique serait reproductible, mais il couplerait les deux IA :
  // le nombre de tirages de l'une décalerait ceux de l'autre, et le
  // résultat n'aurait plus rien d'aléatoire. Voir tests/equilibrer.js.
  const alea = {
    melange: generateur(graine),
    joueur: generateur((graine ^ 0x9e3779b9) >>> 0),
    adversaire: generateur((graine ^ 0x85ebca6b) >>> 0),
  };
  const ou = `${etiquette}#${bilan.parties + 1}`;

  // Chaque IA reçoit le flux qui lui est réservé : une graine donne donc
  // une partie strictement identique, d'une exécution à l'autre.
  const pensees = {
    joueur: Ia.creerPensee(CATALOGUE, CONFIG, niveauJoueur, alea.joueur),
    adversaire: Ia.creerPensee(CATALOGUE, CONFIG, niveauAdv, alea.adversaire),
  };

  const etat = Regles.creerPartie(distribuer(alea.melange), {
    mode,
    nomJoueur: 'Humain',
    nomAdversaire:
      mode === 'duel' ? 'Humain 2' : Ia.NIVEAUX[niveauAdv].nom,
    egaliteMax: REGLES.egalite_max_consecutive,
    toursMax: REGLES.tours_max,
    evenementTous: REGLES.evenement_tous || 0,
    evenements: donnees.jeu.evenements || [],
    alea: alea.melange,
    libelles: LIBELLES,
    premierCote: alea.melange() < 0.5 ? 'joueur' : 'adversaire',
  });

  controlerConservation(etat, `${ou} depart`);
  controlerEtat(etat, `${ou} depart`);

  while (etat.phase !== 'fin') {
    if (etat.totalTours > MAX_TOURS) {
      verifier(ou, false, `boucle detectee apres ${etat.totalTours} tours`);
      bilan.boucles++;
      return null;
    }
    jouerUnTour(etat, pensees, ou, bilan);
  }

  // I6 : un vainqueur, et plus aucune carte à jouer chez le perdant.
  // Quand l'arbitre tranche au bout de toursMax, le perdant garde
  // évidemment des cartes : c'est précisément pourquoi l'arbitre existe.
  const perdant = etat.gagnant === 'joueur' ? 'adversaire' : 'joueur';
  const parArbitre = etat.arbitre === true;
  verifier(
    ou,
    parArbitre || Regles.restant(etat.joueurs[perdant]) === 0,
    `I6 le perdant peut encore jouer ${Regles.restant(etat.joueurs[perdant])} carte(s)`
  );
  verifier(
    ou,
    Regles.restant(etat.joueurs[etat.gagnant]) > 0,
    'I6 le vainqueur n a plus aucune carte a jouer'
  );
  verifier(ou, etat.pot.length === 0, 'I6 des cartes restent dans le pot');
  verifier(
    ou,
    etat.totalTours <= etat.toursMax,
    `I6 la partie a depasse la limite de ${etat.toursMax} tours`
  );
  // L'arbitre ne peut être appelé qu'à la limite, et jamais après une
  // partie déjà terminée normalement.
  verifier(
    ou,
    (parArbitre && etat.totalTours >= etat.toursMax) || !parArbitre,
    `I6 l arbitre a tranche a tort (${etat.totalTours} tours sur ${etat.toursMax})`
  );

  const resume = Regles.resume(etat);
  verifier(
    ou,
    resume.tours === etat.totalTours,
    `I4 resume.tours = ${resume.tours} au lieu de ${etat.totalTours}`
  );

  // Aller-retour de serialisation : la sauvegarde doit restituer le jeu
  // exactement, sinon une partie reprise deviendrait injouable.
  const relu = Regles.deserialiser(JSON.parse(JSON.stringify(Regles.serialiser(etat))), {
    evenements: donnees.jeu.evenements,
    evenementTous: REGLES.evenement_tous,
  });
  controlerConservation(relu, `${ou} sauvegarde`);
  verifier(
    ou,
    relu.joueurs.joueur.gagnees === etat.joueurs.joueur.gagnees &&
      relu.joueurs.adversaire.gagnees === etat.joueurs.adversaire.gagnees,
    'I6 la sauvegarde ne restitue pas le compteur de cartes gagnees'
  );
  verifier(
    ou,
    relu.score.joueur === etat.score.joueur &&
      relu.score.adversaire === etat.score.adversaire,
    'I6 la sauvegarde ne restitue pas le score'
  );
  verifier(
    ou,
    relu.toursMax === etat.toursMax && relu.egaliteMax === etat.egaliteMax,
    'I6 la sauvegarde ne restitue pas les regles'
  );
  verifier(
    ou,
    (relu.detruites || 0) === (etat.detruites || 0),
    'I1 la sauvegarde perd le compte des cartes detruites'
  );
  verifier(
    ou,
    relu.pouvoirsUtilises.length === (etat.pouvoirsUtilises || []).length,
    'I7 la sauvegarde perd des pouvoirs utilises'
  );
  verifier(
    ou,
    (relu.evenement ? relu.evenement.cle : null) ===
      (etat.evenement ? etat.evenement.cle : null),
    'I7 la sauvegarde perd l evenement en cours'
  );
  verifier(
    ou,
    relu.evenementTous === etat.evenementTous,
    'I7 la sauvegarde perd la cadence des evenements'
  );
  verifier(
    ou,
    relu.evenementsRestants.length === (etat.evenementsRestants || []).length,
    'I7 la sauvegarde perd le paquet d evenements'
  );

  bilan.parties++;
  bilan.tours += etat.totalTours;
  bilan.min = Math.min(bilan.min, etat.totalTours);
  bilan.max = Math.max(bilan.max, etat.totalTours);
  if (etat.gagnant === 'joueur') bilan.victoires++;
  return etat;
}

// ---------------------------------------------------------------------------
// Reprise de partie : sauvegarder au milieu, puis continuer
// ---------------------------------------------------------------------------

/**
 * Vérifie qu'une partie interrompue puis reprise arrive au même endroit.
 *
 * On joue la moitié d'une partie, on sérialise, on relit dans un état
 * vierge, puis on termine normalement. Si la reprise perdait une carte ou
 * décalait un compteur, l'invariant de conservation le signalerait.
 */
function testerReprise(nbEssais) {
  const bilan = { essais: 0, echecs: 0 };

  for (let n = 0; n < nbEssais; n++) {
    const graine = (0xc0ffee + n * 2654435761) >>> 0;
    const alea = {
      melange: generateur(graine),
      joueur: generateur((graine ^ 0x9e3779b9) >>> 0),
      adversaire: generateur((graine ^ 0x85ebca6b) >>> 0),
    };
    const ou = `reprise#${n + 1}`;

    const pensees = {
      joueur: Ia.creerPensee(CATALOGUE, CONFIG, 'difficile', alea.joueur),
      adversaire: Ia.creerPensee(CATALOGUE, CONFIG, 'normal', alea.adversaire),
    };
    const etat = Regles.creerPartie(distribuer(alea.melange), {
      mode: 'ia',
      nomJoueur: 'Humain',
      nomAdversaire: 'Ordinateur',
      egaliteMax: REGLES.egalite_max_consecutive,
      toursMax: REGLES.tours_max,
      evenementTous: REGLES.evenement_tous || 0,
      evenements: donnees.jeu.evenements || [],
      alea: alea.melange,
      libelles: LIBELLES,
      premierCote: 'joueur',
    });

    // On joue quelques tours, puis on « ferme l'onglet ».
    const aJouer = 1 + Math.floor(alea.melange() * 6);
    const compte = { egalites: 0, potsDetruits: 0, oubliettes: 0, boucles: 0 };
    for (let t = 0; t < aJouer && etat.phase !== 'fin'; t++) {
      jouerUnTour(etat, pensees, ou, compte);
    }
    if (etat.phase === 'fin') continue;

    const instantane = JSON.parse(JSON.stringify(Regles.serialiser(etat)));
    const relu = Regles.deserialiser(instantane, {
      evenements: donnees.jeu.evenements,
      evenementTous: REGLES.evenement_tous,
    });
    controlerConservation(relu, `${ou} relu`);
    controlerEtat(relu, `${ou} relu`);

    // On repart de l'état relu, comme le ferait la page de jeu.
    verifier(
      ou,
      relu.phase === 'attribut',
      `I6 la reprise ne repart pas du début d'un tour (phase ${relu.phase})`
    );
    verifier(
      ou,
      Regles.restant(relu.joueurs.joueur) === Regles.restant(etat.joueurs.joueur),
      'I6 la reprise change le nombre de cartes du joueur'
    );

    // Et on finit la partie normalement.
    while (relu.phase !== 'fin') {
      if (relu.totalTours > MAX_TOURS) {
        verifier(ou, false, `boucle apres reprise (${relu.totalTours} tours)`);
        break;
      }
      jouerUnTour(relu, pensees, ou, compte);
    }

    verifier(
      ou,
      COTES.includes(relu.gagnant),
      `I6 la partie reprise n a pas de vainqueur (${relu.gagnant})`
    );
    bilan.essais++;
  }

  return bilan;
}

// ---------------------------------------------------------------------------
// Programme principal
// ---------------------------------------------------------------------------

function main() {
  const demande = Number.parseInt(process.argv[2] || '200', 10);
  const nbParties = Number.isFinite(demande) && demande > 0 ? demande : 200;

  // [mode, niveau du camp joueur, niveau du camp adverse, etiquette lisible]
  //
  // Les lignes « joueur vs Oracle » sont celles qui comptent pour le joueur
  // réel : son camp est moins fort que l'ordinateur, et il ne joue pas
  // forcément tous les tours comme une IA.
  const configurations = [
    ['ia', 'difficile', 'facile', 'ia  / Oracle   vs Novice'],
    ['ia', 'difficile', 'normal', 'ia  / Oracle   vs Tacticien'],
    ['ia', 'difficile', 'difficile', 'ia  / Oracle   vs Oracle'],
    ['ia', 'normal', 'difficile', 'ia  / Tacticien vs Oracle'],
    ['ia', 'facile', 'difficile', 'ia  / Novice   vs Oracle'],
    ['duel', 'difficile', 'difficile', 'duel/ Oracle   vs Oracle'],
    ['duel', 'facile', 'facile', 'duel/ Novice   vs Novice'],
  ];

  console.log(
    `Banc d'essai : ${nbParties} partie(s) par configuration, ` +
      `${CARTES_EN_JEU} cartes en jeu sur ${TOTAL_CARTES}, ` +
      `regles ${JSON.stringify(REGLES)}\n`
  );

  const lignes = [];
  let totalParties = 0;
  let totalTours = 0;
  let totalEgalites = 0;
  let totalPotsDetruits = 0;
  let totalOubliettes = 0;
  let totalBoucles = 0;
  let totalArbitres = 0;

  configurations.forEach(([mode, niveauJoueur, niveauAdv, etiquette], index) => {
    const bilan = {
      parties: 0,
      tours: 0,
      min: Infinity,
      max: 0,
      egalites: 0,
      potsDetruits: 0,
      oubliettes: 0,
      boucles: 0,
      arbitres: 0,
      victoires: 0,
    };

    // Une graine distincte par configuration : un echec se rejoue a l'identique.
    const graine = (0x5eed ^ (index + 1) * 2654435761) >>> 0;
    for (let p = 0; p < nbParties; p++) {
      const terminee = simulerPartie(
        mode,
        niveauJoueur,
        niveauAdv,
        etiquette,
        (graine + p * 7919) >>> 0,
        bilan
      );
      if (terminee && terminee.arbitre) bilan.arbitres++;
    }

    totalParties += bilan.parties;
    totalTours += bilan.tours;
    totalEgalites += bilan.egalites;
    totalPotsDetruits += bilan.potsDetruits;
    totalOubliettes += bilan.oubliettes;
    totalBoucles += bilan.boucles;
    totalArbitres += bilan.arbitres;

    const moyenne = bilan.parties ? (bilan.tours / bilan.parties).toFixed(1) : '-';
    const tauxArbitre = bilan.parties
      ? ((100 * bilan.arbitres) / bilan.parties).toFixed(0)
      : '0';
    lignes.push(
      `  ${etiquette}  ` +
        `${String(bilan.parties).padStart(4)} parties  ` +
        `moy ${moyenne.padStart(5)} tours  ` +
        `[${bilan.min === Infinity ? '-' : bilan.min}..${bilan.max}]  ` +
        `egalites ${String(bilan.egalites).padStart(4)}  ` +
        `pots detruits ${String(bilan.potsDetruits).padStart(3)}  ` +
        `arbitres ${tauxArbitre.padStart(3)}%  ` +
        `joueur ${(100 * bilan.victoires / Math.max(1, bilan.parties)).toFixed(0)}%`
    );
  });

  console.log(lignes.join('\n'));

  // Le banc d'essai des reprises de partie.
  const reprise = testerReprise(Math.max(20, Math.floor(nbParties / 4)));
  console.log(`\nReprises de partie : ${reprise.essais} testee(s).`);

  console.log(
    `\nTotal : ${totalParties} parties, ${totalTours} tours joues ` +
      `(${verifications} verifications d'invariants).`
  );
  console.log(
    `Egalites : ${totalEgalites} (dont ${totalPotsDetruits} pots detruits par la regle anti-boucle, ` +
      `${totalOubliettes} avalees par l'evenement Oubliettes).`
  );
  console.log(`Arbitres (limite de tours atteinte) : ${totalArbitres}.`);

  if (totalBoucles > 0) {
    console.log(`\nKO : ${totalBoucles} partie(s) en boucle.`);
    for (const ligne of erreurs.slice(0, 30)) console.log(`  - ${ligne}`);
    process.exit(1);
  }
  if (erreurs.length > 0) {
    console.log(`\nKO : ${erreurs.length} invariant(s) viole(s).`);
    for (const ligne of erreurs.slice(0, 30)) console.log(`  - ${ligne}`);
    process.exit(1);
  }

  console.log('\nOK : toutes les parties se terminent et tous les invariants tiennent.');
}

if (require.main === module) {
  main();
}
