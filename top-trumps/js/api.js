/**
 * api.js - Seul point de contact avec le serveur PHP.
 *
 * Tout le reste du code appelle des fonctions de ce fichier plutôt que
 * fetch() directement. Deux intérêts : les erreurs sont traitées une seule
 * fois, et si l'API change un jour, un seul fichier est à modifier.
 *
 * Convention : l'action voyagera toujours dans le paramètre `action`, et
 * les paramètres supplémentaires dans des clés séparées. Les successeurs
 * ne font jamais partie de la valeur de `action`, sinon le serveur les
 * recevrait collés au nom de l'action.
 */

const Api = (() => {
  // Volontairement pas nommé `URL` : ce nom masquerait le constructeur global
  // du même nom, et `new URL(...)` lèverait alors une erreur dès le premier
  // appel.
  const CHEMIN = 'php/api.php';

  /** Erreur renvoyée par l'API, avec le message lisible déjà extrait. */
  class ErreurApi extends Error {
    constructor(message, code) {
      super(message);
      this.name = 'ErreurApi';
      this.code = code;
    }
  }

  /**
   * @param {string} action          action demandée au routeur PHP
   * @param {object} parametres      paramètres ajoutés à la requête
   * @param {object} options         options fetch (méthode, corps...)
   */
  async function appeler(action, parametres = {}, options = {}) {
    const url = new URL(CHEMIN, window.location.href);
    url.searchParams.set('action', action);
    for (const [nom, valeur] of Object.entries(parametres)) {
      if (valeur === undefined || valeur === null || valeur === '') continue;
      url.searchParams.set(nom, String(valeur));
    }

    let reponse;
    try {
      reponse = await fetch(url, options);
    } catch (e) {
      throw new ErreurApi(
        'Le serveur ne répond pas. Vérifie que PHP est bien lancé ' +
        '(dans un terminal, à la racine du projet : php -S localhost:8000).',
        0
      );
    }

    let donnees = null;
    try {
      donnees = await reponse.json();
    } catch (e) {
      throw new ErreurApi(
        `Réponse illisible du serveur (code ${reponse.status}).`,
        reponse.status
      );
    }

    if (!reponse.ok || donnees.ok === false) {
      throw new ErreurApi(
        donnees.erreur || `Erreur ${reponse.status}`,
        reponse.status
      );
    }
    return donnees;
  }

  function poster(action, charge) {
    return appeler(
      action,
      {},
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...charge }),
      }
    );
  }

  return {
    ErreurApi,

    /** Paramètres du jeu : attributs, raretés, règles. */
    config: () => appeler('config'),

    /** Catalogue complet des cartes. */
    cartes: () => appeler('cartes'),

    /**
     * Demande une nouvelle distribution.
     * @param {'ia'|'duel'} mode
     * @param {number} tailleMain nombre de cartes visibles en début de tour
     */
    nouvellePartie: (mode, tailleMain) =>
      appeler('nouvelle-partie', { mode, tailleMain }),

    /** Enregistre une partie terminée et renvoie le score + le classement. */
    enregistrerPartie: (resume) => poster('enregistrer-partie', resume),

    /** Classement général, ou celui d'un joueur précis. */
    classement: (joueur = '') => appeler('classement', { joueur }),

    /** Met une partie en cours de côté, pour la retrouver plus tard. */
    sauvegarder: (jeton, etat) => poster('sauvegarder', { jeton, etat }),

    /** Relit une partie sauvegardée. */
    restaurer: (jeton) => appeler('restaurer', { jeton }),

    /** Supprime une sauvegarde. */
    oublier: (jeton) => poster('oublier', { jeton }),

    /** Inventaire du joueur : pièces et cartes possédées (jeton du navigateur). */
    inventaire: (jeton) => appeler('inventaire', { jeton }),

    /** Ouvre un booster (cle du catalogue jeu.boosters) et renvoie les tirages. */
    ouvrirBooster: (jeton, cle) => poster('ouvrir-booster', { jeton, booster: cle }),
  };
})();
