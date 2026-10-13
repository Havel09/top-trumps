# Top Trump — Créatures Fantastiques

Un jeu de cartes « Top Trump » complet, jouable dans le navigateur : **32 créatures fantastiques**, 5 attributs chiffrés, une IA à trois niveaux, un mode deux joueurs sur la même machine, des sons synthétisés, des animations, un classement, la sauvegarde d'une partie en cours et des cartes à raretés — dont les capacités sont réservées aux légendaires.

Technologies imposées par le projet : **HTML, CSS, JavaScript et PHP**. Les cartes sont stockées dans une source de données externe (`data/cartes.json`) — aucune donnée de jeu n'est écrite en dur dans le code JavaScript.

---

## Lancer le projet

Le serveur est **conteneurisé avec Docker** : l'image `php:8.3-cli` sert les fichiers statiques et l'API, et le dossier `data/` est monté depuis la machine hôte (les parties, sauvegardes et portefeuilles y persistent entre deux lancements).

Depuis la racine du projet (`top-trumps/`) :

```bash
docker compose up -d --build
```

puis ouvrez <http://127.0.0.1:8123>.

Arrêt : `docker compose down`. Les données vivent sur la machine hôte et survivent au conteneur.

### Sans Docker

```bash
php -S 127.0.0.1:8000
```

Prérequis : **PHP ≥ 8.1** (extensions `json` et `mbstring`), un navigateur moderne. Aucune installation de dépendance n'est nécessaire.

> Sur Windows, si `php` n'est pas dans le `PATH`, utilisez le chemin complet, ex. `C:\tools\php85\php.exe -S 127.0.0.1:8000`.

---

## Structure du projet

```
top-trumps/
├── index.html            Accueil : nom du joueur, choix du mode et du niveau
├── jeu.html              La table de jeu (les 2 modes y sont joués)
├── regles.html           Page des règles complètes du jeu
├── classement.html       Meilleur score du joueur + liste des dernières parties
├── collection.html       Toutes les cartes du jeu avec leur rareté
├── galerie.html          Collection personnelle : possédées et silhouettes
├── booster.html          Boutique : ouverture de boosters contre des pièces
├── css/
│   └── style.css         Toute la charte graphique et les animations
├── js/
│   ├── api.js            Accès HTTP à l'API PHP (config, cartes, partie…)
│   ├── regles.js         Moteur de règles pur : tours, égalités, fin de partie
│   ├── ia.js             IA de l'ordinateur, 3 niveaux
│   ├── interface.js      Rendu DOM : cartes, main, attributs, journal, bilan
│   ├── audio.js          Bruitages synthétisés avec l'API Web Audio
│   ├── jeu.js            Contrôleur d'une partie (mode « ia » et « duel »)
│   ├── accueil.js        Préparation de la partie sur index.html (solde, liens)
│   ├── regles-page.js    Construction de la page des règles depuis le JSON
│   ├── classement.js     Chargement et affichage du classement
│   ├── collection.js     Affichage de la collection complète
│   ├── portefeuille.js   Jeton du navigateur, inventaire, solde de pièces
│   ├── galerie.js        Rendu de la collection personnelle
│   └── booster.js        Rendu de la boutique et de la révélation des cartes
├── data/
│   ├── cartes.json       SOURCE DE VÉRITÉ : jeu, règles, 32 cartes, boosters
│   ├── parties.json      Historique des parties (→ classement)
│   ├── sauvegardes.json  Parties en cours dans ce navigateur
│   └── portefeuilles.json  Pièces et cartes possédées (par jeton navigateur)
├── images/
│   └── *.svg             32 illustrations générées en SVG (aucun binaire)
├── php/
│   ├── api.php           Point d'entrée unique de l'API (JSON)
│   ├── Partie.php        Mélange, distribution, barème de score
│   └── Depot.php         Lecture/écriture sûre des fichiers JSON
├── Dockerfile            Image PHP pour servir l'application (Docker)
├── docker-compose.yml    Serveur sur le port 8123, volume ./data:/app/data
├── .dockerignore         Exclut tests, outils et données générées
├── outils/               Scripts de génération et de contrôle (hors jeu)
└── tests/                Batterie de tests et de simulation
```

---

## Règles du jeu

Les règles sont **déclarées dans `data/cartes.json`** (bloc `regles`) puis affichées sur la page règles et appliquées par le moteur. Résumé :

