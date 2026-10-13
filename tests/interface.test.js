'use strict';
/**
 * interface.test.js - La vraie page de jeu, jouee sans navigateur.
 *
 * tests/simuler.js verifie le moteur (regles.js + ia.js) et
 * tests/verifier_api.js verifie le serveur PHP. Il restait la couche du
 * milieu : le branchement entre les deux, c'est-a-dire ce que fait
 * jeu.js quand on clique. C'est precisement la couche ou se glissent les
 * erreurs d'identifiants (un `$('tableu')` au lieu de `$('tableau')`, un
 * element rendu dans la mauvaise zone...) et ou rien ne leve d'exception :
 * la page affiche simplement un jeu casse.
 *
 * Le test monte donc un DOM minimal (tests/dom.js), une horloge virtuelle,
 * et un `fetch` qui parle au vrai serveur PHP. Il ne lit pas l'etat du jeu
 * : il regarde ce qui est affiche, et il clique sur ce qu'un joueur
 * verrait. C'est plus lent qu'un test unitaire, mais c'est le seul moyen
 * deattraper ce type de panne.
 *
 * Lancement :  node tests/interface.test.js [http://127.0.0.1:8123]
 *
 * Le serveur doit tourner (php -S 127.0.0.1:8123 depuis la racine du
 * projet). Les fichiers de donnees sont sauvegardes puis restaures, pour
 * que la partie de test ne pollue pas le classement livre.
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const { Document, Stockage, Horloge } = require('./dom.js');

const RACINE = path.resolve(__dirname, '..');
const BASE = (process.argv[2] || 'http://127.0.0.1:8123').replace(/\/$/, '');

let reussites = 0;
const echecs = [];

function verifier(quoi, condition, detail) {
  if (condition) {
    reussites++;
    console.log(`  [ok]    ${quoi}`);
  } else {
    echecs.push(`${quoi}${detail ? ` : ${detail}` : ''}`);
    console.log(`  [ECHEC] ${quoi}${detail ? ` : ${detail}` : ''}`);
  }
}

function titre(txt) {
  console.log(`\n${txt}`);
}

// ---------------------------------------------------------------------------
// Outillage HTML : on fabrique un document a partir des identifiants reellement
// declares dans la page. Si jeu.js demande un identifiant qui n'existe pas
// dans le HTML, la page plante au premier rendu : on le verifie statiquement
// plutot que de le decouvrir au milieu d'une partie.
// ---------------------------------------------------------------------------

function lire(fichier) {
  return fs.readFileSync(path.join(RACINE, fichier), 'utf8');
}

function identifiants(html) {
  const trouves = new Set();
  for (const m of html.matchAll(/\sid="([^"]+)"/g)) trouves.add(m[1]);
  return trouves;
}

function references(html) {
  const trouvees = [];
  for (const m of html.matchAll(/(?:src|href)="([^"#:]+)"/g)) trouvees.push(m[1]);
  return trouvees;
}

function controlerLeHtml() {
  titre('1. Coherence entre les pages HTML, les scripts et les fichiers');

  const pages = fs
    .readdirSync(RACINE)
    .filter((f) => f.endsWith('.html'))
    .sort();

  verifier('des pages HTML existent', pages.length > 0);

  for (const page of pages) {
    const html = lire(page);
    const perdues = references(html).filter((ref) => !fs.existsSync(path.join(RACINE, ref)));
    verifier(
      `${page} : tous les fichiers referencés existent`,
      perdues.length === 0,
      perdues.join(', ')
    );
  }

  // Les scripts de la page de jeu doivent etre charges dans le bon ordre :
  // regles.js avant ia.js, interface.js avant jeu.js.
  const jeu = lire('jeu.html');
  const ordre = [...jeu.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  const attendu = [
    'js/api.js',
    'js/regles.js',
    'js/ia.js',
    'js/audio.js',
    'js/interface.js',
    'js/jeu.js',
  ];
  verifier(
    'jeu.html : scripts charges dans l\'ordre attendu',
    JSON.stringify(ordre) === JSON.stringify(attendu),
    ordre.join(' > ')
  );

  const regles = lire('regles.html');
  const ordreRegles = [...regles.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
  verifier(
    'regles.html : regles.js, ia.js et regles-page.js sont charges',
    ['js/regles.js', 'js/ia.js', 'js/regles-page.js'].every((f) =>
      ordreRegles.includes(f)
    ),
    ordreRegles.join(' > ')
  );

  // Le point le plus fragile : chaque `$('...')` de jeu.js doit correspondre a
  // un identifiant reellement present dans jeu.html.
  const dansHtml = identifiants(jeu);
  const sourceJeu = lire('js/jeu.js');
  const demandes = new Set(
    [...sourceJeu.matchAll(/\$\('([^']+)'\)/g), ...sourceJeu.matchAll(/brancher\('([^']+)'/g)].map(
      (m) => m[1]
    )
  );
  verifier(
    'jeu.js demande au moins une dizaine d\'identifiants',
    demandes.size >= 10,
    `${demandes.size}`
  );

  const inconnus = [...demandes].filter((id) => !dansHtml.has(id));
  verifier(
    'jeu.js ne demande aucun identifiant absent de jeu.html',
    inconnus.length === 0,
    inconnus.join(', ')
  );

  const inutilises = [...dansHtml].filter((id) => !demandes.has(id));
  verifier(
    'tous les identifiants de jeu.html sont utilises par jeu.js',
    inutilises.length === 0,
    inutilises.join(', ')
  );

  // regles-page.js lit la meme page, il ne doit pas dependre d'un identifiant
  // que regles.html ne fournit pas.
  const demandesRegles = new Set(
    [...lire('js/regles-page.js').matchAll(/\$\('([^']+)'\)/g)].map((m) => m[1])
  );
  const inconnusRegles = [...demandesRegles].filter((id) => !identifiants(regles).has(id));
  verifier(
    'regles-page.js ne demande aucun identifiant absent de regles.html',
    inconnusRegles.length === 0,
    inconnusRegles.join(', ')
  );
}

// ---------------------------------------------------------------------------
// Chargement d'une page de jeu dans un contexte isole.
// ---------------------------------------------------------------------------

const SCRIPTS = [
  'js/api.js',
  'js/regles.js',
  'js/ia.js',
  'js/audio.js',
  'js/interface.js',
  'js/jeu.js',
];

/** Element presents dans jeu.html dont le test a besoin de trouver. */
const IDS = [
  'titre-partie',
  'qui-joue',
  'indicateur-sauvegarde',
  'btn-son',
  'erreur',
  'sauvegarde',
  'sauvegarde-quand',
  'btn-reprendre',
  'btn-ignorer',
  'contenu',
  'score',
  'cadre-duel',
  'tour-debouche',
  'tableau',
  'message',
  'titre-main-adversaire',
  'main-adversaire',
  'titre-main-joueur',
  'main-joueur',
  'aide-tour',
  'journal',
  'zone-fin',
];

