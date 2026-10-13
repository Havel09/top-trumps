/**
 * regles-page.js - Génère la page « Règles » à partir de la configuration
 * du serveur.
 *
 * Aucun chiffre n'est écrit en dur dans cette page : tout vient de
 * data/cartes.json via l'API. Si la configuration change un jour, la page
 * des règles suit automatiquement, et ne peut plus devenir fausse.
 */

(() => {
  const $ = (id) => document.getElementById(id);

  document.addEventListener('DOMContentLoaded', async () => {
    let config;
    try {
      config = await Api.config();
    } catch (e) {
      $('regles').textContent = `Impossible de charger les règles : ${e.message}`;
      return;
    }

    const r = config.regles;
    const total = config.nbCartes;
    const parJoueur = r.cartes_par_joueur;
    const enJeu = Math.min(total, parJoueur * 2);
    const auPlacard = total - enJeu;

    Interface.vider($('regles'));
    $('intro').textContent =
      `Deux joueurs se partagent ${enJeu} des ${total} cartes du jeu, ` +
      `soit ${parJoueur} cartes chacun. Voici le détail.`;

    // --- Mise en place -----------------------------------------------------
    ajouter('h2', 'La mise en place');
    ajouterListe([
      `Le serveur mélange les ${total} cartes du jeu, puis en distribue ` +
        `${parJoueur} à chaque joueur.`,
      auPlacard > 0
        ? `Les ${auPlacard} cartes non distribuées restent au placard : ` +
          `elles ne font pas partie de la partie en cours.`
        : 'Toutes les cartes sont distribuées.',
      `Chaque joueur reçoit une main de ${r.main_initiale} cartes, toutes ` +
        `visibles. Après chaque tour, il complète de nouveau sa main ` +
        `jusqu'à ${r.main_initiale} cartes en piochant dans son paquet.`,
      `Le reste de son paquet est face caché : un joueur connaît le nombre ` +
        `de cartes qu'il lui reste, jamais leur contenu.`,
      `Le premier tour est tiré au sort : l'un des deux joueurs commence ` +
        `par choisir l'attribut.`,
    ]);

    // --- Déroulement d'un tour --------------------------------------------
    ajouter('h2', 'Le déroulement d\'un tour');
    ajouter('p', 'Chaque tour se déroule en trois étapes, dans cet ordre :');

    ajouter('h3', '1. Le choix de l\'attribut');
    ajouter('p',
      `Le joueur qui a remporté le tour précédent choisit l'attribut qui va ` +
      `être comparé. Au premier tour, ce choix est tiré au sort. Les ` +
      `attributs sont : ${listeAttributs(config.jeu.attributs)}.`);

    ajouter('h3', '2. Le choix des cartes');
    ajouter('p',
      'Ensuite, chaque joueur choisit à son tour la carte de sa main ' +
      `qu'il souhaite opposer sur cet attribut. Celui qui n'a pas choisi ` +
      `l'attribut regarde en premier : il ne peut donc pas choisir sa carte ` +
      `en fonction de celle de son adversaire. Dans un duel sur la même ` +
      `machine, la main de l'autre joueur reste face cachée pendant ce choix.`);

    ajouter('h3', '3. La comparaison');
    ajouter('p',
      `Les deux cartes sont retournées. La valeur la plus haute sur ` +
      `l'attribut choisi emporte le tour, et le joueur qui a remporté le ` +
      `tour précédent choisit à son tour l'attribut du tour suivant.`);

    // --- Raretés et pouvoirs ----------------------------------------------
    ajouter('h2', 'Les pouvoirs');
    ajouter('p',
      `Seules les cartes légendaires possèdent un pouvoir : il augmente de ` +
      `quelques points un attribut précis, jamais une statistique déjà à ` +
      `100. Ce bonus est indiqué sur la carte et il compte ` +
      `toujours dans la comparaison : la valeur affichée entre parenthèses ` +
      `est la valeur de base, et la valeur réellement jouée est la plus ` +
      `grande des deux.`);

    ajouter('h3', 'Les raretés');
    const tableRaretes = Interface.creer('ul', { 'liste-raretes': true });
    for (const rarete of config.jeu.raretes) {
      const li = Interface.creer('li', { 'liste-raretes__item': true });
      const pastille = Interface.creer('span', {
        pastille: true,
        [`pastille--${rarete.cle}`]: true,
      });
      pastille.setAttribute('aria-hidden', 'true');
      li.append(pastille);
      li.append(Interface.creer('strong', {}, rarete.nom));
      li.append(
        Interface.creer(
          'span',
          { 'liste-raretes__note': true },
          descriptionRarete(rarete.cle)
        )
      );
      tableRaretes.append(li);
    }
    $('regles').append(tableRaretes);

    // --- Pouvoirs actifs ---------------------------------------------------
    ajouter('h3', 'Les pouvoirs actifs');
    ajouter('p',
      `En plus de ce bonus passif, chaque légendaire porte un pouvoir ` +
      `actif : déclenché volontairement, une seule fois par partie, au ` +
      `moment où l'on pose la carte. Un bouton superposé à la carte permet ` +
      `de l'activer ; cliquer simplement sur la carte joue sans pouvoir. ` +
      `Les pouvoirs :`
    );
    const listePouvoirs = Interface.creer('ul', { 'liste-pouvoirs': true });
    for (const p of config.jeu.pouvoirs || []) {
      const li = Interface.creer('li', { 'liste-pouvoirs__item': true });
      li.append(Interface.creer('strong', {}, `${p.icone} ${p.nom} — `));
      li.append(document.createTextNode(p.description));
      listePouvoirs.append(li);
    }
    $('regles').append(listePouvoirs);
    ajouter('p',
      `L'ordinateur sait lui aussi jouer ses pouvoirs, mais il hésite selon ` +
      `son niveau : même l'Oracle ne les déclenche pas toujours au bon moment.`
    );

    // --- Égalité -----------------------------------------------------------
    ajouter('h2', 'Que se passe-t-il en cas d\'égalité ?');
    ajouter('p',
      `Si les deux cartes obtiennent exactement la même valeur, personne ne ` +
      `gagne. Les deux cartes, augmentées de celles qui étaient déjà en ` +
      `jeu, sont mises dans un « pot » et restent en jeu.`);
    ajouterListe([
      'Au tour suivant, le vainqueur emporte le pot en plus des deux ' +
        'cartes du tour.',
      `Celui qui avait choisi l'attribut le choisit aussi pour le tour ` +
        `suivant.`,
      `Pour qu'une partie ne puisse pas s'éterniser, ${r.egalite_max_consecutive} ` +
        `égalités d'affilée sont autorisées. Au-delà, la règle anti-boucle ` +
        `s'applique : toutes les cartes du pot sont détruites, le compteur ` +
        `d'égalités repart à zéro et le jeu continue.`,
    ]);
    ajouter('p',
      'C\'est la seule occasion où une carte quitte définitivement la ' +
      'partie. Le moteur compte ces cartes détruites, et la différence ' +
      'entre le nombre de cartes en jeu et le total de la collection permet ' +
      'de le vérifier à tout moment.');

    ajouter('h2', 'Que devient une carte perdue ?');
    ajouter('p',
      `Une carte perdue part au bas du paquet du vainqueur, face cachée, ` +
      `avec les autres cartes du pot. Elle n'est donc jamais éliminée : elle ` +
      `reviendra en jeu dès que le vainqueur piochera, et le perdant pourra ` +
      `la récupérer plus tard.`);
    ajouter('p',
      `Ce recyclage est ce qui donne sa durée à une partie. Le paquet du ` +
      `vainqueur s'épaissit à chaque victoire, mais le perdant puise ` +
      `dedans à chaque tour : un joueur qui perd beaucoup de tours finit ` +
      `par n'avoir plus rien à piocher, et sa main diminue tour après tour.`);

    // --- Événements --------------------------------------------------------
    ajouter('h2', 'Les événements aléatoires');
    ajouter('p',
      `Tous les ${r.evenement_tous} tours, un événement s'abat sur la table ` +
      `pour un seul tour. Il est annoncé en haut de l'écran, et rappelle ses ` +
      `effets au moment de la comparaison. Les événements :`
    );
    const listeEvenements = Interface.creer('ul', { 'liste-evenements': true });
    for (const e of config.jeu.evenements || []) {
      const li = Interface.creer('li', { 'liste-evenements__item': true });
      li.append(Interface.creer('strong', {}, `${e.icone} ${e.nom} — `));
      li.append(document.createTextNode(e.description));
      listeEvenements.append(li);
    }
    $('regles').append(listeEvenements);
    ajouter('p',
      `Un événement ne dure qu'un tour : il disparaît dès le tour suivant, ` +
      `même s'il a bouleversé le pot ou la pioche.`);

    // --- Fin de partie -----------------------------------------------------
    ajouter('h2', 'Comment gagne-t-on ?');
    ajouter('p',
      `La partie s'arrête dès qu'un joueur n'a plus aucune carte à jouer : ` +
      `plus rien en main, plus rien dans son paquet, et aucune carte en ` +
      `attente au pot. Le joueur qui en reste possède la victoire.`);
    ajouter('p',
      `Chaque tour remporté rapporte des points, cumulés jusqu'à la fin. ` +
      `La partie terminée est ensuite ajoutée au classement, où le score ne ` +
      `dépend pas des points mais de la vitesse : gagner en 12 tours vaut ` +
      `mieux que gagner en 60.`);

    ajouter('h3', `L'arbitre, au bout de ${r.tours_max} tours`);
    ajouter('p',
      `Puisque les cartes perdues reviennent en jeu, il est possible que ` +
      `les deux camps se valent longtemps sans que personne n'arrive à ` +
      `court de cartes. Pour que la partie ne s'éternise pas, un arbitre ` +
      `intervient au bout de ${r.tours_max} tours. Il déclare vainqueur le ` +
      `joueur qui a le plus de points ; à points égaux, celui qui possède ` +
      `le plus de cartes ; à cartes égales, celui qui avait la main.`);
    ajouter('p',
      `En pratique, l'arbitre a très rarement besoin d'intervenir : le ` +
      `banc d'essai du projet le joue des milliers de parties complètes, et ` +
      `la grande majorité se termine par l'épuisement des cartes d'un ` +
      `joueur, bien avant la limite.`);

    // --- Modes -------------------------------------------------------------
    ajouter('h2', 'Les modes de jeu');
    ajouter('h3', 'Contre l\'ordinateur');
    ajouter('p',
      'Trois niveaux de difficulté. L\'ordinateur ne regarde jamais votre ' +
      'main : il ne connaît que les cartes qu\'il possède lui-même. Comme ' +
      'le nombre de cartes en jeu est connu, il en déduit votre main par ' +
      'soustraction, et sait donc en moyenne ce qu\'il aura à affronter. ' +
      'Le niveau Novice, lui, ne fait ni ce calcul ni le moindre effort : ' +
      'il joue au hasard.');
    const listeNiveaux = Interface.creer('ul', { 'liste-niveaux': true });
    for (const cle of Object.keys(Ia.NIVEAUX)) {
      const n = Ia.NIVEAUX[cle];
      const li = Interface.creer('li', {});
      li.append(Interface.creer('strong', {}, n.nom));
      li.append(
        Interface.creer(
          'span',
          { 'liste-niveaux__detail': true },
          ` — ${n.description}`
        )
      );
      listeNiveaux.append(li);
    }
    $('regles').append(listeNiveaux);

    ajouter('h3', 'Deux joueurs sur la même machine');
    ajouter('p',
      `Chaque joueur prend le tour de l'autre. Le jeu masque la main de ` +
      `celui qui ne joue pas, et annonce toujours à l'écran à qui ` +
      `appartient le tour : la main cachée, c'est ce qui rend la partie ` +
      `honnête.`);

    ajouter('h3', 'Sauvegarde');
    ajouter('p',
      `La partie en cours est enregistrée automatiquement après chaque tour, ` +
      `sur le serveur. Si vous fermez l'onglet, vous la retrouvez au retour, ` +
      `au tour exact où vous l'aviez laissée.`);
  });

  function ajouter(balise, texte) {
    const el = Interface.creer(balise, {}, texte);
    $('regles').append(el);
    return el;
  }

  function ajouterListe(textes) {
    const ul = Interface.creer('ul', { 'document__liste': true });
    for (const texte of textes) {
      ul.append(Interface.creer('li', {}, texte));
    }
    $('regles').append(ul);
    return ul;
  }

  function listeAttributs(attributs) {
    return attributs.map((a) => a.nom.toLowerCase()).join(', ');
  }

  function descriptionRarete(cle) {
    return {
      commun: '— la majorité du jeu.',
      rare: `— plus robustes qu'elles n'en ont l'air.`,
      epique: '— réservées aux vrais dangers.',
      legendaire: '— les plus redoutables du bestiaire.',
    }[cle] || '';
  }
})();
