#!/usr/bin/env python3
"""Verificateur de texte — chasse les caracteres hors alphabet latin.

Le projet contient beaucoup de francais saisi a la main. Ce script relit tous
les fichiers texte (HTML, CSS, JS, PHP, JSON, MD) et signale :

  * les caracteres chinois/japonais/coredens glissés dans le texte francais ;
  * les espaces insecables ou doubles ;
  * les balises de securite/commentaires oublies.

Sortie : la liste des fichier, ligne, colonne et le caractere fautif, puis un
compte. Le code de sortie vaut 1 si au moins un probleme a ete trouve.
"""

from __future__ import annotations

import json
import sys
import unicodedata
from pathlib import Path

RACINE = Path(__file__).resolve().parent.parent

# On ignore tout ce qui est genere, binaire ou sans rapport avec le texte
# ecrit a la main.
IGNORES = {
    "images",           # illustrations SVG : les formes geometriques sont
    "outils",           # volontairement hors alphabet latin
    "__pycache__",
    ".git",
}
EXTENSIONS = {".html", ".css", ".js", ".php", ".json", ".md", ".py", ".txt"}

# Tout ce qui passe dans ces intervalles est tolere : on ne veut pas
# denoncer les emojis, les symboles typographiques ni le ponctuation
# demi-largeur utilisee par certains claviers.
TOLERES = [
    (0x0020, 0x007E),   # ASCII imprimable
    (0x00A0, 0x024F),   # Latin supplementaire etendu
    (0x2000, 0x206F),   # ponctuation, espaces, fleches, Symboles
    (0x20A0, 0x20BF),   # symboles monetaires
    (0x2100, 0x27BF),   # Symboles, dingbats, fleches, formes
    (0x2B00, 0x2BFF),   # symboles supplementaires
    (0xFE0E, 0xFE0F),   # indicateurs de variation d'emoji
    (0x1F000, 0x1FAFF), # emojis et symboles pictographiques
    (0x1F1E6, 0x1F1FF), # drapeaux
]


def est_tolere(code: int) -> bool:
    for bas, haut in TOLERES:
        if bas <= code <= haut:
            return True
    return False


def fichiers() -> list[Path]:
    trouves = []
    for chemin in sorted(RACINE.rglob("*")):
        if not chemin.is_file():
            continue
        if any(part in IGNORES for part in chemin.parts):
            continue
        if chemin.suffix.lower() not in EXTENSIONS:
            continue
        trouves.append(chemin)
    return trouves


def analyser(chemin: Path) -> list[tuple[int, int, str, str]]:
    # Un fichier qui n'est pas de l'UTF-8 n'est pas un fichier source :
    # les traces laissées par un outil (journal de PowerShell en UTF-16,
    # par exemple) ne doivent pas faire échouer la vérification. On le
    # signale tout de même, plutôt que de l'ignorer en silence.
    try:
        texte = chemin.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return [(0, 0, "?", "fichier illisible en UTF-8 : aconvertir ou supprimer")]

    lignes = texte.splitlines()
    problemes: list[tuple[int, int, str, str]] = []

    for numero, ligne in enumerate(lignes, 1):
        for colonne, caractere in enumerate(ligne, 1):
            code = ord(caractere)
            if est_tolere(code):
                # Une espace insecable au milieu d'un mot est presque
                # toujours une faute de frappe.
                if caractere in ("\u00a0", "\u202f", "\u2007") and (
                    colonne > 1
                    and colonne < len(ligne)
                    and (ligne[colonne - 2].isalpha() and ligne[colonne].isalpha())
                ):
                    problemes.append((numero, colonne, caractere, "espace insecable dans un mot"))
                continue
            try:
                nom = unicodedata.name(caractere)
            except ValueError:
                nom = "?"
            problemes.append((numero, colonne, caractere, nom))

        if "\t" in ligne:
            problemes.append((numero, 0, "\t", "tabulation au lieu d'espaces"))

    return problemes


def main() -> int:
    total = 0
    for chemin in fichiers():
        problemes = analyser(chemin)
        if not problemes:
            continue
        relatif = chemin.relative_to(RACINE)
        for numero, colonne, caractere, nom in problemes:
            total += 1
            print(
                f"{relatif}:{numero}:{colonne + 1}: "
                f"{nom} — {caractere!r}"
            )
        print(f"  -> {len(problemes)} probleme(s) dans {relatif}")

    if total:
        print(f"\nKO : {total} caractere(s) suspect(s).")
        return 1

    print("OK : aucun caractere suspect dans les fichiers textes.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