function chargerPage(options, stockage = new Stockage()) {
  const document = new Document();
  // Le stub ne connaît pas les attributs du HTML : on relit jeu.html pour
  // savoir quels éléments démarrent cachés (<div hidden>), sinon `erreur`
  // serait faussement visible dès le chargement.
  const masques = new Set();
  for (const m of lire('jeu.html').matchAll(/<[^>]+>/g)) {
    const balise = m[0];
    const id = balise.match(/\sid="([^"]+)"/);
    if (id && /\shidden(?:\s|>|=)/.test(balise)) masques.add(id[1]);
  }
  for (const id of IDS) {
    const el = document.inscrire(id);
    el.hidden = masques.has(id);
  }

  const horloge = new Horloge();
  const appels = [];
  const alertes = [];

  const contexte = {
    document,
    localStorage: stockage,
    URL,
    console: {
      log: () => {},
      info: () => {},
      warn: (...a) => alertes.push(['warn', ...a]),
      error: (...a) => alertes.push(['error', ...a]),
    },
    setTimeout: (fn, ms) => horloge.setTimeout(fn, ms),
    clearTimeout: (id) => horloge.clearTimeout(id),
    setInterval: () => 0,
    clearInterval: () => {},
    fetch: (...args) => {
      const cible = args[0];
      const href =
        typeof cible === 'string' ? cible : cible && cible.href ? cible.href : String(cible);
      appels.push(href);
      return fetch(...args);
    },
  };
  const vmctx = vm.createContext(contexte);
  vm.runInContext(
    'globalThis.window = globalThis; globalThis.self = globalThis;' +
      `globalThis.location = { href: ${JSON.stringify(`${BASE}/jeu.html`)} };` +
      'globalThis.AudioContext = undefined;',
    vmctx
  );

  if (options) {
    stockage.setItem('toptrumps-options', JSON.stringify(options));
  }
  stockage.setItem('toptrumps-nom', options ? options.nomJoueur : 'Testeur');

  for (const fichier of SCRIPTS) {
    vm.runInContext(lire(fichier), vmctx, { filename: fichier });
  }

  document.pret();

  const parId = (id) => document.getElementById(id);
  const page = {
    document,
    horloge,
    appels,
    alertes,
    parId,
    texte: (id) => (parId(id) ? parId(id).textContent : ''),
    requetes: (action) => appels.filter((u) => u.includes(`action=${action}`)).length,
  };
  horloge.surFire = () => {
    const m = parId('message');
    return m ? m.textContent : '';
  };
  return page;
}