| Question | Réponse |
| --- | --- |
| Cartes par joueur au départ | **10** (`cartes_par_joueur`) |
| Cartes visibles en main | **4** (`main_initiale`), puis on pioche |
| Déroulement d'un tour | Le joueur actif pose une carte, choisit l'attribut à comparer, puis chaque camp pose sa carte ; la valeur la plus haute l'emporte |
| Choix de l'attribut | Par le joueur actif ; en mode duel, alterné à chaque tour |
| La valeur la plus haute gagne-t-elle ? | Oui, sauf si un pouvoir « Contre-offensive » ou l'événement « Sort retourné » inverse le sens : la plus faible l'emporte alors |
| Égalité | Les cartes vont dans une **mise commune** ; le tour suivant se joue sur la même table |
| Égalités répétées | **3 égalités consécutives** (`egalite_max_consecutive`) détruisent la mise |
| Carte perdue | Elle rejoint le bas de la **pioche du gagnant** |
| Y a-t-il une pioche ? | Oui : chaque joueur pioche quand sa main se vide |
| Comment gagne-t-on ? | Un joueur **vainqueur à plat de cartes** (plus rien en main ni en pioche). Après **60 tours** (`tours_max`), le joueur avec le meilleur score l'emporte ; en manche de tour, celui qui en possède le plus |

Chaque carte porte **5 attributs** (Force, Vitesse, Intelligence, Magie, Endurance), une **rareté** (Commune, Rare, Épique, Légendaire), un titre et une description. **Seules les cartes légendaires portent des capacités** : un bonus passif ajouté à un attribut (jamais une statistique déjà à 100) et un pouvoir actif déclenchable une fois par partie — c'est l'avantage des cartes rares.

---

## Modes de jeu et IA

Deux modes sont jouables depuis l'accueil :

- **Contre l'ordinateur** — vous choisissez le niveau :
  - **Novice** : joue surtout au hasard, sans stratégie ;
  - **Tacticien** : estime votre main (par soustraction au catalogue) et joue la (carte, attribut) à meilleure marge ;
  - **Oracle** : comme le Tacticien, mais avec un sens de la réserve : il ne gaspille pas sa meilleure carte si une autre suffit.
  - (Aucun niveau n'est imbattable : chaque décision comporte une part d'incertitude maîtrisée.)
- **Deux joueurs sur la même machine** — les tours alternent, la main active est visible et la main adverse face cachée.

La main de l'ordinateur est **toujours rendue face cachée** : même si le transport des données passe par le client (qui doit pouvoir piocher), l'interface ne laisse jamais voir les cartes de l'adversaire.

---

## Fonctionnalités par rapport à l'énoncé

### Minimum obligatoire

