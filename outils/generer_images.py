#!/usr/bin/env python3
"""
generer_images.py — Génère une illustration SVG pour chaque carte.

Chaque image est un « blason » : un fond dégradé inspiré de l'archétype de la
créature, un halo, et une silhouette géométrique unique. Le rendu est
déterministe (même carte -> même image), ce qui rend le script réexécutable.

Usage :  python outils/generer_images.py
"""

import json
import math
import os
import random

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DONNEES = os.path.join(RACINE, "data", "cartes.json")
DOSSIER_IMAGES = os.path.join(RACINE, "images")

L, H = 480, 360
CX, CY = L / 2, H / 2 - 6
CADRE = 124         # demi-taille visée pour la silhouette, après cadrage
ROTATION_MAX = 5.0  # degrés : au-delà, les coins sortiraient du halo

# couleurs : (fond sombre, fond clair, teinte du glyphe, lueur du glyphe)
PALETTES = {
    "wyrm":    ("#2b0d12", "#6b1a1e", "#ffb26b", "#ff7a3d"),
    "aura":    ("#150e2e", "#45207a", "#d4b3ff", "#8f5cff"),
    "titan":   ("#17171d", "#43434f", "#d5dcea", "#8fa0bd"),
    "beast":   ("#2a1a0b", "#7a4d16", "#ffd28a", "#ff9f2e"),
    "phoenix": ("#3d1105", "#9c3008", "#ffcf6b", "#ff5a1f"),
    "noble":   ("#230d1a", "#6b1a44", "#ff9ec2", "#e0407f"),
    "armored": ("#101728", "#31477a", "#a6caff", "#4a7fff"),
    "aquatic": ("#04202e", "#0b5878", "#86e9ff", "#18b6e0"),
    "brute":   ("#261504", "#6e440c", "#ffcb8f", "#e08a1e"),
}


def m(d):
    """Pointes de chemin -> attribut d."""
    return "M " + " L ".join(f"{x:.1f},{y:.1f}" for x, y in d) + " Z"


# --------------------------------------------------------------------------
# Silhouettes. Repère local centré sur (0,0), emprise ≈ -120..120.
# Chaque glyphe est une liste de (balise_SVG, couleur).
#   0 = teinte principale, 1 = fond (détails en creux), 2 = lueur
# --------------------------------------------------------------------------

def _miroir(chemins):
    return [[(-x, y) for x, y in chemin] for chemin in chemins]