// ---------------------------------------------------------------------------
// Pilotage : le test joue comme un joueur, uniquement a travers l'ecran.
// ---------------------------------------------------------------------------

const fini = (page) => page.parId('zone-fin').children.length > 0;
const barreAttributs = (page) => page.parId('tableau').querySelectorAll('.attributs-barre__choix');

function cartesJouables(page) {
  return [
    ...page.parId('main-joueur').querySelectorAll('.carte--jouable'),
    ...page.parId('main-adversaire').querySelectorAll('.carte--jouable'),
  ];
}

const actionPossible = (page) => !fini(page) && (barreAttributs(page).length > 0 || cartesJouables(page).length > 0);

/** Laisse tourner le jeu jusqu'a ce qu'une action humaine soit possible. */
async function avancerJusque(page, budget = 300000) {
  const depart = page.horloge.maintenant;
  let garde = 0;
  while (page.horloge.maintenant - depart < budget) {
    if (actionPossible(page)) return true;
    if (fini(page)) return false;
    if (++garde > 8000) return false; // garde-fou anti-boucle
    await page.horloge.avancer(page.horloge.maintenant + 250);
  }
  return actionPossible(page);
}

/**
 * Attend (en avançant l'horloge) qu'un prédicat devienne vrai, avec un
 * budget. Les étapes de la partie se déroulant en asynchrone, un regard
 * unique peut saisir l'écran entre deux mises à jour : cette boucle rend
 * la vérification indépendante de la course d'horloge.
 */
async function attendre(page, predicat, budget = 240000) {
  const depart = page.horloge.maintenant;
  let garde = 0;
  while (page.horloge.maintenant - depart < budget) {
    if (predicat()) return true;
    if (fini(page)) break;
    if (++garde > 8000) break;
    await page.horloge.avancer(page.horloge.maintenant + 250);
  }
  return predicat();
}

/**
 * Joue une partie entiere en mode automatique.
 * Chaque choix est fait au hasard parmi ce qui est affiche a l'ecran.
 */
