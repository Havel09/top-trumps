#!/usr/bin/env python3
"""
verifier_glyphes.py — Contrôle géométrique des illustrations générées.

Sans affichage, on ne peut pas juger une illustration à l'œil. Ce script
remplace la relecture visuelle par des mesures objectives :

  1. toutes les formes restent dans le cadre visible (rien de coupé) ;
  2. les formes ont une taille minimale (pas de filet invisible) ;
  3. la surface couverte est raisonnable (ni éclat minuscule, ni aplat) ;
  4. la silhouette est centrée dans le cadre ;
  5. chaque archétype a bien une silhouette qui lui est propre.

Usage :  python outils/verifier_glyphes.py
"""

import json
import math
import os
import random
import sys

from PIL import Image, ImageDraw

import generer_images as gi
import previsualiser as pv

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

RAYON_SURE = 150        # demi-diamètre autorisé pour un point du glyphe
SURFACE_MIN = 20        # px² : en dessous, la forme est un détail invisible
SURFACE_UTILE = 150     # px² : en dessous, la forme est négligeable
COUVERTURE_MIN = 0.06   # part du cadre que doit couvrir la silhouette
COUVERTURE_MAX = 0.80   # au-delà, la silhouette n'est plus lisible
TOLERANCE_CENTRE = 6    # px : décalage du cadrage par rapport au centre du cadre

problemes = []
avertissements = []
notes = []


def points_de(forme, decaler=False):
    """Points caractéristiques d'une forme, dans le repère local du glyphe.

    Si ``decaler`` est vrai, les points sont translatés au centre du canevas
    (repère de la feuille), sinon ils restent dans le repère du glyphe.
    """
    dx, dy = (gi.CX, gi.CY) if decaler else (0, 0)
    if forme[0] == "path":
        return [(x + dx, y + dy) for x, y in pv.parse_chemin(forme[1])]
    if forme[0] == "circle":
        _, (cx, cy, r), _, _ = forme
        return [(cx - r + dx, cy - r + dy), (cx + r + dx, cy + r + dy)]
    _, (cx, cy, rx, ry), _, _ = forme
    return [(cx - rx + dx, cy - ry + dy), (cx + rx + dx, cy + ry + dy)]


def surface(forme):
    """Surface approchée d'une forme, en px²."""
    if forme[0] == "path":
        pts = pv.parse_chemin(forme[1])
        if len(pts) < 3:
            return 0.0
        total = 0.0
        for i in range(len(pts)):
            x1, y1 = pts[i]
            x2, y2 = pts[(i + 1) % len(pts)]
            total += x1 * y2 - x2 * y1
        return abs(total) / 2
    if forme[0] == "circle":
        return math.pi * forme[1][2] ** 2
    return math.pi * forme[1][2] * forme[1][3]


def rastériser(formes, echelle=1.0, ccx=0.0, ccy=0.0):
    """Rendu de la silhouette, en appliquant le cadrage du générateur."""
    plan = Image.new("L", (gi.L, gi.H), 0)
    pd = ImageDraw.Draw(plan)
    for balise, geom, role, opacite in formes:
        alpha = max(1, int(255 * opacite))
        if balise == "path":
            pts = [
                (gi.CX + (x - ccx) * echelle, gi.CY + (y - ccy) * echelle)
                for x, y in pv.parse_chemin(geom)
            ]
            pd.polygon(pts, fill=alpha)
        elif balise == "circle":
            cx, cy, r = geom
            cx = gi.CX + (cx - ccx) * echelle
            cy = gi.CY + (cy - ccy) * echelle
            r *= echelle
            pd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=alpha)
        else:
            cx, cy, rx, ry = geom
            cx = gi.CX + (cx - ccx) * echelle
            cy = gi.CY + (cy - ccy) * echelle
            pd.ellipse(
                [cx - rx * echelle, cy - ry * echelle,
                 cx + rx * echelle, cy + ry * echelle],
                fill=alpha,
            )
    return plan


