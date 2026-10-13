/**
 * portefeuille.js — Pièces et collection du joueur.
 *
 * Le portefeuille (pièces + cartes possédées) est stocké côté serveur,
 * repéré par un jeton propre au navigateur — le même que celui des
 * sauvegardes de partie. Les pages qui affichent des pièces ou des cartes
 * possédées passent toutes par ce module.
 */

const Portefeuille = (() => {
  const CLE_JETON = 'toptrumps-jeton';

  let jetonMemo = null;

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

  /** Jeton stable par navigateur, partagé avec les sauvegardes de partie. */
  function jeton() {
    if (jetonMemo) return jetonMemo;
    let valeur = lirePreference(CLE_JETON);
    if (!valeur) {
      valeur = `J${Math.random().toString(36).slice(2, 8)}`;
      ecrirePreference(CLE_JETON, valeur);
    }
    jetonMemo = valeur;
    return jetonMemo;
  }

  /** Inventaire serveur : pièces, cartes possédées, total du catalogue. */
  async function inventaire() {
    return Api.inventaire(jeton());
  }

  /** Achat + ouverture d'un booster (cle du catalogue jeu.boosters). */
  async function ouvrir(cle) {
    return Api.ouvrirBooster(jeton(), cle);
  }

  /**
   * Remplit le composant « solde de pièces » d'une page (`.solde` avec un
   * span `.solde__nombre`). Construit le balisage s'il n'existe pas encore,
   * puis affiche le solde passé (ou celui du serveur si `pieces` est null).
   */
  async function afficherSolde(conteneur, pieces = null) {
    if (!conteneur) return;
    conteneur.classList.add('solde');
    if (!conteneur.querySelector('.solde__nombre')) {
      conteneur.innerHTML =
        '<svg class="solde__icone" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" ' +
        'fill="currentColor" focusable="false" aria-hidden="true">' +
        '<circle cx="12" cy="12" r="9.5"/><circle cx="12" cy="12" r="6.5"/>' +
        '<path d="M12 6.8 L13.4 10.2 L17 10.3 L14.2 12.5 L15.3 16 L12 13.9 L8.7 16 ' +
        'L9.8 12.5 L7 10.3 L10.6 10.2 Z"/></svg>' +
        '<span class="solde__nombre">…</span> <span class="solde__libelle">pièces</span>';
    }
    const nombre = conteneur.querySelector('.solde__nombre');
    if (!nombre) return;
    let valeur = pieces;
    if (valeur === null || valeur === undefined) {
      try {
        valeur = (await inventaire()).pieces;
      } catch (e) {
        valeur = '—';
      }
    }
    nombre.textContent = String(valeur);
  }

  return { jeton: jeton, inventaire, ouvrir, afficherSolde };
})();