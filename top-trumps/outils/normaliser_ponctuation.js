'use strict';
// Normalise les apostrophes typographiques en apostrophes droites dans
// les fichiers de texte du projet. Le reste du projet utilise deja l'ASCII ;
// regles-page.js etait le seul fichier a melanger les deux.
const fs = require('node:fs');
const path = require('node:path');

const RACINE = path.resolve(__dirname, '..');
const CIBLES = [
  'js/regles-page.js',
  'js/interface.js',
  'js/jeu.js',
  'js/regles.js',
  'js/ia.js',
  'js/api.js',
  'js/audio.js',
  'index.html',
  'jeu.html',
  'regles.html',
  'collection.html',
  'classement.html',
];

for (const relatif of CIBLES) {
  const chemin = path.join(RACINE, relatif);
  if (!fs.existsSync(chemin)) continue;
  const avant = fs.readFileSync(chemin, 'utf8');
  let apres = avant;
  // U+2019 apostrophe typographique -> U+0027 apostrophe droite
  apres = apres.replace(/[\u2019\u02BC]/g, "'");
  // U+2014 tiret cadratin -> U+002D trait d'union
  apres = apres.replace(/\u2014/g, '-');
  if (apres !== avant) {
    fs.writeFileSync(chemin, apres, 'utf8');
    console.log(`${relatif} : normalise`);
  } else {
    console.log(`${relatif} : rien a faire`);
  }
}
