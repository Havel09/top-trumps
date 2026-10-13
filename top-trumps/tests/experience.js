/**
 * experience.js — Cherche les meilleurs réglages de partie.
 *
 * Le banc d'essai montre qu'avec 12 cartes par joueur, la moitié des
 * parties n'aboutissent jamais à « quelqu'un n'a plus de cartes » :
 * l'arbitre doit trancher. Ce script fait varier les paramètres et
 * mesure, pour chacun, combien de parties se terminent par un
 * exhaustion normale (un joueur à court de cartes) plutôt que par la
 * limite de tours, et quelle est la durée moyenne.
 *
 * On ne modifie aucun fichier : tout se passe en mémoire.
 *
 * Lancement :  node tests/experience.js
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const RACINE = path.resolve(__dirname, '..');

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

const COTES = ['joueur', 'adversaire'];

function distribuer(alea, parJoueur, mainInitiale) {
  const melange = Regles.melanger(CATALOGUE.slice(), alea);
  const paquets = [];
  for (let i = 0; i < melange.length; i += parJoueur) {
    paquets.push(melange.slice(i, i + parJoueur));
  }
  const joueurs = {};
  COTES.forEach((nom, index) => {
    const paquet = paquets[index] || [];
    joueurs[nom] = {
      main: paquet.slice(0, mainInitiale),
      pioche: paquet.slice(mainInitiale),
    };
  });
  return { mode: 'ia', joueurs, main_initiale: mainInitiale };
}

/** Joue une partie et renvoie sa durée et sa cause de fin. */
function jouer(mode, niveau, regles, graine) {
  const alea = generateur(graine);
  const parJoueur = regles.cartes_par_joueur;
  const mainInitiale = regles.main_initiale;

  const etat = Regles.creerPartie(distribuer(alea, parJoueur, mainInitiale), {
    mode,
    nomJoueur: 'Humain',
    nomAdversaire: 'Ordinateur',
    egaliteMax: regles.egalite_max_consecutive,
    toursMax: regles.tours_max,
    libelles: LIBELLES,
    premierCote: alea() < 0.5 ? 'joueur' : 'adversaire',
  });

  const pensees = {
    joueur: Ia.creerPensee(CATALOGUE, { jeu: donnees.jeu, regles }, 'difficile'),
    adversaire: Ia.creerPensee(CATALOGUE, { jeu: donnees.jeu, regles }, niveau),
  };

  let tours = 0;
  while (etat.phase !== 'fin' && tours < 500) {
    const chooser = etat.chooser;
    Regles.choisirAttribut(etat, chooser, Ia.choisirAttribut(etat, pensees[chooser], chooser));
    for (const cote of [Regles.AUTRE[chooser], chooser]) {
      Regles.choisirCarte(
        etat,
        cote,
        Ia.choisirCarte(etat, pensees[cote], cote, etat.attributChoisi)
      );
    }
    // L'IA doit retenir les deux cartes révélées, exactement comme le fait
    // la page de jeu : sans cela elle ne memorise rien et les parties
    // paraissent bien plus courtes qu'elles ne le sont.
    for (const cote of COTES) Ia.apprendre(pensees[cote], etat.dernierTour);
    Regles.tourSuivant(etat);
    tours++;
  }
  return { tours: etat.totalTours, arbitre: etat.arbitre === true };
}

function evaluer(regles, mode, niveau, nombre) {
  const tours = [];
  for (let n = 0; n < nombre; n++) {
    const r = jouer(mode, niveau, regles, (0x1234 + n * 2654435761) >>> 0);
    tours.push(r);
  }
  const durees = tours.map((r) => r.tours).sort((a, b) => a - b);
  const centile = (p) => durees[Math.min(durees.length - 1, Math.floor((p / 100) * durees.length))];
  return {
    moyenne: durees.reduce((s, d) => s + d, 0) / nombre,
    median: centile(50),
    p90: centile(90),
    p99: centile(99),
    min: durees[0],
    max: durees[durees.length - 1],
    exhaustif: (100 * tours.filter((r) => !r.arbitre).length) / nombre,
  };
}

const nombre = Number.parseInt(process.argv[2] || '300', 10);
const base = {
  egalite_max_consecutive: 3,
  tours_max: 999, // on laisse le filet de sécurité ne pas trancher
  score_victoire: 100,
};

console.log(`${nombre} parties par configuration.\n`);
console.log(
  'mode/niveau      cartes  main   moy   med    p90    p99    max   fin par exhaustion'
);
console.log('-'.repeat(80));

for (const [mode, niveau] of [
  ['ia', 'facile'],
  ['ia', 'normal'],
  ['ia', 'difficile'],
  ['duel', 'difficile'],
]) {
  for (const [parJoueur, mainInitiale] of [
    [12, 4],
    [10, 4],
    [10, 3],
    [8, 4],
    [8, 3],
  ]) {
    const regles = { ...base, cartes_par_joueur: parJoueur, main_initiale: mainInitiale };
    const r = evaluer(regles, mode, niveau, nombre);
    console.log(
      `${(mode + '/' + niveau).padEnd(15)} ${String(parJoueur).padStart(6)} ${String(mainInitiale).padStart(5)}` +
        ` ${r.moyenne.toFixed(1).padStart(6)} ${String(r.median).padStart(5)} ${String(r.p90).padStart(6)}` +
        ` ${String(r.p99).padStart(6)} ${String(r.max).padStart(6)}` +
        `  ${r.exhaustif.toFixed(0).padStart(5)} %`
    );
  }
  console.log('');
}
