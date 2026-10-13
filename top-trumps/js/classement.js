/**
 * classement.js — Page du classement.
 *
 * Le classement est calculé côté serveur (php/api.php, action « classement »)
 * à partir de l'historique des parties enregistrées dans data/parties.json.
 */

(() => {
  const $ = (id) => document.getElementById(id);

  document.addEventListener('DOMContentLoaded', async () => {
    $('btn-suivre').addEventListener('click', () => {
      const nom = ($('nom-suivi').value || '').trim();
      if (nom.length < 2) {
        $('nom-suivi').focus();
        return;
      }
      try {
        localStorage.setItem('toptrumps-nom', nom);
      } catch (e) {
        /* ignore */
      }
      charger(nom);
    });

    const nom = (() => {
      try {
        return localStorage.getItem('toptrumps-nom') || '';
      } catch (e) {
        return '';
      }
    })();
    $('nom-suivi').value = nom;
    charger(nom);
  });

  async function charger(nom = '') {
    let reponse;
    try {
      reponse = await Api.classement(nom);
    } catch (e) {
      $('corps-classement').textContent = '';
      $('resume-classement').textContent = `Impossible de charger le classement : ${e.message}`;
      return;
    }

    const { joueurs, total, moi } = reponse.classement;
    $('resume-classement').textContent = total
      ? `${total} partie${total > 1 ? 's' : ''} enregistrée${total > 1 ? 's' : ''}, ${joueurs.length} joueur${joueurs.length > 1 ? 's' : ''}.`
      : "Aucune partie enregistrée pour l'instant. Jouez, et votre nom apparaîtra ici.";

    afficherMesStats(moi);
    afficherTableau(joueurs);
  }

  function afficherMesStats(moi) {
    const bloc = $('mes-stats');
    Interface.vider(bloc);
    if (!moi) {
      bloc.hidden = true;
      return;
    }
    bloc.hidden = false;

    const dl = Interface.creer('dl', { 'mes-stats__liste': true });
    const lignes = [
      ['Rang', String(moi.rang)],
      ['Score cumulé', String(moi.score)],
      ['Parties jouées', String(moi.parties)],
      ['Victoires', String(moi.victoires)],
      ['Défaites', String(moi.defaites)],
      ['Taux de réussite', `${moi.ratio} %`],
      ['Meilleure série', String(moi.meilleureSerie)],
      ['Tours moyens', String(moi.moyenneTours)],
    ];
    for (const [cle, valeur] of lignes) {
      dl.append(Interface.creer('dt', {}, cle));
      dl.append(Interface.creer('dd', {}, valeur));
    }
    bloc.append(dl);
  }

  function afficherTableau(joueurs) {
    const corps = $('corps-classement');
    Interface.vider(corps);

    if (joueurs.length === 0) {
      const tr = Interface.creer('tr', {});
      const td = Interface.creer('td', { 'tableau-vide': true },
        'Personne n\'a encore joué. Soyez le premier.');
      td.colSpan = 8;
      tr.append(td);
      corps.append(tr);
      return;
    }

    for (const joueur of joueurs) {
      const tr = Interface.creer('tr', {});
      if (joueur.rang <= 3) tr.classList.add(`ligne-or-${joueur.rang}`);

      tr.append(Interface.creer('td', {}, String(joueur.rang)));
      tr.append(Interface.creer('th', { 'cellule-nom': true }, joueur.joueur).setAttribute('scope', 'row'));
      tr.append(Interface.creer('td', {}, String(joueur.score)));
      tr.append(Interface.creer('td', {}, String(joueur.victoires)));
      tr.append(Interface.creer('td', {}, String(joueur.parties)));
      tr.append(Interface.creer('td', {}, `${joueur.ratio} %`));
      tr.append(Interface.creer('td', {}, String(joueur.meilleureSerie)));
      tr.append(Interface.creer('td', {}, String(joueur.moyenneTours)));
      corps.append(tr);
    }
  }
})();
