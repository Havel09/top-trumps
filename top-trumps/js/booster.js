/**
 * booster.js — Boutique des boosters : affiche les offres du catalogue,
 * achète et ouvre un booster, puis révèle les cartes tirées.
 */

(() => {
  const $ = (id) => document.getElementById(id);

  let boosters = [];
  let raretes = [];
  let solde = 0;
  let occupe = false;

  document.addEventListener('DOMContentLoaded', async () => {
    try {
      const [config, inventaire] = await Promise.all([
        Api.config(),
        Portefeuille.inventaire(),
      ]);
      boosters = config.jeu.boosters || [];
      raretes = config.jeu.raretes || [];
      solde = inventaire.pieces;
      Portefeuille.afficherSolde($('zone-solde'), solde);
      construireBoutique();
    } catch (e) {
      const boutique = $('boutique');
      if (boutique) boutique.textContent = `Impossible de charger la boutique : ${e.message}`;
    }
  });

  function construireBoutique() {
    const conteneur = $('boutique');
    conteneur.textContent = '';
    for (const b of boosters) conteneur.append(creerBooster(b));
  }

  /** Une vignette de booster : icône, nom, description, chances, prix. */
  function creerBooster(b) {
    const el = creerElement('article', 'booster');
    el.dataset.cle = b.cle;

    const entete = creerElement('div', 'booster__entete');
    const icone = creerElement('span', 'booster__icone');
    icone.textContent = b.icone || '';
    icone.setAttribute('aria-hidden', 'true');
    entete.append(icone);
    entete.append(creerElement('h3', 'booster__nom', b.nom || b.cle));
    el.append(entete);

    el.append(creerElement('p', 'booster__detail', b.description || ''));

    const poids = creerElement('div', 'booster__poids');
    const totalPoids = Object.values(b.poids || {}).reduce((somme, p) => somme + p, 0);
    poids.setAttribute('aria-label', 'Chances d\'une carte par rareté');
    for (const r of raretes) {
      const poidsRarete = (b.poids || {})[r.cle] || 0;
      const pourcent = totalPoids > 0 ? Math.round((100 * poidsRarete) / totalPoids) : 0;
      const chance = creerElement('span', `booster__chance booster__chance--${r.cle}`);
      chance.style.width = `${poidsRarete > 0 ? Math.max(pourcent, 8) : 0}%`;
      chance.title = `${r.nom} : ${pourcent} %`;
      chance.textContent = pourcent > 0 ? `${pourcent} %` : '';
      poids.append(chance);
    }
    el.append(poids);

    const pied = creerElement('div', 'booster__pied');
    pied.append(creerElement('span', 'booster__prix', `${b.prix} pièces`));
    const bouton = creerElement('button', 'bouton bouton--principal', 'Ouvrir');
    bouton.type = 'button';
    bouton.disabled = solde < b.prix;
    bouton.addEventListener('click', () => ouvrir(b));
    pied.append(bouton);
    el.append(pied);
    return el;
  }

  async function ouvrir(b) {
    if (occupe) return;
    occupe = true;
    changerBoutons(true);
    try {
      const resultat = await Portefeuille.ouvrir(b.cle);
      solde = resultat.pieces;
      Portefeuille.afficherSolde($('zone-solde'), solde);
      message('');
      construireBoutique();
      afficherRevelation(resultat, b);
    } catch (e) {
      message(e.message);
    } finally {
      occupe = false;
      changerBoutons(false);
    }
  }

  /** Désactive/réactive les boutons pendant l'ouverture d'un booster. */
  function changerBoutons(desactives) {
    for (const bouton of document.querySelectorAll('.grille-boosters .bouton')) {
      bouton.disabled = desactives || bouton.disabled;
    }
  }

  /** Révèle les cartes tirées : nouvelles (or) ou doublons (remboursés). */
  function afficherRevelation(resultat, booster) {
    const titre = $('reveal-titre');
    if (titre) titre.textContent = `Vous ouvrez ${booster.nom}`;

    const gain = $('reveal-gain');
    if (gain) {
      const nouvelles = resultat.tirages.filter((t) => t.nouveau).length;
      const rembourse = resultat.tirages.reduce((somme, t) => somme + t.remboursement, 0);
      gain.textContent =
        rembourse > 0
          ? `${nouvelles} nouvelle(s) carte(s), et ${rembourse} pièces remboursées pour les doublons.`
          : `Cinq cartes en main : ${nouvelles} nouvelle(s) rejoignent votre galerie.`;
    }

    const grille = $('reveal-cartes');
    grille.textContent = '';
    for (const t of resultat.tirages) {
      const carte = creerElement('article', `reveler-carte reveler-carte--${t.carte.rarete}`);
      carte.classList.toggle('est-doublon', !t.nouveau);

      const img = creerElement('img', 'reveler-carte__image');
      img.src = t.carte.image;
      img.alt = `Illustration de ${t.carte.nom}`;
      img.loading = 'eager';
      carte.append(img);

      carte.append(creerElement('h4', 'reveler-carte__nom', t.carte.nom));
      carte.append(
        creerElement(
          'span',
          t.nouveau ? 'reveler-carte__badge est-nouvelle' : 'reveler-carte__badge est-doublon',
          t.nouveau ? 'Nouvelle carte !' : `Doublon : +${t.remboursement} pièces`
        )
      );
      grille.append(carte);
    }

    const reveal = $('reveal');
    if (reveal) reveal.hidden = false;
  }

  function message(texte) {
    const el = $('message');
    if (el) el.textContent = texte;
  }

  function creerElement(balise, classe, texte) {
    const el = document.createElement(balise);
    if (classe) el.className = classe;
    if (texte !== undefined) el.textContent = texte;
    return el;
  }
})();