GLYPHES = {
    # Tête de dragon de profil, aile déployée derrière.
    "wyrm": lambda: [
        ("path", m([(6, -18), (26, -88), (104, -98), (126, -34),
                    (92, -58), (52, -48), (24, -4)]), 2, 0.45),
        ("path", m([(-46, 24), (-86, 46), (-98, 94), (-70, 110),
                    (-20, 76), (-46, 58), (-36, 34), (-6, 30)]), 0, 0.75),
        ("path", m([(-44, -26), (14, -52), (64, -30), (46, 6), (-26, 8)]), 0, 1.0),
        ("path", m([(-26, 8), (46, 6), (34, 28), (-12, 26)]), 1, 0.9),
        ("path", m([(-30, -34), (-58, -68), (-44, -96), (-18, -80),
                    (-34, -64), (-30, -46), (-12, -36)]), 0, 0.9),
        ("path", m([(24, -48), (36, -78), (24, -100), (2, -94),
                    (24, -80), (28, -62), (12, -48)]), 0, 0.9),
        ("circle", (6, -24, 6.5), 1, 1.0),
        ("circle", (8, -24, 2.6), 2, 1.0),
    ],

    # Silhouette encapuchonnée, visage creux et yeux lumineux.
    "aura": lambda: [
        ("path", m([(0, -86), (48, -86), (76, -44), (86, 22),
                    (98, 106), (-98, 106), (-86, 22), (-76, -44), (-48, -86)]), 0, 1.0),
        ("ellipse", (0, -26, 34, 42), 1, 1.0),
        ("circle", (-13, -30, 5.5), 2, 1.0),
        ("circle", (13, -30, 5.5), 2, 1.0),
        ("path", m([(-26, 8), (0, -4), (26, 8), (18, 20), (-18, 20)]), 2, 0.35),
        ("circle", (-96, -54, 7), 2, 0.6),
        ("circle", (98, -70, 5), 2, 0.6),
        ("circle", (-84, 46, 6), 2, 0.45),
        ("circle", (88, 58, 6), 2, 0.45),
    ],

    # Colosse anguleux : torse massif, bras larges, fissures lumineuses.
    "titan": lambda: [
        ("path", m([(-56, -26), (56, -26), (68, 40), (42, 98),
                    (-42, 98), (-68, 40)]), 0, 1.0),
        ("path", m([(-30, -80), (30, -80), (36, -34), (-36, -34)]), 0, 1.0),
        ("path", m([(-68, -20), (-108, 8), (-96, 86), (-58, 72)]), 0, 0.85),
        ("path", m([(68, -20), (108, 8), (96, 86), (58, 72)]), 0, 0.85),
        ("path", m([(-42, 98), (-10, 98), (-16, 124), (-46, 124)]), 0, 0.7),
        ("path", m([(42, 98), (10, 98), (16, 124), (46, 124)]), 0, 0.7),
        ("path", m([(-24, -56), (-6, -56), (-6, -44), (-24, -44)]), 2, 1.0),
        ("path", m([(24, -56), (6, -56), (6, -44), (24, -44)]), 2, 1.0),
        ("path", m([(-16, 4), (-7, 6), (1, 92), (-8, 92)]), 2, 0.9),
        ("path", m([(33, -8), (24, -6), (22, 74), (13, 72)]), 2, 0.7),
    ],

    # Tête de fauve : oreilles dressées, museau, crocs.
    "beast": lambda: [
        ("path", m([(-44, -52), (-54, -100), (-14, -66)]), 0, 0.9),
        ("path", m([(44, -52), (54, -100), (14, -66)]), 0, 0.9),
        ("path", m([(-44, -58), (44, -58), (36, 8), (0, 48), (-36, 8)]), 0, 1.0),
        ("path", m([(10, -8), (78, 4), (10, 34)]), 0, 0.95),
        ("path", m([(0, 40), (0, 92), (-30, 66), (-34, 20)]), 0, 0.55),
        ("path", m([(0, 40), (0, 92), (30, 66), (34, 20)]), 0, 0.55),
        ("circle", (-20, -34, 7), 1, 1.0),
        ("circle", (-18, -34, 3), 2, 1.0),
        ("circle", (20, -34, 7), 1, 1.0),
        ("circle", (22, -34, 3), 2, 1.0),
        ("path", m([(46, 8), (58, 4), (54, 20)]), 1, 0.9),
    ],

    # Oiseau de feu : ailes levées, corps en goutte, queue flamme.
    "phoenix": lambda: [
        ("path", m([(-6, -40), (-40, -108), (-104, -86), (-74, -6),
                    (-44, -30), (-24, 4)]), 2, 0.5),
        ("path", m([(6, -40), (40, -108), (104, -86), (74, -6),
                    (44, -30), (24, 4)]), 2, 0.5),
        ("path", m([(0, -60), (34, -20), (30, 40), (0, 78), (-30, 40), (-34, -20)]), 0, 1.0),
        ("path", m([(0, -60), (16, -92), (0, -82), (-16, -92)]), 0, 0.9),
        ("path", m([(-14, -52), (-34, -74), (-24, -42)]), 0, 0.8),
        ("path", m([(14, -52), (34, -74), (24, -42)]), 0, 0.8),
        ("path", m([(-20, 66), (-56, 116), (-16, 106), (-26, 130), (8, 104)]), 0, 0.7),
        ("path", m([(20, 66), (56, 116), (16, 106), (26, 130), (-8, 104)]), 0, 0.7),
        ("circle", (0, -44, 6), 1, 1.0),
        ("path", m([(0, -34), (16, -30), (0, -26)]), 2, 1.0),
    ],

    # Noble-vampire : capuche à haut col, cape, couronne.
    "noble": lambda: [
        ("path", m([(0, -60), (44, -60), (66, -30), (76, 12),
                    (92, 108), (-92, 108), (-76, 12), (-66, -30), (-44, -60)]), 0, 0.55),
        ("path", m([(0, -78), (30, -78), (40, -50), (0, -22), (-40, -50)]), 0, 1.0),
        ("ellipse", (0, -56, 22, 26), 1, 1.0),
        ("path", m([(-58, -30), (-32, -2), (0, -22), (32, -2), (58, -30),
                    (46, -58), (-46, -58)]), 0, 1.0),
        ("circle", (-8, -58, 5.5), 2, 1.0),
        ("circle", (8, -58, 5.5), 2, 1.0),
        ("path", m([(-34, -84), (-40, -114), (-14, -92)]), 0, 0.9),
        ("path", m([(0, -84), (0, -120), (12, -90)]), 0, 0.9),
        ("path", m([(34, -84), (40, -114), (14, -92)]), 0, 0.9),
    ],

    # Chevalier : heaume à fente, cimier, écu.
    "armored": lambda: [
        ("path", m([(-40, -84), (40, -84), (48, -24), (32, 22), (-32, 22), (-48, -24)]), 0, 1.0),
        ("path", m([(-48, -24), (48, -24), (40, 44), (0, 74), (-40, 44)]), 0, 0.7),
        ("path", m([(-42, -44), (42, -44), (42, -28), (-42, -28)]), 1, 1.0),
        ("path", m([(0, -84), (12, -116), (44, -128), (64, -114),
                    (44, -106), (22, -98), (10, -82)]), 0, 0.85),
        ("path", m([(-118, -18), (-24, -18), (-24, 52),
                    (-58, 70), (-100, 68), (-118, 48)]), 0, 0.85),
        ("path", m([(-76, -4), (-66, -4), (-66, 46), (-76, 46)]), 2, 0.9),
        ("path", m([(-112, 17), (-30, 17), (-30, 27), (-112, 27)]), 2, 0.9),
    ],

    # Créature marine : corps fuselé, nageoires, dents.
    "aquatic": lambda: [
        ("path", m([(-74, 4), (-136, -46), (-124, 10), (-136, 62)]), 0, 0.55),
        ("path", m([(0, -74), (52, -74), (84, -30), (84, 8),
                    (52, 72), (0, 72), (-52, 72), (-84, 8), (-84, -30)]), 0, 1.0),
        ("path", m([(-10, -70), (-46, -112), (-6, -100), (10, -74)]), 0, 0.8),
        ("path", m([(-10, 68), (-44, 112), (-4, 100), (10, 72)]), 0, 0.8),
        ("circle", (-40, -26, 9), 1, 1.0),
        ("circle", (-38, -26, 4), 2, 1.0),
        ("path", m([(10, 30), (60, 40), (10, 54)]), 1, 0.9),
        ("path", m([(-56, 0), (-47, 4), (-64, 25), (-73, 21)]), 1, 0.8),
        ("path", m([(-58, -14), (-49, -10), (-66, 11), (-75, 7)]), 1, 0.8),
    ],

    # Colosse bestial : petites cornes, poings démesurés, massue.
    "brute": lambda: [
        ("path", m([(-52, -8), (52, -8), (66, 52), (40, 104),
                    (-40, 104), (-66, 52)]), 0, 1.0),
        ("path", m([(-26, -62), (26, -62), (32, -14), (-32, -14)]), 0, 1.0),
        ("path", m([(-28, -58), (-50, -88), (-38, -110), (-16, -98),
                    (-30, -84), (-28, -70), (-16, -60)]), 0, 0.9),
        ("path", m([(28, -58), (50, -88), (38, -110), (16, -98),
                    (30, -84), (28, -70), (16, -60)]), 0, 0.9),
        ("path", m([(-64, -4), (-110, 26), (-104, 100), (-62, 86)]), 0, 0.85),
        ("path", m([(64, -4), (110, 26), (104, 100), (62, 86)]), 0, 0.85),
        ("path", m([(-92, 96), (92, 96), (84, 116), (-84, 116)]), 0, 0.6),
        ("path", m([(-22, -46), (-4, -46), (-4, -32), (-22, -32)]), 1, 1.0),
        ("path", m([(22, -46), (4, -46), (4, -32), (22, -32)]), 1, 1.0),
    ],
}