async function jouerJusquALaFin(page, maxCoups = 4000) {
  const vu = { comparaison: false, jouable: false, attribu: 0, carte: 0, evenement: false, pouvoirs: 0 };
  let coups = 0;
  let choisie = 0;

  while (!fini(page) && coups < maxCoups) {
    coups += 1;

    if (!actionPossible(page)) {
      if (!(await avancerJusque(page))) break;
      if (fini(page)) break;
    }

    // L'événement du tour en cours, s'il y en a un, s'affiche en tête de table.
    vu.evenement ||= page.parId('tableau').querySelectorAll('.banniere-evenement').length > 0;

    const attributs = barreAttributs(page);
    if (attributs.length > 0) {
      vu.attribu += 1;
      attributs[choisie++ % attributs.length].cliquer();
    } else {
      const jouables = cartesJouables(page);
      if (jouables.length > 0) {
        vu.jouable = true;
        // Exercer le chemin du bouton de pouvoir actif : au plus deux fois
        // par partie, et seulement si la carte visée en propose un.
        const cible = jouables[choisie++ % jouables.length];
        const bouton = cible.querySelector('.carte__pouvoir-bouton');
        if (bouton && vu.pouvoirs < 2) {
          vu.pouvoirs += 1;
          bouton.cliquer();
        } else {
          cible.cliquer();
        }
      } else {
        break;
      }
    }
    await avancerJusque(page);
  }

  if (page.parId('tableau').querySelectorAll('.comparaison').length > 0) vu.comparaison = true;
  return {
    coups,
    vu,
    bloque: !fini(page) && coups >= maxCoups,
    erreur: page.texte('erreur'),
    message: page.texte('message'),
    contenuCache: page.parId('contenu').hidden,
    alertes: page.alertes.slice(0, 3),
    minuteries: page.horloge.minuteries.map((m) => m.moment),
    position: page.horloge.maintenant,
    evenements: page.horloge.evenements.slice(-16).map(
      (e) =>
        `${e.type}:${e.id}@${e.moment}${e.delai !== undefined ? `(d${e.delai})` : ''}` +
        (e.message ? `[${e.message.slice(0, 26)}]` : '')
    ),
  };
}

function dernierTourAffiche(page) {
  const lignes = page.parId('journal').querySelectorAll('.journal__ligne');
  if (lignes.length === 0) return 0;
  const texte = lignes[0].textContent.replace(/^T(\d+)/, '$1');
  return parseInt(texte, 10) || 0;
}

// ---------------------------------------------------------------------------

async function principal() {
  console.log(`Test de la page de jeu sur ${BASE}\n`);

  controlerLeHtml();

  // Les fichiers de donnees sont restores a la fin : la partie lancee ici
  // ne doit pas laisser de trace dans le classement livre.
  const sauvegardes = new Map();
  for (const f of ['data/sauvegardes.json', 'data/parties.json', 'data/portefeuilles.json']) {
    const complet = path.join(RACINE, f);
    sauvegardes.set(f, fs.existsSync(complet) ? fs.readFileSync(complet) : null);
  }
  const restaurer = () => {
    for (const [f, contenu] of sauvegardes) {
      const complet = path.join(RACINE, f);
      if (contenu === null) {
        if (fs.existsSync(complet)) fs.unlinkSync(complet);
      } else {
        fs.writeFileSync(complet, contenu);
      }
    }
  };

  try {
    await scenarioPartieComplete();
    await scenarioDuel();
    await scenarioReprise();
  } finally {
    restaurer();
  }

  console.log(`\n${reussites} verification(s) reussie(s), ${echecs.length} echec(s).`);
  if (echecs.length > 0) {
    for (const ligne of echecs) console.log(`  - ${ligne}`);
    process.exit(1);
  }
  console.log('OK : la page de jeu se construit, joue et se termine correctement.');
}

// --- Scenario 1 : une partie complete contre l'ordinateur --------------------

