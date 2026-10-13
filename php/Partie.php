<?php
/**
 * Partie.php — Distribution et lecture des règles côté serveur.
 *
 * Le serveur fait autorité sur deux choses :
 *   - la composition des paquets (c'est lui qui mélange, pas le client) ;
 *   - les paramètres du jeu (taille des mains, barème...), lus depuis
 *     data/cartes.json afin qu'il n'y ait qu'une seule source de vérité.
 */

declare(strict_types=1);

class Partie
{
    public const MODES = ['ia', 'duel'];

    /** @var array<mixed> contenu complet de data/cartes.json */
    private array $donnees;

    public function __construct(array $donnees)
    {
        $this->donnees = $donnees;
    }

    /** @return array<mixed> */
    public function cartes(): array
    {
        return $this->donnees['cartes'] ?? [];
    }

    /** @return array<mixed> */
    public function regles(): array
    {
        return $this->donnees['regles'] ?? [];
    }

    /** @return array<mixed> */
    public function metadonnees(): array
    {
        return $this->donnees['jeu'] ?? [];
    }

    /**
     * Mélange le paquet et le répartit entre les deux joueurs.
     *
     * Chaque joueur reçoit exactement regles.cartes_par_joueur cartes, en
     * piochant (index 0) une main initiale. Le reste de la carte du joueur
     * est renvoyé sous la clé « pioche », dans l'ordre où il sera tiré.
     *
     * Le contenu du paquet transite par le client, qui doit pouvoir le
     * piocher : c'est donc l'interface, et non le transport, qui garantit
     * qu'un joueur ne voit pas la main adverse — elle n'est jamais rendue.
     *
     * @return array{
     *     mode: string,
     *     joueurs: array<string, array{main: array<int, array<string,mixed>>, pioche: array<int, array<string,mixed>>}>,
     *     main_initiale: int
     * }
     */
    public function distribuer(string $mode, int $tailleMain): array
    {
        if (!in_array($mode, self::MODES, true)) {
            $mode = 'ia';
        }

        $regles = $this->regles();
        $parJoueur = (int) ($regles['cartes_par_joueur'] ?? 12);
        $mainInitiale = (int) ($regles['main_initiale'] ?? 4);

        $mainInitiale = max(1, min($tailleMain, $parJoueur));

        $cartes = array_values($this->cartes());

        // mélange Fisher-Yates avec une source aléatoire cryptographique :
        // shuffle() dépend de l'état global de PHP, moins reproductible.
        for ($i = count($cartes) - 1; $i > 0; $i--) {
            $j = random_int(0, $i);
            [$cartes[$i], $cartes[$j]] = [$cartes[$j], $cartes[$i]];
        }

        $paquets = array_chunk($cartes, $parJoueur);
        $noms = ['joueur', 'adversaire'];

        $joueurs = [];
        foreach ($noms as $index => $nom) {
            $paquet = $paquets[$index] ?? [];
            $main = array_slice($paquet, 0, $mainInitiale);
            $joueurs[$nom] = [
                'main' => array_values($main),
                'pioche' => array_values(array_slice($paquet, $mainInitiale)),
            ];
        }

        return [
            'mode' => $mode,
            'joueurs' => $joueurs,
            'main_initiale' => $mainInitiale,
        ];
    }

    /**
     * Barème d'un score de victoire, en fonction du nombre de tours.
     *
     * Gagner vite rapporte plus : c'est ce qui rend le classement
     * intéressant plutôt qu'un simple « qui a gagné ». Le socle de 100
     * points est celui de regles.score_victoire, modifiable sans toucher
     * au code.
     *
     * Les paliers sont calqués sur la durée réellement observée des parties
     * (médiane autour de 20 tours, queue jusqu'à une quarantaine).
     *
     * @param int $tours nombre de tours joués
     * @param int $base  points de base (regles.score_victoire)
     */
    public static function bareme(int $tours, int $base = 100): int
    {
        if ($tours <= 15) {
            $base += 80;
        } elseif ($tours <= 25) {
            $base += 50;
        } elseif ($tours <= 40) {
            $base += 30;
        } elseif ($tours <= 60) {
            $base += 10;
        }

        return $base;
    }
}
