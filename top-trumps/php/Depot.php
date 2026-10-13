<?php
/**
 * Depot.php — Accès aux fichiers de données JSON.
 *
 * Tout le stockage du jeu passe par cette classe : lecture, écriture
 * atomique, et gestion d'un fichier absent ou corrompu (qu'on ne veut
 * jamais laisser remonter une erreur 500 à l'écran du joueur).
 */

declare(strict_types=1);

class Depot
{
    private string $fichier;

    public function __construct(string $fichier)
    {
        $this->fichier = $fichier;
    }

    /** Chemin absolu du fichier géré. */
    public function chemin(): string
    {
        return $this->fichier;
    }

    /**
     * Lit le fichier et renvoie le tableau associé.
     * Renvoie $defaut si le fichier est absent, illisible ou invalide.
     */
    public function lire(array $defaut = []): array
    {
        if (!is_file($this->fichier)) {
            return $defaut;
        }

        $brut = @file_get_contents($this->fichier);
        if ($brut === false || trim($brut) === '') {
            return $defaut;
        }

        $donnees = json_decode($brut, true);
        if (!is_array($donnees)) {
            return $defaut;
        }

        return $donnees;
    }

    /**
     * Écrit le tableau en JSON.
     *
     * On verrouille le fichier pendant l'écriture et on écrit d'abord dans
     * un fichier temporaire : si le serveur s'interrompt au milieu, le
     * fichier de données n'est jamais laissé à moitié écrit.
     *
     * @return bool false si l'écriture a échoué (droits, disque plein...)
     */
    public function ecrire(array $donnees): bool
    {
        $dossier = dirname($this->fichier);
        if (!is_dir($dossier) && !@mkdir($dossier, 0775, true) && !is_dir($dossier)) {
            return false;
        }

        $json = json_encode(
            $donnees,
            JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
        );
        if ($json === false) {
            return false;
        }

        $temporaire = $this->fichier . '.' . getmypid() . '.tmp';
        if (@file_put_contents($temporaire, $json, LOCK_EX) === false) {
            return false;
        }
        if (!@rename($temporaire, $this->fichier)) {
            @unlink($temporaire);
            return false;
        }
        return true;
    }
}
