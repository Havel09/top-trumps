/**
 * audio.js - Bruitage du jeu, sans aucun fichier son.
 *
 * Tout est synthétisé à la volée avec l'API Web Audio : deux oscillateurs,
 * une enveloppe de volume, et c'est tout. Cela évite d'embarquer des
 * fichiers binaires dans le projet, et le poids reste nul.
 *
 * Le son est coupé tant que l'utilisateur n'a pas cliqué quelque part :
 * les navigateurs bloquent le son avant la première interaction.
 */

const Son = (() => {
  let contexte = null;
  let actif = true;

  const CLE = 'toptrumps-son';
  const MOTS = {
    clic:  { type: 'triangle', freq: 660, duree: 0.06, gain: 0.05 },
    pioche: { type: 'square',   freq: 380, duree: 0.05, gain: 0.03 },
    pose:  { type: 'sine',     freq: 300, duree: 0.09, gain: 0.06 },
    pouvoir: { type: 'triangle', freq: 880, duree: 0.25, gain: 0.07, monte: 1.5, descend: 0.7 },
    gagne: { type: 'sine',     freq: 520, duree: 0.20, gain: 0.09, monte: 1.6 },
    perdu: { type: 'sine',     freq: 260, duree: 0.24, gain: 0.08, descend: 0.6 },
    egalite: { type: 'triangle', freq: 440, duree: 0.22, gain: 0.07 },
    victoire: { type: 'sine', freq: 660, duree: 0.55, gain: 0.10, monte: 2.0 },
    defaite: { type: 'sine', freq: 300, duree: 0.60, gain: 0.09, descend: 0.4 },
  };

  /** Crée le contexte audio au premier geste de l'utilisateur. */
  function reveiller() {
    if (contexte) {
      if (contexte.state === 'suspended') contexte.resume();
      return contexte;
    }
    const Contexte = window.AudioContext || window.webkitAudioContext;
    if (!Contexte) return null;
    contexte = new Contexte();
    return contexte;
  }

  function enregistrerPreference() {
    try {
      localStorage.setItem(CLE, actif ? '1' : '0');
    } catch (e) {
      /* mode privé, on ignore */
    }
  }

  function lirePreference() {
    try {
      const valeur = localStorage.getItem(CLE);
      if (valeur !== null) actif = valeur === '1';
    } catch (e) {
      /* ignore */
    }
  }

  /**
   * Joue un son nommé.
   * Silencieux si le son est coupé ou si le navigateur refuse de jouer.
   */
  function jouer(nom) {
    if (!actif) return;
    const ctx = reveiller();
    const modele = MOTS[nom];
    if (!ctx || !modele) return;

    const maintenant = ctx.currentTime;
    const oscillateur = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillateur.type = modele.type;
    oscillateur.frequency.setValueAtTime(modele.freq, maintenant);
    if (modele.monte) {
      oscillateur.frequency.exponentialRampToValueAtTime(
        modele.freq * modele.monte,
        maintenant + modele.duree
      );
    }
    if (modele.descend) {
      oscillateur.frequency.exponentialRampToValueAtTime(
        Math.max(30, modele.freq * modele.descend),
        maintenant + modele.duree
      );
    }

    // Enveloppe : montée rapide, extinction douce (évite les claquements).
    gain.gain.setValueAtTime(0.0001, maintenant);
    gain.gain.exponentialRampToValueAtTime(modele.gain, maintenant + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, maintenant + modele.duree);

    oscillateur.connect(gain).connect(ctx.destination);
    oscillateur.start(maintenant);
    oscillateur.stop(maintenant + modele.duree + 0.02);
  }

  lirePreference();

  return {
    jouer,
    estActif: () => actif,
    basculer() {
      actif = !actif;
      enregistrerPreference();
      if (actif) jouer('clic');
      return actif;
    },
    /** À appeler sur un clic utilisateur pour débloquer le son. */
    reveiller,
  };
})();