| Exigence | Implémentation |
| --- | --- |
| ≥ 20 cartes différentes | **32 cartes** dans `data/cartes.json` |
| ≥ 4 attributs chiffrés par carte | **5 attributs** (Force, Vitesse, Intelligence, Magie, Endurance) |
| HTML, CSS, JavaScript, PHP | Pages `.html`, `css/style.css`, `js/*.js`, `php/api.php` |
| Cartes stockées en source externe | Fichier JSON `data/cartes.json` (option A de l'énoncé) |
| Système de jeu fonctionnel | Moteur complet dans `js/regles.js` + API de distribution côté serveur |
| Règles clairement définies | Bloc `regles` du JSON + page `regles.html` + règles summarisées ci-dessus |
| Détermination du gagnant | Fin de partie : joueur à plat, ou arbitrage à `tours_max` |
| Au moins un mode de jeu | Deux modes en fait : contre l'ordinateur **et** deux joueurs en local |

### Améliorations facultatives

| Amélioration | Implémentation |
| --- | --- |
| IA difficile à battre | 3 niveaux (Novice, Tacticien, Oracle) avec estimation de main et coût de réserve |
| Sons et musique | `js/audio.js` : bruitages 100 % synthétisés via l'API Web Audio, sans fichier binaire |
| Animations | `css/style.css` : cartes retournées/posées, mises en avant de l'attribut choisi, transitions de score, écran de victoire |
| Système de classement | `classement.html` + `data/parties.json` : meilleur score et dernières parties, barème qui récompense les victoires rapides |
| Sauvegarde / restauration | Sauvegarde automatique en cours de partie, bandeau de reprise au chargement, ou abandon de la sauvegarde ; stockée côté serveur (`data/sauvegardes.json`) |
| Cartes rares ou spéciales | 4 raretés (Commune → légendaire) avec couleurs dédiées ; **seules les légendaires** portent un bonus d'attribut et un pouvoir actif |
| Capacités des légendaires | 6 pouvoirs actifs (Coup décisif, Renversement, Grand larcin, Ruse du faible, Contre-offensive, Égide), une fois par partie chacun, déclenchés au moment de poser la carte |
| Pièces et boosters | 100 pièces de bienvenue, 50 + la moitié du score par victoire (créditées côté serveur), et une boutique de 4 boosters avec probabilités par rareté et remboursement des doublons (`data/portefeuilles.json`) |
| Collection personnelle | `galerie.html` : cartes possédées, silhouettes pour les manquantes, taux de complétude et filtres par rareté |

---

## API PHP

Toutes les requêtes passent par `php/api.php` et renvoient du JSON (`{ "ok": true, ... }` ou `{ "ok": false, "erreur": "…" }`) :

| Action | Description |
| --- | --- |
| `?action=config` | Métadonnées du jeu, règles, nombre de cartes, modes |
| `?action=cartes` | Catalogue complet des cartes |
| `?action=nouvelle-partie&mode=ia\|duel&tailleMain=N` | Mélange cryptographique + distribution des paquets |
| `?action=enregistrer-partie` (POST) | Ajoute la partie à l'historique, recale le classement et crédite les pièces de victoire (`piecesGagnees`, uniquement si un `jeton` est fourni) |
| `?action=classement&joueur=…` | Meilleur score et statistiques d'un joueur (ou global) |
| `?action=sauvegarder` (POST) | Met une partie en cours de côté sous un jeton |
| `?action=restaurer&jeton=…` | Récupère une sauvegarde |
| `?action=oublier&jeton=…` (POST) | Efface la sauvegarde |
| `?action=inventaire&jeton=…` | Crée le portefeuille du navigateur (100 pièces de bienvenue) et renvoie pièces, cartes possédées, nombre et total |
| `?action=ouvrir-booster` (POST) | Débite le prix du booster, tire 5 cartes sans remise dans la rareté, rembourse les doublons en pièces (effet de bord affiché par `tirage`) |

L'économie est déclarée dans `data/cartes.json` (`jeu.economie` : 100 pièces de bienvenue, 50 de base par victoire) ainsi que les boosters et les valeurs de remboursement (`jeu.boosters`, `raretes[].remboursement`).

Le serveur fait autorité sur le **mélange** (Fisher‑Yates avec `random_int`) et sur les **paramètres du jeu** ; le client applique les règles purement côté navigateur pour réagir instantanément.

---

## Tests et validation

Des scripts (dans `tests/`) vérifient la cohérence du projet :

```bash
# Simulation de milliers de parties (équilibre et fin de partie)
node tests\simuler.js 3000

# Validations structurelles
node --check js\*.js          # chaque script est syntaxiquement valide
node tests\verifier_api.js    # 64 vérifications sur l'API (serveur lancé)
python -X utf8 tests\verifier_cartes.py   # cartes.json complet et cohérent (32 cartes, boosters, économie)
python -X utf8 tests\verifier_texte.py    # texte des règles / pages
node tests\equilibrer.js      # les attributs restent équilibrés
node tests\experience.js      # l'expérience de jeu reste raisonnable
```

Le test le plus complet est `tests/interface.test.js` : il reconstruit une fausse page dans un bac à sable, y charge les vrais scripts (`api → regles → ia → audio → interface → jeu`), joue des **parties entières en cliquant sur les boutons rendus** (vs IA, duel, puis reprise et abandon d'une sauvegarde) et vérifie **70 points**, dont l'absence de cartes adverses visibles et l'affichage des pièces gagnées en fin de victoire.

```bash
# Prérequis : serveur lancé sur 127.0.0.1:8123 (docker compose up -d --build)
node tests\interface.test.js
```

---

## Note sur les illustrations

Les 32 images de `images/` sont des **fichiers SVG générés** par `outils/generer_images.py` : silhouettes et détails tracés par code, palette alignée sur l'archétype de la créature. Le projet ne contient **aucun fichier binaire** d'illustration ni de son.