def emprise(formes):
    """Boîte englobante d'un glyphe, dans son repère local (0,0 = centre)."""
    xs, ys = [], []
    for balise, geom, role, opacite in formes:
        if balise == "path":
            for nombre in geom.replace("M", " ").replace("L", " ").replace("Z", " ").split():
                x, y = nombre.split(",")
                xs.append(float(x))
                ys.append(float(y))
        elif balise == "circle":
            cx, cy, r = geom
            xs += [cx - r, cx + r]
            ys += [cy - r, cy + r]
        else:
            cx, cy, rx, ry = geom
            xs += [cx - rx, cx + rx]
            ys += [cy - ry, cy + ry]
    return min(xs), min(ys), max(xs), max(ys)


def cadrer(formes):
    """Recentrage et mise à l'échelle d'un glyphe.

    Toutes les silhouettes sont dessinées à la main, donc ni centrées ni de
    taille identique. On normalise ici : chaque glyphe est réduit ou agrandi
    pour occuper exactement la même boîte carrée, ce qui donne un rendu
    homogène d'une carte à l'autre.
    """
    x0, y0, x1, y1 = emprise(formes)
    largeur, hauteur = max(x1 - x0, 1), max(y1 - y0, 1)
    echelle = (2 * CADRE) / max(largeur, hauteur)
    return (x0 + x1) / 2, (y0 + y1) / 2, echelle


