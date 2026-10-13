<?php
/**
 * api.php — Point d'entrée unique des requêtes du jeu.
 *
 * Le client (JavaScript) appelle toujours ce fichier, avec un paramètre
 * « action » qui indique ce qu'il veut :
 *
 *   GET  ?action=config              paramètres du jeu (attributs, règles)
 *   GET  ?action=cartes              le catalogue complet des cartes
 *   GET  ?action=nouvelle-partie     mélange + distribution des paquets
 *   POST ?action=enregistrer-partie  ajoute une partie à l'historique
 *   GET  ?action=classement          meilleur score et statistiques
 *   POST ?action=sauvegarder         met une partie en cours de côté
 *   GET  ?action=restaurer           récupère une partie sauvegardée
 *   POST ?action=oublier             supprime la sauvegarde
 *
 * Réponses : JSON systématique, { ok: true, ... } ou { ok: false, erreur }.
 */

declare(strict_types=1);

require_once __DIR__ . '/Depot.php';
require_once __DIR__ . '/Partie.php';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

/** Renvoie une réponse JSON et arrête le script. */
function repondre(array $charge, int $code = 200): never
{
    http_response_code($code);
    echo json_encode($charge, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function echec(string $message, int $code = 400): never
{
    repondre(['ok' => false, 'erreur' => $message], $code);
}

/** Lit les données de l'action, que ce soit en GET ou en POST JSON. */
function lireEntree(): array
{
    $entree = $_GET;
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $brut = file_get_contents('php://input');
        if ($brut !== false && trim($brut) !== '') {
            $decode = json_decode($brut, true);
            if (is_array($decode)) {
                $entree = array_merge($entree, $decode);
            }
        }
    }
    return $entree;
}

/**
 * Nettoie un nom de joueur.
 * On garde lettres, chiffres, espace, apostrophe, tiret et point, sinon
 * tout le reste disparaît.
 */
function nettoyerNom(mixed $brut): string
{
    if (!is_string($brut)) {
        return '';
    }
    $nom = preg_replace('/[^\p{L}\p{N}\s\'\-_.]/u', '', $brut) ?? '';
    $nom = trim(preg_replace('/\s+/u', ' ', $nom) ?? '');
    return mb_substr($nom, 0, 20);
}

function entier(mixed $brut, int $min, int $max, int $defaut): int
{
    if (!is_numeric($brut)) {
        return $defaut;
    }
    return max($min, min($max, (int) $brut));
}

// ---------------------------------------------------------------------------
// Chargement des données
// ---------------------------------------------------------------------------

$racine = dirname(__DIR__);
$depotCartes = new Depot($racine . '/data/cartes.json');
$depotParties = new Depot($racine . '/data/parties.json');
$depotSauvegardes = new Depot($racine . '/data/sauvegardes.json');
$depotPortefeuilles = new Depot($racine . '/data/portefeuilles.json');

$donneesCartes = $depotCartes->lire();
if ($donneesCartes === [] || !isset($donneesCartes['cartes'])) {
    echec('Fichier data/cartes.json introuvable ou invalide.', 500);
}

$partie = new Partie($donneesCartes);

$entree = lireEntree();
$action = is_string($entree['action'] ?? null) ? $entree['action'] : '';

switch ($action) {

    // -----------------------------------------------------------------------
    case 'config':
        repondre([
            'ok' => true,
            'jeu' => $partie->metadonnees(),
            'regles' => $partie->regles(),
            'nbCartes' => count($partie->cartes()),
            'modes' => Partie::MODES,
        ]);

    // -----------------------------------------------------------------------
    case 'cartes':
        repondre([
            'ok' => true,
            'cartes' => $partie->cartes(),
        ]);

    // -----------------------------------------------------------------------
    case 'nouvelle-partie':
        $mode = is_string($entree['mode'] ?? null) ? $entree['mode'] : 'ia';
        $tailleMain = entier($entree['tailleMain'] ?? null, 1, 5, 0);
        $regles = $partie->regles();

        if ($tailleMain === 0) {
            $tailleMain = (int) ($regles['main_initiale'] ?? 4);
        }

        repondre([
            'ok' => true,
            'regles' => $regles,
            'main_initiale' => $tailleMain,
        ] + $partie->distribuer($mode, $tailleMain));

    // -----------------------------------------------------------------------
    case 'enregistrer-partie':
        $nom = nettoyerNom($entree['joueur'] ?? '');
        if ($nom === '') {
            $nom = 'Anonyme';
        }
        $adversaire = nettoyerNom($entree['adversaire'] ?? 'Ordinateur');
        $mode = in_array($entree['mode'] ?? null, Partie::MODES, true)
            ? $entree['mode'] : 'ia';
        $tours = entier($entree['tours'] ?? null, 0, 100000, 0);
        $victoire = filter_var($entree['victoire'] ?? false, FILTER_VALIDATE_BOOLEAN);
        // Une victoire peut laisser jusqu'à tout le paquet en main : la borne
        // suit la taille réelle du catalogue, pas une constante figée.
        $cartesRestantes = entier(
            $entree['cartesRestantes'] ?? null,
            0,
            count($partie->cartes()),
            0
        );
        $duree = entier($entree['duree'] ?? null, 0, 86400, 0);

        $historique = $depotParties->lire(['parties' => []]);
        $parties = $historique['parties'] ?? [];

        $rang = count($parties) + 1;
        $score = $victoire
            ? Partie::bareme($tours, (int) (($partie->regles()['score_victoire'] ?? 100)))
            : 0;

        // Pièces gagnées : en cas de victoire, le portefeuille du joueur est
        // crédité (le jeton est le même que celui des sauvegardes). La somme
        // suit le score : une victoire rapide rapporte plus.
        $piecesGagnees = 0;
        $jeton = nettoyerNom($entree['jeton'] ?? '');
        if ($victoire && $jeton !== '') {
            $economie = $partie->metadonnees()['economie'] ?? [];
            $piecesGagnees = (int) ($economie['baseVictoire'] ?? 50) + intdiv($score, 2);
            chargerPortefeuille($depotPortefeuilles, $jeton, (int) ($economie['bienvenue'] ?? 100));
            $fonds = $depotPortefeuilles->lire(['portefeuilles' => []]);
            $portefeuilles = $fonds['portefeuilles'] ?? [];
            $portefeuilles[$jeton]['pieces'] = (int) ($portefeuilles[$jeton]['pieces'] ?? 0) + $piecesGagnees;
            $fonds['portefeuilles'] = $portefeuilles;
            if (!$depotPortefeuilles->ecrire($fonds)) {
                echec('Impossible d\'enregistrer les pièces.', 500);
            }
        }

        $parties[] = [
            'rang' => $rang,
            'date' => gmdate('c'),
            'joueur' => $nom,
            'adversaire' => $adversaire,
            'mode' => $mode,
            'tours' => $tours,
            'victoire' => $victoire,
            'score' => $score,
            'cartesRestantes' => $cartesRestantes,
            'duree' => $duree,
        ];

        // On garde les 200 dernières parties : au-delà le fichier devient
        // lourd et le classement n'intéresse plus personne.
        if (count($parties) > 200) {
            $parties = array_slice($parties, -200);
        }
        $historique['parties'] = $parties;

        if (!$depotParties->ecrire($historique)) {
            echec('Impossible d\'enregistrer la partie.', 500);
        }

        repondre([
            'ok' => true,
            'score' => $score,
            'piecesGagnees' => $piecesGagnees,
            'classement' => calculerClassement($depotParties, $nom),
        ]);

    // -----------------------------------------------------------------------
    case 'classement':
        $nom = nettoyerNom($entree['joueur'] ?? '');
        repondre([
            'ok' => true,
            'classement' => $nom === ''
                ? calculerClassement($depotParties)
                : calculerClassement($depotParties, $nom),
        ]);

    // -----------------------------------------------------------------------
    case 'sauvegarder':
        $jeton = nettoyerNom($entree['jeton'] ?? $entree['jouon'] ?? '');
        $etat = $entree['etat'] ?? null;
        if ($jeton === '' || !is_array($etat)) {
            echec('Jeton ou état de partie manquant.');
        }

        $sauvegardes = $depotSauvegardes->lire([]);
        $sauvegardes[$jeton] = [
            'date' => gmdate('c'),
            'etat' => $etat,
        ];

        // On ne garde que les 20 sauvegardes les plus récentes.
        if (count($sauvegardes) > 20) {
            $sauvegardes = array_slice($sauvegardes, -20, null, true);
        }

        if (!$depotSauvegardes->ecrire($sauvegardes)) {
            echec('Impossible d\'écrire la sauvegarde.', 500);
        }

        repondre(['ok' => true]);

    // -----------------------------------------------------------------------
    case 'restaurer':
        $jeton = nettoyerNom($entree['jeton'] ?? $entree['jouon'] ?? '');
        $sauvegardes = $depotSauvegardes->lire([]);
        if ($jeton === '' || !isset($sauvegardes[$jeton]['etat'])) {
            repondre(['ok' => true, 'trouve' => false]);
        }
        repondre([
            'ok' => true,
            'trouve' => true,
            'date' => $sauvegardes[$jeton]['date'] ?? null,
            'etat' => $sauvegardes[$jeton]['etat'],
        ]);

    // -----------------------------------------------------------------------
    case 'oublier':
        $jeton = nettoyerNom($entree['jeton'] ?? $entree['jouon'] ?? '');
        $sauvegardes = $depotSauvegardes->lire([]);
        if (isset($sauvegardes[$jeton])) {
            unset($sauvegardes[$jeton]);
            $depotSauvegardes->ecrire($sauvegardes);
        }
        repondre(['ok' => true]);

    // -----------------------------------------------------------------------
    case 'inventaire':
        $jeton = nettoyerNom($entree['jeton'] ?? '');
        if ($jeton === '') {
            echec('Jeton manquant.');
        }
        $economie = $partie->metadonnees()['economie'] ?? [];
        $porte = chargerPortefeuille($depotPortefeuilles, $jeton, (int) ($economie['bienvenue'] ?? 100));
        repondre([
            'ok' => true,
            'pieces' => (int) ($porte['pieces'] ?? 0),
            'cartes' => array_map('intval', $porte['cartes'] ?? []),
            'nombre' => count($porte['cartes'] ?? []),
            'total' => count($partie->cartes()),
            'ouvertures' => (int) ($porte['ouvertures'] ?? 0),
        ]);

    // -----------------------------------------------------------------------
    case 'ouvrir-booster':
        $jeton = nettoyerNom($entree['jeton'] ?? '');
        $cle = nettoyerNom($entree['booster'] ?? '');
        if ($jeton === '' || $cle === '') {
            echec('Jeton ou booster manquant.');
        }
        $metadonnees = $partie->metadonnees();
        $raretes = $metadonnees['raretes'] ?? [];
        $booster = null;
        foreach (($metadonnees['boosters'] ?? []) as $b) {
            if (($b['cle'] ?? '') === $cle) {
                $booster = $b;
                break;
            }
        }
        if ($booster === null) {
            echec('Booster inconnu : « ' . htmlspecialchars($cle, ENT_QUOTES) . ' ».');
        }
        $economie = $metadonnees['economie'] ?? [];
        $porte = chargerPortefeuille($depotPortefeuilles, $jeton, (int) ($economie['bienvenue'] ?? 100));
        $prix = (int) ($booster['prix'] ?? 0);
        $pieces = (int) ($porte['pieces'] ?? 0);
        if ($pieces < $prix) {
            echec('Pièces insuffisantes : il faut ' . $prix . ' pièces pour ce booster.');
        }

        // Tirages : on tire d'abord une rareté selon les poids du booster,
        // puis une carte au hasard dans cette rareté. Un doublon est
        // remboursé en pièces selon le tarif de la rareté.
        $parRarete = [];
        foreach ($partie->cartes() as $c) {
            $parRarete[(string) ($c['rarete'] ?? '')][] = $c;
        }
        $restes = [];
        foreach ($parRarete as $rarete => $liste) {
            shuffle($liste);
            $restes[$rarete] = $liste;
        }

        $cartes = $porte['cartes'] ?? [];
        $disponibles = count($cartes) > 0 ? array_flip(array_map('strval', array_keys($cartes))) : [];
        $pieces -= $prix;
        $nb = max(1, (int) ($booster['cartes'] ?? 5));
        $poids = is_array($booster['poids'] ?? null) ? $booster['poids'] : [];
        $tirages = [];

        for ($i = 0; $i < $nb; $i++) {
            $rarete = tirerRarete($poids);
            if (empty($restes[$rarete])) {
                $restes[$rarete] = $parRarete[$rarete] ?? [];
            }
            if (empty($restes[$rarete])) {
                continue;
            }
            $carte = array_pop($restes[$rarete]);
            $id = (string) ($carte['id'] ?? '');
            $nouveau = !isset($disponibles[$id]);
            $gains = 0;
            if ($nouveau) {
                $disponibles[$id] = true;
                $cartes[$id] = 1;
            } else {
                $gains = remboursementRarete($raretes, (string) ($carte['rarete'] ?? ''));
                $pieces += $gains;
            }
            $tirages[] = [
                'carte' => $carte,
                'nouveau' => $nouveau,
                'remboursement' => $gains,
            ];
        }

        $fonds = $depotPortefeuilles->lire(['portefeuilles' => []]);
        $portefeuilles = $fonds['portefeuilles'] ?? [];
        $portefeuilles[$jeton] = [
            'cree' => $porte['cree'] ?? gmdate('c'),
            'pieces' => $pieces,
            'cartes' => $cartes,
            'ouvertures' => (int) ($porte['ouvertures'] ?? 0) + 1,
        ];
        $fonds['portefeuilles'] = $portefeuilles;
        if (!$depotPortefeuilles->ecrire($fonds)) {
            echec('Impossible d\'enregistrer la collection.', 500);
        }

        repondre([
            'ok' => true,
            'pieces' => $pieces,
            'ouvertures' => (int) ($portefeuilles[$jeton]['ouvertures'] ?? 0),
            'tirages' => $tirages,
        ]);

    // -----------------------------------------------------------------------
    default:
        echec('Action inconnue : « ' . htmlspecialchars($action, ENT_QUOTES) . ' ».', 404);
}

// ---------------------------------------------------------------------------
// Fonctions utilitaires appelées plus haut
// ---------------------------------------------------------------------------

/**
 * Rembourse un doublon selon la rareté de la carte (jeu.raretes.remboursement).
 */
function remboursementRarete(array $raretes, string $cle): int
{
    foreach ($raretes as $rarete) {
        if (($rarete['cle'] ?? '') === $cle) {
            return (int) ($rarete['remboursement'] ?? 0);
        }
    }
    return 0;
}

/**
 * Tire une rareté selon un tableau de poids (jeu.boosters[].poids).
 */
function tirerRarete(array $poids): string
{
    $total = 0;
    foreach ($poids as $p) {
        $total += max(0, (int) $p);
    }
    if ($total <= 0) {
        return 'commun';
    }
    $t = random_int(1, $total);
    $cumul = 0;
    foreach ($poids as $cle => $p) {
        $cumul += max(0, (int) $p);
        if ($t <= $cumul) {
            return $cle;
        }
    }
    return 'commun';
}

/**
 * Charge le portefeuille d'un jeton, en le créant (bonus de bienvenue)
 * s'il n'existe pas encore.
 *
 * @return array{pieces:int, cartes:array<int,int>, ouvertures:int, cree:string}
 */
function chargerPortefeuille(Depot $depot, string $jeton, int $bienvenue): array
{
    $fonds = $depot->lire(['portefeuilles' => []]);
    $portefeuilles = $fonds['portefeuilles'] ?? [];
    if (!isset($portefeuilles[$jeton])) {
        $portefeuilles[$jeton] = [
            'cree' => gmdate('c'),
            'pieces' => $bienvenue,
            'cartes' => [],
            'ouvertures' => 0,
        ];
        $fonds['portefeuilles'] = $portefeuilles;
        $depot->ecrire($fonds);
        return $portefeuilles[$jeton];
    }
    return $portefeuilles[$jeton];
}

/**
 * Calcule le classement : meilleurs scores d'abord, puis statistiques
 * agrégées par joueur.
 *
 * @return array{
 *     joueurs: array<int, array<string,mixed>>,
 *     total: int,
 *     moi: array<string,mixed>|null
 * }
 */
function calculerClassement(Depot $depot, string $joueur = ''): array
{
    $historique = $depot->lire(['parties' => []]);
    $parties = $historique['parties'] ?? [];

    $parJoueur = [];
    foreach ($parties as $p) {
        $nom = $p['joueur'] ?? 'Anonyme';
        if (!isset($parJoueur[$nom])) {
            $parJoueur[$nom] = [
                'joueur' => $nom,
                'parties' => 0,
                'victoires' => 0,
                'defaites' => 0,
                'score' => 0,
                'meilleurScore' => 0,
                'meilleureSerie' => 0,
                'serie' => 0,
                'tours' => 0,
            ];
        }
        $e = &$parJoueur[$nom];
        $e['parties']++;
        $e['tours'] += (int) ($p['tours'] ?? 0);
        $e['score'] += (int) ($p['score'] ?? 0);
        $e['meilleurScore'] = max($e['meilleurScore'], (int) ($p['score'] ?? 0));

        if (!empty($p['victoire'])) {
            $e['victoires']++;
            $e['serie']++;
            $e['meilleureSerie'] = max($e['meilleureSerie'], $e['serie']);
        } else {
            $e['defaites']++;
            $e['serie'] = 0;
        }
        unset($e);
    }

    foreach ($parJoueur as &$e) {
        $e['ratio'] = $e['parties'] > 0
            ? round(100 * $e['victoires'] / $e['parties'])
            : 0;
        $e['moyenneTours'] = $e['parties'] > 0
            ? round($e['tours'] / $e['parties'], 1)
            : 0;
    }
    unset($e);

    usort($parJoueur, static function (array $a, array $b): int {
        return $b['score'] <=> $a['score']
            ?: $b['meilleureSerie'] <=> $a['meilleureSerie']
            ?: strcasecmp($a['joueur'], $b['joueur']);
    });

    $liste = array_values($parJoueur);
    foreach ($liste as $index => &$e) {
        $e['rang'] = $index + 1;
    }
    unset($e);

    $moi = null;
    if ($joueur !== '') {
        foreach ($liste as $e) {
            if ($e['joueur'] === $joueur) {
                $moi = $e;
                break;
            }
        }
    }

    return [
        'joueurs' => $liste,
        'total' => count($parties),
        'moi' => $moi,
    ];
}