async function scenarioPartieComplete() {
  titre('2. Partie complete contre l\'ordinateur');

  // Depuis que seules les légendaires portent des capacités, une main peut
  // n'en contenir aucune : on relance une partie (au plus 6 fois) jusqu'à
  // en croiser une, pour que le bouton de pouvoir soit réellement exercé.
  // Les vérifications restent celles d'une vraie partie menée à son terme.
  let page;
  let partie;
  for (let tentative = 1; tentative <= 6; tentative++) {
    page = chargerPage({ mode: 'ia', niveau: 'normal', nomJoueur: 'Testeur', nomAdversaire: '' });
    await avancerJusque(page, 300000);

    if (tentative === 1) {
      verifier('la page interroge le serveur pour la configuration', page.requetes('config') >= 1);
      verifier('la page interroge le serveur pour le catalogue', page.requetes('cartes') >= 1);
      verifier('la page interroge le serveur pour la distribution', page.requetes('nouvelle-partie') >= 1);
      verifier(
        'aucune erreur affichee',
        page.parId('erreur').hidden === true,
        page.texte('erreur')
      );
      verifier('le titre annonce le mode et le niveau', /ordinateur/i.test(page.texte('titre-partie')), page.texte('titre-partie'));
      verifier('le bandeau de score est rendu', page.parId('score').querySelectorAll('.score-barre').length === 1);
      verifier('le journal est rendu', page.parId('journal').querySelectorAll('.journal__ligne').length > 0);
      verifier(
        'la main du joueur est affichee',
        page.parId('main-joueur').querySelectorAll('.carte').length > 0
      );
      verifier(
        'la main de l\'ordinateur reste face cachee',
        page.parId('main-adversaire').querySelectorAll('.carte--cachee').length ===
          page.parId('main-adversaire').querySelectorAll('.carte').length
      );
      verifier('la zone de fin est encore vide', fini(page) === false);
    }

    partie = await jouerJusquALaFin(page);
    if (partie.vu.pouvoirs > 0) break;
    console.log(`    (aucune capacite en main, nouvelle partie ${tentative + 1}/6)`);
  }

  const { coups, vu, bloque, erreur, message, contenuCache, alertes, minuteries, evenements } = partie;
  verifier(
    'la partie va jusqu\'a son terme',
    fini(page) && !bloque,
    `${coups} coups de jeu | erreur=[${erreur}] message=[${message}] contenuCache=${contenuCache} ` +
      `alertes=${JSON.stringify(alertes)} enAttente=[${minuteries.join(',')}] ` +
      `evenements=[${evenements.join('|')}]`
  );
  verifier('le joueur a choisi des attributs', vu.attribu > 0, `${vu.attribu}`);
  verifier('le joueur a pose des cartes', vu.jouable);
  verifier(
    'un bandeau d événement s est affiché pendant la partie',
    vu.evenement,
    'aucun .banniere-evenement rendu'
  );
  verifier(
    'le joueur a déclenché au moins un pouvoir actif',
    vu.pouvoirs > 0,
    `${vu.pouvoirs} pouvoir(s) declenché(s)`
  );
  verifier(
    'le resultat d\'un tour a ete affiche',
    page.parId('journal').querySelectorAll('.journal__ligne').length > 0
  );
  verifier(
    'aucune erreur en cours de partie',
    !page.alertes.some((a) => a[0] === 'error'),
    JSON.stringify(page.alertes.slice(0, 2))
  );
  verifier(
    'le message d\'erreur est toujours masque',
    page.parId('erreur').hidden === true,
    page.texte('erreur')
  );

  const fin = page.parId('zone-fin').querySelector('.fin');
  verifier('l\'ecran de fin est injecte', Boolean(fin));
  verifier(
    'l\'ecran de fin annonce une victoire ou une defaite',
    Boolean(fin) && (fin.classList.contains('fin--gagne') || fin.classList.contains('fin--perdu'))
  );
  const blocStats = page.parId('zone-fin').querySelector('.fin__stats');
  const stats = blocStats
    ? blocStats.descendants().filter((el) => el.tagName === 'DT' || el.tagName === 'DD')
    : [];
  verifier(
    'l\'ecran de fin recapitule la partie',
    stats.length >= 10,
    `${stats.length} entrees`
  );
  if (fin && fin.classList.contains('fin--gagne')) {
    verifier(
      'l\'ecran de fin affiche les pieces gagnees en cas de victoire',
      stats.some((el) => el.tagName === 'DT' && el.textContent === 'Pièces gagnées'),
      stats.map((el) => `${el.tagName}:${el.textContent}`).join(', ').slice(0, 140)
    );
  }
  verifier(
    'la partie terminee est enregistree sur le serveur',
    page.requetes('enregistrer-partie') >= 1
  );
  verifier('la sauvegarde est effacee en fin de partie', page.requetes('oublier') >= 1);
  verifier('la partie a ete sauvegardee en cours de route', page.requetes('sauvegarder') >= 1);
  verifier(
    'le bouton Rejouer est propose',
    page.parId('zone-fin').querySelectorAll('button').length >= 2
  );
  return page;
}