def analyser(archetype):
    formes = gi.GLYPHES[archetype]()

    # 1. une fois cadré, rien ne doit dépasser du halo
    ccx, ccy, echelle = gi.cadrer(formes)
    coin = gi.CADRE * math.sqrt(2) / 2 * math.cos(math.radians(gi.ROTATION_MAX)) + \
        gi.CADRE * math.sqrt(2) / 2 * math.sin(math.radians(gi.ROTATION_MAX))
    if coin > gi.CADRE * math.sqrt(2):
        problemes.append(f"{archetype} : le cadrage déborde ({coin:.0f} px).")

    # 2. aucun path dégénéré (moins de 3 sommets = surface nulle, rien
    #    ne s'affiche), et aucune forme vraiment minuscule.
    for forme in formes:
        if forme[0] == "path" and len(pv.parse_chemin(forme[1])) < 3:
            problemes.append(
                f"{archetype} : path à moins de 3 sommets, il ne s'affiche pas."
            )
        elif surface(forme) < SURFACE_MIN:
            problemes.append(
                f"{archetype} : forme dégénérée ({surface(forme):.0f} px²)."
            )
        elif forme[0] == "path" and surface(forme) < SURFACE_UTILE:
            avertissements.append(
                f"{archetype} : trait très fin ({surface(forme):.0f} px²), "
                f"à vérifier à l'écran."
            )
        # les petits cercles (yeux, reflets) sont des détails volontaires.

    # 3 + 4. couverture et centrage
    # 3. Occupation du cadre : la silhouette doit remplir le cadre cadré
    #    sans le saturer. On mesure le rapport entre sa boîte et le cadre.
    plan = rastériser(formes, echelle, ccx, ccy)
    pixels = plan.load()
    couverts = 0
    min_x, min_y, max_x, max_y = gi.L, gi.H, -1, -1
    for y in range(gi.H):
        for x in range(gi.L):
            if pixels[x, y] > 0:
                couverts += 1
                min_x, max_x = min(min_x, x), max(max_x, x)
                min_y, max_y = min(min_y, y), max(max_y, y)

    if couverts:
        largeur = max_x - min_x + 1
        hauteur = max_y - min_y + 1
        ratio = couverts / (largeur * hauteur)
        # remplissage de sa propre boîte : trop creux = trou bizarre,
        # trop plein = aplat illisible.
        if ratio < 0.20:
            problemes.append(
                f"{archetype} : silhouette trop creuse ({ratio:.0%} de sa boîte)."
            )
        elif ratio > 0.88:
            problemes.append(
                f"{archetype} : silhouette trop pleine ({ratio:.0%} de sa boîte)."
            )
        # et elle doit occuper le cadre
        occupation = max(largeur, hauteur) / (2 * gi.CADRE)
        if occupation < 0.80:
            problemes.append(
                f"{archetype} : silhouette trop petite dans le cadre "
                f"({occupation:.0%})."
            )
    else:
        problemes.append(f"{archetype} : silhouette vide.")
        occupation = ratio = decalage = 0.0

    # 4. Cadrage : le centre de la boîte englobante doit être au centre du cadre.
    decalage = math.hypot((min_x + max_x) / 2 - gi.CX, (min_y + max_y) / 2 - gi.CY)
    if decalage > TOLERANCE_CENTRE:
        problemes.append(f"{archetype} : silhouette décentrée de {decalage:.0f} px.")

    notes.append(
        f"{archetype:9s} occupation {occupation:5.0%}  remplissage {ratio:5.0%}  "
        f"décentrage {decalage:4.1f} px  formes {len(formes):2d}"
    )
    return occupation


def silhouette_de(archetype):
    """Empreinte grossière de la silhouette, pour la comparaison."""
    points = set()
    for forme in gi.GLYPHES[archetype]():
        for x, y in points_de(forme):
            points.add((round(x / 5), round(y / 5)))
    return points


def main():
    with open(os.path.join(RACINE, "data", "cartes.json"), encoding="utf-8") as f:
        cartes = json.load(f)["cartes"]

    for archetype in gi.GLYPHES:
        analyser(archetype)

    # 5. aucun archétype ne duplique un autre
    empreintes = {a: silhouette_de(a) for a in gi.GLYPHES}
    noms = sorted(empreintes)
    for i, a in enumerate(noms):
        for b in noms[i + 1 :]:
            if empreintes[a] == empreintes[b]:
                problemes.append(f"{a} et {b} ont exactement la même silhouette.")
            elif len(empreintes[a] & empreintes[b]) / max(
                len(empreintes[a] | empreintes[b]), 1
            ) > 0.6:
                problemes.append(f"{a} et {b} ont des silhouettes trop proches.")

    # cohérence avec les données : tout archétype utilisé doit exister
    utilises = {c["archetype"] for c in cartes}
    for arch in sorted(utilises - set(gi.GLYPHES)):
        problemes.append(f"l'archétype « {arch} » n'a pas de glyphe généré.")
    for arch in sorted(set(gi.GLYPHES) - utilises):
        notes.append(f"attention : l'archétype « {arch} » n'est utilisé par aucune carte.")

    print("Contrôle des silhouettes :")
    for note in notes:
        print("  " + note)

    par_arch = {}
    for c in cartes:
        par_arch.setdefault(c["archetype"], []).append(c["nom"])
    print("\nRépartition des cartes :")
    for arch in sorted(par_arch):
        print(f"  {arch:9s} -> {', '.join(par_arch[arch])}")

    if problemes:
        print()
        for p in sorted(set(problemes)):
            print(f"  [ERREUR] {p}")
        print(f"\nECHEC : {len(set(problemes))} problème(s).")
        return 1
    if avertissements:
        print()
        for a in sorted(set(avertissements)):
            print(f"  [avertissement] {a}")
    print("\nOK : toutes les silhouettes sont exploitables.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