def dessiner_ornements(graine, couleur):
    """Décor de fond : étoiles et runes, déterministes pour une graine donnée."""
    rnd = random.Random(graine)
    morceaux = []
    etoiles = "".join(
        f'<circle cx="{rnd.uniform(0, L):.0f}" cy="{rnd.uniform(0, H):.0f}" '
        f'r="{rnd.uniform(0.7, 2.4):.1f}" opacity="{rnd.uniform(0.12, 0.5):.2f}"/>'
        for _ in range(70)
    )
    morceaux.append(f'<g fill="{couleur}">{etoiles}</g>')

    anneaux = "".join(
        f'<circle cx="{CX}" cy="{CY}" r="{r}" fill="none" '
        f'stroke="{couleur}" stroke-width="{1.4 - i * 0.2:.2f}" opacity="{0.16 - i * 0.03:.2f}"/>'
        for i, r in enumerate((150, 126, 104))
    )
    morceaux.append(anneaux)

    # Éclats : petits losanges disposés en couronne autour du glyphe.
    losanges = []
    for i in range(10):
        a = math.radians(i * 36 + graine * 11)
        x, y = CX + 158 * math.cos(a), CY + 158 * math.sin(a) * 0.62
        s = rnd.uniform(4, 8)
        losanges.append(
            f'<path d="M {x:.1f},{y - s:.1f} L {x + s:.1f},{y:.1f} '
            f'L {x:.1f},{y + s:.1f} L {x - s:.1f},{y:.1f} Z" opacity="0.22"/>'
        )
    morceaux.append(f'<g fill="{couleur}">{"".join(losanges)}</g>')
    return "\n    ".join(morceaux)