// --- Scenario 2 : duel sur la meme machine -----------------------------------

async function scenarioDuel() {
  titre('3. Duel sur la meme machine');
  const stockage = new Stockage();
  const page = chargerPage(
    { mode: 'duel', niveau: 'normal', nomJoueur: 'Alice', nomAdversaire: 'Bob' },
    stockage
  );
  await avancerJusque(page, 300000);

  verifier('le titre annonce le duel', /duel/i.test(page.texte('titre-partie')), page.texte('titre-partie'));
  verifier(
    'les deux noms de joueurs sont affiches',
    /Alice/.test(page.texte('qui-joue')) && /Bob/.test(page.texte('qui-joue')),
    page.texte('qui-joue')
  );
  verifier('l\'etiquette de duel est visible', page.parId('cadre-duel').hidden === false);
  // L'étiquette est renseignée dès qu'un tour est rendu, mais le chargement
  // d'une nouvelle partie est asynchrone : on attend qu'elle apparaisse (ou
  // que la partie soit finie) avant de la lire, sans se limiter au premier
  // regard.
  await attendre(page, () => page.texte('tour-debouche').length > 0 || fini(page), 300000);
  verifier('l\'etiquette de duel nomme le joueur actif', page.texte('tour-debouche').length > 0, page.texte('tour-debouche'));

  // Quelques tours seulement : le but est de verifier l'affichage croise des
  // deux mains, pas de finir une deuxieme partie entiere.
  for (let i = 0; i < 12; i += 1) {
    if (fini(page)) break;
    if (!(await avancerJusque(page))) break;
    const attributs = barreAttributs(page);
    if (attributs.length > 0) attributs[0].cliquer();
    else {
      const jouables = cartesJouables(page);
      if (jouables.length === 0) break;
      jouables[0].cliquer();
    }
    await avancerJusque(page);
  }

  const mainJoueur = page.parId('main-joueur').querySelectorAll('.carte');
  const mainAdversaire = page.parId('main-adversaire').querySelectorAll('.carte');
  verifier('les deux mains contiennent des cartes', mainJoueur.length > 0 && mainAdversaire.length > 0);
  verifier(
    'la main inactive est face cachee',
    mainJoueur.length !== mainAdversaire.length ||
      mainJoueur.filter((c) => c.classList.contains('carte--cachee')).length !==
        mainAdversaire.filter((c) => c.classList.contains('carte--cachee')).length ||
      mainJoueur.every((c) => c.classList.contains('carte--cachee')) ||
      mainAdversaire.every((c) => c.classList.contains('carte--cachee')),
    `joueur cachees=${mainJoueur.filter((c) => c.classList.contains('carte--cachee')).length} / ` +
      `adversaire caches=${mainAdversaire.filter((c) => c.classList.contains('carte--cachee')).length}`
  );
  verifier('aucune erreur en duel', !page.alertes.some((a) => a[0] === 'error'), JSON.stringify(page.alertes.slice(0, 2)));
  verifier('la partie n\'est pas encore terminee', fini(page) === false);
  return { page, stockage, tour: dernierTourAffiche(page) };
}

