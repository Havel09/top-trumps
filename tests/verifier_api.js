'use strict';
/**
 * verifier_api.js - Verifie le serveur PHP de bout en bout, sans navigateur.
 *
 * On appelle chaque action de php/api.php dans l'ordre ou la page de jeu
 * les utilise, et on verifie que la reponse a la forme attendue. Un
 * serveur qui repond 200 mais renvoie un paquet vide, ou un pioche sans
 * cartes, casserait la partie sans jamais lever d'erreur visible.
 *
 * Lancement :  node tests/verifier_api.js [http://127.0.0.1:8123]
 */

const BASE = (process.argv[2] || 'http://127.0.0.1:8123').replace(/\/$/, '');
const API = `${BASE}/php/api.php`;

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

async function appeler(action, entree = {}) {
  const reponse = await fetch(`${API}?action=${encodeURIComponent(action)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(entree),
  });
  const texte = await reponse.text();
  let donnees;
  try {
    donnees = JSON.parse(texte);
  } catch {
    throw new Error(
      `${action} : reponse illisible (${reponse.status}) -> ${texte.slice(0, 200)}`
    );
  }
  if (!reponse.ok) {
    throw new Error(`${action} : HTTP ${reponse.status} -> ${JSON.stringify(donnees)}`);
  }
  return donnees;
}

async function principal() {
  console.log(`Verification de l'API sur ${API}\n`);

  // --- config -------------------------------------------------------------
  const config = await appeler('config');
  verifier('config : ok', config.ok === true);
  verifier('config : jeu present', Boolean(config.jeu && config.jeu.nom));
  verifier(
    'config : au moins 4 attributs',
    Array.isArray(config.jeu.attributs) && config.jeu.attributs.length >= 4,
    `trouve ${config.jeu.attributs && config.jeu.attributs.length}`
  );
  verifier('config : regles presentes', Boolean(config.regles));
  verifier(
    'config : tours_max present',
    Number.isInteger(config.regles && config.regles.tours_max),
    JSON.stringify(config.regles)
  );
  verifier(
    'config : evenement_tous present',
    Number.isInteger(config.regles && config.regles.evenement_tous),
    JSON.stringify(config.regles)
  );
  verifier(
    'config : pouvoirs actifs catalogues',
    Array.isArray(config.jeu.pouvoirs) &&
      config.jeu.pouvoirs.length >= 1 &&
      config.jeu.pouvoirs.every((p) => p.cle && p.nom && p.icone && p.description),
    JSON.stringify(config.jeu.pouvoirs || []).slice(0, 140)
  );
  verifier(
    'config : evenements catalogues',
    Array.isArray(config.jeu.evenements) &&
      config.jeu.evenements.length >= 1 &&
      config.jeu.evenements.every((e) => e.cle && e.nom && e.icone && e.description),
    JSON.stringify(config.jeu.evenements || []).slice(0, 140)
  );
  verifier(
    'config : boosters catalogues',
    Array.isArray(config.jeu.boosters) &&
      config.jeu.boosters.length >= 1 &&
      config.jeu.boosters.every(
        (b) => b.cle && b.nom && b.icone && Number.isInteger(b.prix) && b.prix > 0
      ),
    JSON.stringify(config.jeu.boosters || []).slice(0, 140)
  );
  verifier(
    'config : raretes remboursables',
    Array.isArray(config.jeu.raretes) &&
      config.jeu.raretes.every(
        (r) => Number.isInteger(r.remboursement) && r.remboursement > 0
      ),
    JSON.stringify(config.jeu.raretes || []).slice(0, 140)
  );
  console.log(
    `          -> ${config.nbCartes} cartes, ${config.jeu.attributs.length} attributs, ` +
      `bareme de base ${config.regles.score_victoire}`
  );

  // --- cartes -------------------------------------------------------------
  const cartes = await appeler('cartes');
  verifier('cartes : ok', cartes.ok === true);
  const liste = cartes.cartes || [];
  verifier('cartes : au moins 20', liste.length >= 20, `trouve ${liste.length}`);
  verifier(
    'cartes : au moins 4 attributs numeriques par carte',
    liste.every(
      (c) => Object.values(c.attributs || {}).filter((v) => typeof v === 'number').length >= 4
    )
  );
  verifier(
    'cartes : nom, image et description pour chaque carte',
    liste.every((c) => c.nom && c.image && c.description)
  );
  verifier(
    'cartes : seules les legendaires ont un pouvoir chiffre',
    liste.every(
      (c) =>
        c.rarete === 'legendaire'
          ? c.pouvoir &&
            c.pouvoir.nom &&
            typeof c.pouvoir.bonus === 'number' &&
            c.pouvoir.attribut in c.attributs
          : !c.pouvoir
    )
  );
  verifier(
    'cartes : identifiants uniques',
    new Set(liste.map((c) => c.id)).size === liste.length
  );
  const pouvoirsActifs = (config.jeu.pouvoirs || []).map((p) => p.cle);
  verifier(
    'cartes : seules les legendaires ont une capacite du catalogue',
    liste.every(
      (c) =>
        c.rarete === 'legendaire'
          ? Boolean(c.pouvoir_actif) && pouvoirsActifs.includes(c.pouvoir_actif)
          : !c.pouvoir_actif
    ),
    JSON.stringify(
      liste
        .filter(
          (c) =>
            (c.rarete !== 'legendaire' && c.pouvoir_actif) ||
            (c.rarete === 'legendaire' &&
              (!c.pouvoir_actif || !pouvoirsActifs.includes(c.pouvoir_actif)))
        )
        .map((c) => c.id)
    )
  );
  for (const image of liste.slice(0, 3)) {
    const reponse = await fetch(`${BASE}/${image.image}`);
    verifier(`image accessible : ${image.image}`, reponse.ok, `HTTP ${reponse.status}`);
  }

  // --- nouvelle-partie ----------------------------------------------------
  const parJoueur = config.regles.cartes_par_joueur;
  const taille = config.regles.main_initiale;
  const nouvelle = await appeler('nouvelle-partie', { mode: 'ia' });
  verifier('nouvelle-partie : ok', nouvelle.ok === true);
  verifier('nouvelle-partie : main_initiale', nouvelle.main_initiale === taille);
  for (const cote of ['joueur', 'adversaire']) {
    const joueur = nouvelle.joueurs && nouvelle.joueurs[cote];
    verifier(
      `nouvelle-partie : main de ${cote} a ${taille} cartes`,
      Boolean(joueur) && joueur.main.length === taille,
      joueur ? `main=${joueur.main.length}` : 'absent'
    );
    // Le paquet doit contenir de vraies cartes : une distribution qui
    // renverrait un simple nombre empecherait toute reprise de partie.
    verifier(
      `nouvelle-partie : paquet de ${cote} rempli de vraies cartes`,
      Boolean(joueur) &&
        Array.isArray(joueur.pioche) &&
        joueur.pioche.length === parJoueur - taille &&
        joueur.pioche.every((c) => c && typeof c.id !== 'undefined'),
      joueur ? `pioche=${JSON.stringify(joueur.pioche).slice(0, 80)}` : 'absent'
    );
  }
  const toutes = [
    ...nouvelle.joueurs.joueur.main,
    ...nouvelle.joueurs.joueur.pioche,
    ...nouvelle.joueurs.adversaire.main,
    ...nouvelle.joueurs.adversaire.pioche,
  ];
  verifier(
    'nouvelle-partie : 2 x cartes_par_joueur distribuees',
    toutes.length === parJoueur * 2,
    `${toutes.length} cartes`
  );
  verifier(
    'nouvelle-partie : aucune carte dupliquee',
    new Set(toutes.map((c) => c.id)).size === toutes.length
  );

  // --- duel ---------------------------------------------------------------
  const duel = await appeler('nouvelle-partie', { mode: 'duel' });
  verifier('duel : ok', duel.ok === true);
  verifier(
    'duel : deux mains',
    Boolean(duel.joueurs && duel.joueurs.joueur && duel.joueurs.adversaire)
  );

  // --- classement / enregistrement ---------------------------------------
  // Le nom est volontairement court : le serveur le tronque a 20 caracteres,
  // et un identifiant plus long reviendrait amputé. Le classement le
  // retrouverait alors sous une forme differente de celle envoyee, et la
  // verification echouerait pour une raison qui n'a rien a voir avec le jeu.
  const marqueur = `verif${Date.now().toString(36).slice(-6)}`;
  const enregistre = await appeler('enregistrer-partie', {
    joueur: marqueur,
    adversaire: 'Tacticien',
    mode: 'ia',
    tours: 12,
    victoire: true,
    cartesRestantes: 8,
    duree: 90,
  });
  verifier('enregistrer-partie : ok', enregistre.ok === true);
  verifier(
    'enregistrer-partie : score calcule',
    Number.isInteger(enregistre.score),
    `score=${enregistre.score}`
  );
  verifier(
    'enregistrer-partie : une victoire vaut plus que zero',
    enregistre.score > 0,
    `score=${enregistre.score}`
  );

  const classement = await appeler('classement', { joueur: marqueur });
  verifier('classement : ok', classement.ok === true);
  verifier(
    'classement : la liste est un tableau',
    Array.isArray(classement.classement.joueurs),
    JSON.stringify(classement.classement).slice(0, 80)
  );
  verifier(
    'classement : le joueur vient d y figurer',
    classement.classement.joueurs.some((l) => l.joueur === marqueur)
  );
  verifier(
    'classement : ma propre ligne est fournie',
    Boolean(classement.classement.moi && classement.classement.moi.joueur === marqueur)
  );
  verifier(
    'classement : les rangs se suivent sans trou',
    classement.classement.joueurs.every((l, i) => l.rang === i + 1)
  );
  verifier(
    'classement : le total est un nombre',
    Number.isInteger(classement.classement.total)
  );
  verifier(
    'classement : une ligne resume chaque joueur',
    classement.classement.joueurs.every(
      (l) => Number.isInteger(l.parties) && Number.isInteger(l.victoires)
    )
  );

  // --- sauvegarde / restauration -----------------------------------------
  const instantane = {
    mode: 'ia',
    libelles: Object.fromEntries(config.jeu.attributs.map((a) => [a.cle, a.nom])),
    attributs: config.jeu.attributs.map((a) => a.cle),
    tailleMain: taille,
    egaliteMax: config.regles.egalite_max_consecutive,
    toursMax: config.regles.tours_max,
    joueurs: nouvelle.joueurs,
    tour: 4,
    totalTours: 3,
    chooser: 'joueur',
    carteJouee: { joueur: null, adversaire: null },
    attributChoisi: null,
    egalites: 0,
    pot: [],
    detruites: 0,
    score: { joueur: 30, adversaire: 12 },
    phase: 'attribut',
    dernierTour: null,
    gagnant: null,
    journal: [],
  };
  // Le nom du joueur sert aussi de jeton de sauvegarde : c'est ainsi que la
  // page de jeu retrouve une partie interrompue.
  const garde = await appeler('sauvegarder', { jeton: marqueur, etat: instantane });
  verifier('sauvegarder : ok', garde.ok === true);

  const relu = await appeler('restaurer', { jeton: marqueur });
  verifier('restaurer : ok', relu.ok === true);
  verifier('restaurer : la sauvegarde est retrouvee', relu.trouve === true);
  verifier('restaurer : la partie revient', Boolean(relu.etat && relu.etat.joueurs));
  verifier(
    'restaurer : le contenu du paquet est conserve',
    Array.isArray(relu.etat.joueurs.joueur.pioche) &&
      relu.etat.joueurs.joueur.pioche.length > 0,
    JSON.stringify(relu.etat.joueurs.joueur.pioche || []).slice(0, 60)
  );
  verifier(
    'restaurer : les scores sont conserves',
    relu.etat.score.joueur === 30 && relu.etat.score.adversaire === 12
  );
  verifier(
    'restaurer : les regles sont conservees',
    relu.etat.toursMax === config.regles.tours_max &&
      relu.etat.egaliteMax === config.regles.egalite_max_consecutive
  );

  const oublie = await appeler('oublier', { jeton: marqueur });
  verifier('oublier : ok', oublie.ok === true);
  const apresOubli = await appeler('restaurer', { jeton: marqueur });
  verifier('oublier : la sauvegarde a disparu', apresOubli.trouve === false);

  // --- portefeuille : pièces et boosters ----------------------------------
  const jetonPorte = `P${Date.now().toString(36).slice(-6)}`;
  const inv = await appeler('inventaire', { jeton: jetonPorte });
  verifier('inventaire : ok', inv.ok === true);
  verifier(
    'inventaire : le bonus de bienvenue est offert',
    inv.pieces === 100,
    `pieces=${inv.pieces}`
  );
  verifier(
    'inventaire : collection vide au depart',
    typeof inv.cartes === 'object' && Object.keys(inv.cartes).length === 0
  );
  verifier(
    'inventaire : le total du catalogue est fourni',
    inv.total === liste.length,
    `total=${inv.total}`
  );

  const invDeux = await appeler('inventaire', { jeton: jetonPorte });
  verifier(
    'inventaire : le solde est stable d un appel a l autre',
    inv.pieces === invDeux.pieces,
    `avant=${inv.pieces} apres=${invDeux.pieces}`
  );

  const prixBase = (config.jeu.boosters.find((b) => b.cle === 'base') || {}).prix;
  const ouvert = await appeler('ouvrir-booster', { jeton: jetonPorte, booster: 'base' });
  verifier('ouvrir-booster : ok', ouvert.ok === true);
  verifier(
    'ouvrir-booster : le prix est debite',
    ouvert.pieces === inv.pieces - prixBase,
    `pieces=${ouvert.pieces} attendu=${inv.pieces - prixBase}`
  );
  verifier(
    'ouvrir-booster : cinq cartes tirees',
    Array.isArray(ouvert.tirages) && ouvert.tirages.length === 5,
    `tirages=${Array.isArray(ouvert.tirages) ? ouvert.tirages.length : 'absent'}`
  );
  verifier(
    'ouvrir-booster : chaque tirage est une vraie carte',
    ouvert.tirages.every(
      (t) => t.carte && typeof t.carte.id !== 'undefined' && typeof t.nouveau === 'boolean'
    )
  );
  verifier(
    'ouvrir-booster : le solde rendu est coherent avec les remboursements',
    ouvert.pieces ===
      inv.pieces - prixBase +
        ouvert.tirages.reduce((somme, t) => somme + t.remboursement, 0),
    `pieces=${ouvert.pieces}`
  );

  let pauvre = null;
  try {
    await appeler('ouvrir-booster', { jeton: jetonPorte, booster: 'epique' });
  } catch (e) {
    pauvre = { ok: false, erreur: e.message };
  }
  verifier(
    'ouvrir-booster : pieces insuffisantes refusees',
    pauvre && pauvre.ok === false && /insuffisantes/i.test(pauvre.erreur),
    JSON.stringify(pauvre)
  );

  const credit = await appeler('enregistrer-partie', {
    joueur: marqueur,
    adversaire: 'Tacticien',
    mode: 'ia',
    tours: 12,
    victoire: true,
    cartesRestantes: 8,
    duree: 90,
    jeton: jetonPorte,
  });
  verifier(
    'enregistrer-partie : une victoire rapporte des pieces',
    Number.isInteger(credit.piecesGagnees) && credit.piecesGagnees > 0,
    `piecesGagnees=${credit.piecesGagnees}`
  );
  const apresCredit = await appeler('inventaire', { jeton: jetonPorte });
  verifier(
    'enregistrer-partie : les pieces creditees apparaissent au solde',
    apresCredit.pieces === ouvert.pieces + credit.piecesGagnees,
    `solde=${apresCredit.pieces}`
  );
  verifier(
    'enregistrer-partie : les cartes du booster sont dans la collection',
    apresCredit.nombre >= 1,
    `nombre=${apresCredit.nombre}`
  );

  // --- erreurs ------------------------------------------------------------
  // Une action inconnue doit etre refusee, mais avec un code HTTP : c'est
  // ainsi qu'un client detecte l'erreur sans avoir a deviner.
  let inconnue = null;
  try {
    inconnue = await appeler('action-qui-nexiste-pas');
  } catch (e) {
    inconnue = { ok: false, erreur: e.message };
  }
  verifier(
    'action inconnue : erreur explicite',
    inconnue.ok === false && /inconnue/i.test(inconnue.erreur || ''),
    JSON.stringify(inconnue)
  );

  console.log(`\n${reussites} verification(s) reussie(s), ${echecs.length} echec(s).`);
  if (echecs.length > 0) {
    for (const ligne of echecs) console.log(`  - ${ligne}`);
    process.exit(1);
  }
  console.log('OK : le serveur repond correctement a toutes les actions.');
}

principal().catch((e) => {
  console.error(`\nECHEC : ${e.message}`);
  process.exit(1);
});
