/**
 * equilibrer.js — Étalonnage des niveaux de l'ordinateur.
 *
 * Un jeu où l'ordinateur gagne toujours n'est pas un jeu : il faut que le
 * joueur ait une vraie chance, tout en sentant que l'IA joue mieux que
 * lui. Ce script mesure donc le taux de victoire de l'IA contre un
 * adversaire de référence, et la longueur des parties obtenues.
 *
 * Rien n'est écrit sur le disque : les paramètres de js/ia.js sont
 * modifiés en mémoire, ce qui permet d'explorer des réglages qu'on ne
 * retiendra pas.
 *
 *   node tests/equilibrer.js [parties par mesure]
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RACINE = path.resolve(__dirname, '..');
const COTES = ['joueur', 'adversaire'];

const contexte = vm.createContext({});
for (const nom of ['regles.js', 'ia.js']) {
  vm.runInContext(fs.readFileSync(path.join(RACINE, 'js', nom), 'utf8'), contexte, {
    filename: nom,
  });
}
const { Regles, Ia } = vm.runInContext('({ Regles, Ia })', contexte);

const donnees = JSON.parse(
  fs.readFileSync(path.join(RACINE, 'data', 'cartes.json'), 'utf8')
);
const CATALOGUE = donnees.cartes;
const REGLES = donnees.regles;
const CONFIG = { jeu: donnees.jeu, regles: REGLES };
const LIBELLES = {};
for (const a of donnees.jeu.attributs) LIBELLES[a.cle] = a.nom;

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

function distribuer(alea) {
  const parJoueur = REGLES.cartes_par_joueur;
  const melange = Regles.melanger(CATALOGUE.slice(), alea);
  const joueurs = {};
  COTES.forEach((nom, index) => {
    const paquet = melange.slice(index * parJoueur, (index + 1) * parJoueur);
    joueurs[nom] = {
      main: paquet.slice(0, REGLES.main_initiale),
      pioche: paquet.slice(REGLES.main_initiale),
    };
  });
  return { mode: 'ia', joueurs, main_initiale: REGLES.main_initiale };
}

/**
 * Joue une partie entre deux niveaux et renvoie l'outcome.
 *
 * Chaque consommateur de hasard reçoit son propre flux, dérivé de la même
 * graine. Un flux unique pour les deux IA paraît anodin, mais il les
 * couple : le nombre de tirages que fait l'une décale ceux de l'autre, et
 * l'appariement des tours biaise le résultat. C'est un artefact du
 * banc d'essai, pas du jeu, où l'ordinateur ne partage pas son
 * générateur avec le joueur humain.
 *
 * @param {string} niveauA niveau du camp joueur
 * @param {string} niveauB niveau du camp adversaire
 * @param {number} graine
 */
function jouer(niveauA, niveauB, graine) {
  const alea = {
    melange: generateur(graine),
    joueur: generateur((graine ^ 0x9e3779b9) >>> 0),
    adversaire: generateur((graine ^ 0x85ebca6b) >>> 0),
  };

  const etat = Regles.creerPartie(distribuer(alea.melange), {
    mode: 'ia',
    nomJoueur: 'Humain',
    nomAdversaire: Ia.NIVEAUX[niveauB].nom,
    egaliteMax: REGLES.egalite_max_consecutive,
    toursMax: REGLES.tours_max,
    libelles: LIBELLES,
    premierCote: alea.melange() < 0.5 ? 'joueur' : 'adversaire',
  });

  const pensees = {
    joueur: Ia.creerPensee(CATALOGUE, CONFIG, niveauA, alea.joueur),
    adversaire: Ia.creerPensee(CATALOGUE, CONFIG, niveauB, alea.adversaire),
  };

  let garde = 0;
  while (etat.phase !== 'fin' && garde++ < 500) {
    const chooser = etat.chooser;
    Regles.choisirAttribut(etat, chooser, Ia.choisirAttribut(etat, pensees[chooser], chooser));
    for (const cote of [Regles.AUTRE[chooser], chooser]) {
      Regles.choisirCarte(
        etat,
        cote,
        Ia.choisirCarte(etat, pensees[cote], cote, etat.attributChoisi)
      );
    }
    for (const cote of COTES) Ia.apprendre(pensees[cote], etat.dernierTour);
    Regles.tourSuivant(etat);
  }

  return {
    tours: etat.totalTours,
    gagneJoueur: etat.gagnant === 'joueur',
  };
}

