#!/usr/bin/env python3
"""
previsualiser.py — Planche de contrôle PNG des illustrations.

Redessine les mêmes formes que generer_images.py avec Pillow, afin de
contrôler d'un coup d'œil que les silhouettes sont lisibles et qu'elles
restent dans le cadre. Sert uniquement au développement.

Usage :  python outils/previsualiser.py
"""

import math
import os

from PIL import Image, ImageDraw, ImageFont

import generer_images as gi

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SORTIE = os.path.join(RACINE, "outils", "planche.png")

COLONNES = 6
LARGEUR, HAUTEUR = 320, 260


def parse_chemin(d):
    """Convertit « M x,y L x,y ... Z » en liste de points."""
    points = []
    for nombre in d.replace("M", " ").replace("L", " ").replace("Z", " ").split():
        x, y = nombre.split(",")
        points.append((float(x), float(y)))
    return points


def degrade_vertical(ci, haut, bas, hauteur, largeur):
    img = Image.new("RGB", (largeur, hauteur))
    draw = ImageDraw.Draw(img)
    for y in range(hauteur):
        t = y / max(hauteur - 1, 1)
        draw.line(
            [(0, y), (largeur, y)],
            fill=tuple(int(haut[i] + (bas[i] - haut[i]) * t) for i in range(3)),
        )
    return img


def vers_rgb(couleur):
    return tuple(int(couleur[i : i + 2], 16) for i in (1, 3, 5))


def dessiner_carte(carte, taille=(LARGEUR - 20, HAUTEUR - 50)):
    l, h = gi.L, gi.H
    fond1, fond2, teinte, lueur = gi.PALETTES[carte["archetype"]]
    base = degrade_vertical(ci=l, haut=vers_rgb(fond2), bas=vers_rgb(fond1),
                            hauteur=h, largeur=l).convert("RGBA")

    # halo radial
    halo = Image.new("RGBA", (l, h), (0, 0, 0, 0))
    hd = ImageDraw.Draw(halo)
    rgb_lueur = vers_rgb(lueur)
    for r in range(140, 0, -2):
        alpha = int(140 * (1 - r / 140) ** 1.6)
        hd.ellipse(
            [gi.CX - r, gi.CY - r, gi.CX + r, gi.CY + r],
            fill=rgb_lueur + (alpha,),
        )
    base = Image.alpha_composite(base, halo)

    couche = Image.new("RGBA", (l, h), (0, 0, 0, 0))
    cd = ImageDraw.Draw(couche)
    rgb_teinte, rgb_fond = vers_rgb(teinte), vers_rgb(fond1)
    remplissage = {0: rgb_teinte, 1: rgb_fond, 2: rgb_lueur}

    for balise, geom, role, opacite in gi.GLYPHES[carte["archetype"]]():
        couleur = remplissage[role] + (int(255 * opacite),)
        if balise == "path":
            cd.polygon(parse_chemin(geom), fill=couleur)
        elif balise == "circle":
            cx, cy, r = geom
            cd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=couleur)
        else:
            cx, cy, rx, ry = geom
            cd.ellipse([cx - rx, cy - ry, cx + rx, cy + ry], fill=couleur)
    base = Image.alpha_composite(base, couche)
    return base.resize(taille, Image.LANCZOS)


def main():
    import json

    with open(os.path.join(RACINE, "data", "cartes.json"), encoding="utf-8") as f:
        cartes = json.load(f)["cartes"]

    police = None
    for nom in ("segoeui.ttf", "arial.ttf"):
        try:
            police = ImageFont.truetype(nom, 15)
            break
        except OSError:
            continue

    lignes = math.ceil(len(cartes) / COLONNES)
    planche = Image.new("RGB", (COLONNES * LARGEUR, lignes * HAUTEUR), (18, 18, 26))
    pd = ImageDraw.Draw(planche)

    for i, carte in enumerate(cartes):
        x = (i % COLONNES) * LARGEUR
        y = (i // COLONNES) * HAUTEUR
        planche.paste(dessiner_carte(carte), (x + 10, y + 8))
        pd.text(
            (x + LARGEUR / 2, y + HAUTEUR - 30),
            f'{carte["nom"]}  ({carte["archetype"]})',
            fill=(200, 210, 225),
            font=police,
            anchor="mm",
        )
        # repère : cadre théorique de l'image
        pd.rectangle(
            [x + 10, y + 8, x + 10 + LARGEUR - 22, y + 8 + HAUTEUR - 52],
            outline=(70, 70, 90),
        )

    planche.save(SORTIE)
    print(f"Planche écrite dans {SORTIE} ({planche.width}x{planche.height})")


if __name__ == "__main__":
    main()
