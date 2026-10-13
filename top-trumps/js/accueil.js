/**
 * accueil.js — Page d'accueil : choix du mode et des joueurs.
 *
 * Le formulaire n'apparaît qu'une fois un mode sélectionné, pour ne pas
 * demander un nom de second joueur quand on joue contre l'ordinateur.
 * Les choix sont conservés dans localStorage : le retour au menu ne fait
 * pas tout perdre.
 */

(() => {
  const CLE_JOUEUR = 'toptrumps-nom';
  const CLE_ADVERSAIRE = 'toptrumps-adversaire';
  const CLE_OPTIONS = 'toptrumps-options';
  const CLE_NIVEAU = 'toptrumps-niveau';

  const $ = (id) => document.getElementById(id);

  let mode = 'ia';

  document.addEventListener('DOMContentLoaded', init);

  function init() {
    afficherVersion();
    afficherSolde();

    // Mode retenu lors de la partie précédente, sinon duel par défaut.
    mode = lire(CLE_OPTIONS, null)?.mode || 'duel';
    marquerMode(mode);

    for (const bouton of document.querySelectorAll('.mode')) {
      bouton.addEventListener('click', () => {
        choisirMode(bouton.dataset.mode);
      });
    }

    const formulaire = $('config');
    formulaire.addEventListener('submit', lancer);
  }

  function afficherVersion() {
    const el = $('version-jeu');
    if (!el) return;
    Api.config()
      .then((config) => {
        el.textContent = `${config.jeu.nom} — version ${config.jeu.version}, ${config.nbCartes} cartes.`;
      })
      .catch(() => {
        el.textContent = '';
      });
  }

  /** Solde de pièces affiché dans l'en-tête, via le portefeuille serveur. */
  function afficherSolde() {
    const el = $('solde-pieces');
    if (!el) return;
    Portefeuille.inventaire()
      .then((inv) => {
        el.textContent = String(inv.pieces);
      })
      .catch(() => {
        el.textContent = '—';
      });
  }

  function choisirMode(nouveau) {
    mode = nouveau;
    marquerMode(nouveau);
    $('formulaire').hidden = false;
    $('champ-niveau').hidden = nouveau !== 'ia';
    $('champ-adversaire').hidden = nouveau !== 'duel';
  }

  function marquerMode(choisi) {
    for (const bouton of document.querySelectorAll('.mode')) {
      const actif = bouton.dataset.mode === choisi;
      bouton.classList.toggle('est-actif', actif);
      bouton.setAttribute('aria-pressed', String(actif));
    }
  }

  function lancer(evenement) {
    evenement.preventDefault();

    const nom = ($('nom-joueur').value || '').trim();
    const adversaire = ($('nom-adversaire').value || '').trim();
    const niveau = document.querySelector('input[name="niveau"]:checked');

    if (nom.length < 2) {
      $('nom-joueur').focus();
      $('nom-joueur').setCustomValidity('Il faut au moins deux caractères.');
      $('nom-joueur').reportValidity();
      return;
    }

    ecrire(CLE_JOUEUR, nom);
    ecrire(CLE_ADVERSAIRE, adversaire);
    ecrire(CLE_NIVEAU, niveau ? niveau.value : 'normal');
    ecrire(CLE_OPTIONS, JSON.stringify({
      mode,
      niveau: niveau ? niveau.value : 'normal',
      nomJoueur: nom,
      nomAdversaire: adversaire,
    }));

    window.location.href = 'jeu.html';
  }

  function lire(cle, defaut) {
    try {
      const brut = localStorage.getItem(cle);
      return brut === null ? defaut : JSON.parse(brut);
    } catch (e) {
      return defaut;
    }
  }

  function ecrire(cle, valeur) {
    try {
      localStorage.setItem(cle, typeof valeur === 'string' ? valeur : JSON.stringify(valeur));
    } catch (e) {
      /* navigation privée : le jeu fonctionnera quand même */
    }
  }
})();