def construire_svg(carte):
    fond1, fond2, teinte, lueur = PALETTES[carte["archetype"]]
    gid = f"c{carte['id']}"
    rnd = random.Random(carte["id"] * 7919)
    rotation = rnd.uniform(-ROTATION_MAX, ROTATION_MAX)

    formes = GLYPHES[carte["archetype"]]()
    ccx, ccy, echelle = cadrer(formes)

    elements = []
    # Remplissage selon le rôle : teinte principale, creux sombre, ou lueur.
    remplissage = {0: f"url(#{gid}l)", 1: f"url(#{gid}f)", 2: lueur}
    for balise, geom, role, opacite in formes:
        couleur = remplissage[role]
        if balise == "circle":
            cx, cy, r = geom
            elements.append(
                f'<circle cx="{cx}" cy="{cy}" r="{r}" '
                f'fill="{couleur}" opacity="{opacite}"/>'
            )
        elif balise == "ellipse":
            cx, cy, rx, ry = geom
            elements.append(
                f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" '
                f'fill="{couleur}" opacity="{opacite}"/>'
            )
        else:
            elements.append(f'<path d="{geom}" fill="{couleur}" opacity="{opacite}"/>')

    glyphe = "\n        ".join(elements)

    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {L} {H}"
     width="{L}" height="{H}" role="img"
     aria-label="Illustration de {carte['nom']}">
  <title>{carte['nom']}</title>
  <defs>
    <linearGradient id="{gid}b" x1="0" y1="0" x2="0.6" y2="1">
      <stop offset="0" stop-color="{fond2}"/>
      <stop offset="1" stop-color="{fond1}"/>
    </linearGradient>
    <radialGradient id="{gid}h" cx="0.5" cy="0.45" r="0.55">
      <stop offset="0" stop-color="{lueur}" stop-opacity="0.55"/>
      <stop offset="1" stop-color="{lueur}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="{gid}l" x1="0.1" y1="0" x2="0.9" y2="1">
      <stop offset="0" stop-color="{teinte}"/>
      <stop offset="1" stop-color="{lueur}"/>
    </linearGradient>
    <linearGradient id="{gid}f" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="{fond1}"/>
      <stop offset="1" stop-color="{fond2}"/>
    </linearGradient>
    <radialGradient id="{gid}v" cx="0.5" cy="0.5" r="0.75">
      <stop offset="0.55" stop-color="#000" stop-opacity="0"/>
      <stop offset="1" stop-color="#000" stop-opacity="0.55"/>
    </radialGradient>
  </defs>

  <rect width="{L}" height="{H}" fill="url(#{gid}b)"/>
    {dessiner_ornements(carte['id'], teinte)}
  <circle cx="{CX}" cy="{CY}" r="140" fill="url(#{gid}h)"/>
  <g transform="translate({CX} {CY}) rotate({rotation:.2f}) scale({echelle:.4f}) translate({-ccx:.2f} {-ccy:.2f})">
        {glyphe}
  </g>
  <rect width="{L}" height="{H}" fill="url(#{gid}v)"/>
  <rect x="0.5" y="0.5" width="{L - 1}" height="{H - 1}" fill="none"
        stroke="{teinte}" stroke-opacity="0.28" stroke-width="1"/>
</svg>
"""


def main():
    with open(DONNEES, encoding="utf-8") as f:
        cartes = json.load(f)["cartes"]

    os.makedirs(DOSSIER_IMAGES, exist_ok=True)
    for carte in cartes:
        chemin = os.path.join(RACINE, carte["image"])
        os.makedirs(os.path.dirname(chemin), exist_ok=True)
        with open(chemin, "w", encoding="utf-8") as f:
            f.write(construire_svg(carte))
        print(f"  {carte['image']}  ({carte['nom']})")

    # planche de contrôle pour vérifier le rendu d'un coup d'œil
    with open(os.path.join(RACINE, "outils", "planche.svg"), "w", encoding="utf-8") as f:
        f.write(planche(cartes))

    print(f"\n{len(cartes)} illustrations générées dans images/")


def planche(cartes):
    colonnes, largeur, hauteur = 6, 300, 240
    lignes = math.ceil(len(cartes) / colonnes)
    morceaux = []
    for i, c in enumerate(cartes):
        x, y = (i % colonnes) * largeur, (i // colonnes) * hauteur
        morceaux.append(
            f'<g transform="translate({x} {y})">'
            f'<image href="../{c["image"]}" width="{largeur - 16}" height="{hauteur - 32}"/>'
            f'<text x="{(largeur - 16) / 2:.0f}" y="{hauteur - 12}" fill="#cfd6e4" '
            f'font-size="14" font-family="sans-serif" text-anchor="middle">'
            f'{c["nom"]} ({c["archetype"]})</text></g>'
        )
    return (
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'width="{colonnes * largeur}" height="{lignes * hauteur}" '
        f'viewBox="0 0 {colonnes * largeur} {lignes * hauteur}">'
        f'<rect width="100%" height="100%" fill="#12121a"/>'
        + "".join(morceaux)
        + "</svg>"
    )


if __name__ == "__main__":
    main()