/**
 * Mesure un niveau de l'IA contre un adversaire de référence.
 *
 * Attention au sens de lecture : `taux` est le pourcentage de parties
 * gagnées par le joueur de référence, donc 100 - taux est la part de
 * l'IA. Un tableau où les deux colonnes se ressemblent est un tableau
 * où l'on a inversé les étiquettes.
 */
function evaluer(niveauMesure, niveauAdverse, nombre) {
  let victoires = 0;
  let tours = 0;
  for (let n = 0; n < nombre; n++) {
    const r = jouer(niveauAdverse, niveauMesure, (0x51ed + n * 2654435761) >>> 0);
    if (r.gagneJoueur) victoires++;
    tours += r.tours;
  }
  return {
    joueur: (100 * victoires) / nombre,
    ia: (100 * (nombre - victoires)) / nombre,
    nombre,
    moyenne: tours / nombre,
  };
}

const nombre = Number.parseInt(process.argv[2] || '400', 10);
const N = Number.isFinite(nombre) && nombre > 0 ? nombre : 400;

// Niveau de référence du « joueur humain » : le Tacticien. Il mémorise et
// joue ses points forts, sans réserve ni anticipation : c'est à peu près
// ce que fait un joueur qui réfléchit sans être un expert.
const REFERENCE = 'normal';

function ligne(etiquette, r) {
  return (
    `  ${etiquette.padEnd(30)}` +
    `IA gagne ${r.ia.toFixed(0).padStart(3)} %   ` +
    `joueur gagne ${r.joueur.toFixed(0).padStart(3)} %   ` +
    `parties ${String(r.nombre).padStart(4)}   ` +
    `duree moyenne ${r.moyenne.toFixed(1).padStart(5)} tours`
  );
}

console.log(
  `Étalonnage : ${N} parties par mesure, joueur de référence = ${Ia.NIVEAUX[REFERENCE].nom}.\n`
);
console.log(ligne('état actuel', evaluer('difficile', REFERENCE, N)));
console.log('');

// On fait varier les deux leviers qui expliquent l'écart entre les niveaux :
// le « coût de réserve » (à quel point l'IA garde ses meilleures cartes)
// et la profondeur (le droit de sacrifier une carte quand le tour est
// perdu). On regarde aussi l'effet d'une pointe d'erreur.
console.log('  réserve   profondeur   erreurs   IA gagne   joueur   duree');
console.log('  ' + '-'.repeat(68));

const sauvegarde = { ...Ia.NIVEAUX.difficile };
for (const reserve of [0.60, 0.45, 0.30, 0.20]) {
  for (const profondeur of [1, 0]) {
    for (const imprecisions of [0, 0.085, 0.15]) {
      Ia.NIVEAUX.difficile.reserve = reserve;
      Ia.NIVEAUX.difficile.profondeur = profondeur;
      Ia.NIVEAUX.difficile.imprecisions = imprecisions;
      const r = evaluer('difficile', REFERENCE, N);
      console.log(
        `  ${reserve.toFixed(2).padStart(7)}   ${String(profondeur).padStart(9)}   ` +
          `${imprecisions.toFixed(3).padStart(7)}   ` +
          `${r.ia.toFixed(0).padStart(6)} %   ${r.joueur.toFixed(0).padStart(5)} %   ` +
          `${r.moyenne.toFixed(1).padStart(5)}`
      );
    }
  }
}

// On remet le niveau dans l'état où on l'a trouvé : ce script ne modifie
// que sa propre copie en mémoire, mais la restauration évite qu'un
// réglage exploré ici fuite dans la suite du fichier.
Object.assign(Ia.NIVEAUX.difficile, sauvegarde);