// --- Scenario 3 : sauvegarde, reprise et abandon ------------------------------

async function scenarioReprise() {
  titre('4. Sauvegarde, reprise et abandon');
  const { page: premiere, stockage, tour } = await scenarioDuel();
  void premiere;

  verifier('la partie en cours a ete sauvegardee', premiere.requetes('sauvegarder') >= 1, `${tour}`);
  verifier('au moins un tour complet a ete joue', tour >= 1, `tour ${tour}`);

  // Nouvelle ouverture de page, meme navigateur : la sauvegarde doit remonter.
  const reprise = chargerPage(null, stockage);
  await avancerJusque(reprise, 300000);

  verifier('la page demande au serveur une sauvegarde', reprise.requetes('restaurer') >= 1);
  verifier('le bandeau de reprise est propose', reprise.parId('sauvegarde').hidden === false);
  verifier(
    'le bandeau indique quand la partie a ete sauvegardee',
    reprise.texte('sauvegarde-quand').length > 0,
    reprise.texte('sauvegarde-quand')
  );

  reprise.parId('btn-reprendre').cliquer();
  await avancerJusque(reprise, 300000);

  verifier('le bandeau disparait apres reprise', reprise.parId('sauvegarde').hidden === true);
  const repriseTour = parseInt((reprise.texte('message').match(/reprise au tour (\d+)/i) || [])[1] || '0', 10);
  verifier(
    'la page annonce la reprise a un tour plausible',
    repriseTour >= 1 && repriseTour <= 40,
    `reprise annoncee au tour ${repriseTour}, message : ${reprise.texte('message')}`
  );
  verifier('la partie reprend et se poursuit', !fini(reprise));
  verifier('aucune erreur de reprise', !reprise.alertes.some((a) => a[0] === 'error'), JSON.stringify(reprise.alertes.slice(0, 2)));

  // On joue encore un peu, pour laisser une sauvegarde aecut.
  for (let i = 0; i < 4; i += 1) {
    if (fini(reprise)) break;
    if (!(await avancerJusque(reprise))) break;
    const attributs = barreAttributs(reprise);
    if (attributs.length > 0) attributs[0].cliquer();
    else {
      const jouables = cartesJouables(reprise);
      if (jouables.length === 0) break;
      jouables[0].cliquer();
    }
    await avancerJusque(reprise);
  }

  // Nouvelle ouverture : cette fois on refuse la sauvegarde.
  const abandon = chargerPage(null, stockage);
  await avancerJusque(abandon, 300000);
  verifier('le bandeau de reprise reapparait', abandon.parId('sauvegarde').hidden === false);

  abandon.parId('btn-ignorer').cliquer();
  // La nouvelle partie ne démarre qu'après l'aller-retour « oublier » :
  // on attend qu'elle soit réellement lancée avant de vérifier.
  await attendre(abandon, () => abandon.requetes('nouvelle-partie') >= 1);
  await avancerJusque(abandon, 300000);

  verifier('le bandeau disparait apres abandon', abandon.parId('sauvegarde').hidden === true);
  verifier(
    'le jeu repart immediatement sur un tour',
    abandon.requetes('nouvelle-partie') >= 1 &&
      !fini(abandon) &&
      (abandon.texte('message') || '').length > 0,
    abandon.texte('message')
  );
  verifier('le journal repart de zero', dernierTourAffiche(abandon) <= 1, `${dernierTourAffiche(abandon)}`);
  verifier('la nouvelle partie a ete distribuee', abandon.requetes('nouvelle-partie') >= 1);
  verifier('aucune erreur apres abandon', !abandon.alertes.some((a) => a[0] === 'error'), JSON.stringify(abandon.alertes.slice(0, 2)));
}

principal().catch((e) => {
  console.error(`\nECHEC : ${e.stack || e.message}`);
  process.exit(1);
});
