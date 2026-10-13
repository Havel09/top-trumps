#!/usr/bin/env python3
"""
verifier_cartes.py — Contrôle qualité de data/cartes.json

Vérifie que la source de données respecte toutes les contraintes de l'énoncé :
  - au moins 20 cartes
  - 4 attributs chiffrés minimum par carte
  - un nom, une image et une description
  - valeurs comprises entre 0 et 100
  - clés cohérentes entre les cartes

Usage :  python tests/verifier_cartes.py
Code de sortie : 0 = tout est OK, 1 = au moins une erreur.
"""

import json
import os
import re
import sys

RACINE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHEMIN = os.path.join(RACINE, "data", "cartes.json")

# Plages de caractères non attendues dans un texte français :
# CJK, hiragana/katakana, hangul,(fullwidth, etc. — signe d'un texte corrompu.
SUSPECTS = re.compile(r"[\u2E80-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFFEF]")

# Les seules clés que le moteur sait utiliser. Toute autre clé est morte :
# la page des règles la lirait sans qu'elle change quoi que ce soit.
REGLES_ATTENDUES = {
    "cartes_par_joueur",
    "main_initiale",
    "egalite_max_consecutive",
    "tours_max",
    "score_victoire",
    "evenement_tous",
}

erreurs = []
avertissements = []


def erreur(msg):
    erreurs.append(msg)


def avertissement(msg):
    avertissements.append(msg)


def main():
    with open(CHEMIN, encoding="utf-8") as f:
        donnees = json.load(f)

    jeu = donnees.get("jeu", {})
    regles = donnees.get("regles", {})
    cartes = donnees.get("cartes", [])
    cles_attributs = {a["cle"] for a in jeu.get("attributs", [])}
    cles_raretes = {r["cle"] for r in jeu.get("raretes", [])}
    archetypes = {c["archetype"] for c in cartes}
    pouvoirs = {p["cle"] for p in jeu.get("pouvoirs", [])}
    evenements = {e["cle"] for e in jeu.get("evenements", [])}
    boosters = jeu.get("boosters", [])

    # --- Contrôles sur l'énoncé -------------------------------------------
    if len(cartes) < 20:
        erreur(f"L'énoncé exige au moins 20 cartes, il y en a {len(cartes)}.")

    ids_vus = set()
    for c in cartes:
        num = c.get("id", "?")
        tag = f"carte n°{num} ({c.get('nom', 'sans nom')})"

        if not c.get("nom"):
            erreur(f"{tag} : nom manquant.")
        if not c.get("image"):
            erreur(f"{tag} : image manquante.")
        elif not os.path.isfile(os.path.join(RACINE, c["image"])):
            erreur(f"{tag} : fichier image introuvable -> {c['image']}")
        if not c.get("description"):
            avertissement(f"{tag} : pas de description.")

        attributs = c.get("attributs", {})
        if len(attributs) < 4:
            erreur(f"{tag} : {len(attributs)} attribut(s), l'énoncé en exige 4 minimum.")
        for cle, valeur in attributs.items():
            if cle not in cles_attributs:
                erreur(f"{tag} : attribut inconnu « {cle} ».")
            if not isinstance(valeur, (int, float)):
                erreur(f"{tag} : l'attribut « {cle} » n'est pas un nombre ({valeur!r}).")
            elif not 0 <= valeur <= 100:
                erreur(f"{tag} : « {cle} » = {valeur} hors de l'intervalle 0-100.")
        manquants = cles_attributs - set(attributs)
        if manquants:
            avertissement(f"{tag} : attributs absents -> {', '.join(sorted(manquants))}")

        if c.get("rarete") not in cles_raretes:
            erreur(f"{tag} : rareté inconnue « {c.get('rarete')} ».")
        if c.get("archetype") not in archetypes:
            erreur(f"{tag} : archétype incohérent « {c.get('archetype')} ».")

        est_legendaire = c.get("rarete") == "legendaire"
        pouvoir = c.get("pouvoir")
        if est_legendaire:
            if not pouvoir:
                erreur(f"{tag} : pouvoir manquant (réservé aux légendaires).")
        elif pouvoir is not None:
            erreur(
                f"{tag} : pouvoir interdit hors légendaire — seule la rareté "
                "« legendaire » porte des capacités."
            )

        actif = c.get("pouvoir_actif")
        if est_legendaire:
            if actif is None:
                erreur(f"{tag} : capacité active manquante (les légendaires en ont une).")
        elif actif is not None:
            erreur(
                f"{tag} : capacité active interdite hors légendaire — seule la "
                "rareté « legendaire » porte des capacités."
            )

        if pouvoir:
            if pouvoir.get("attribut") not in attributs:
                erreur(f"{tag} : le pouvoir cible « {pouvoir.get('attribut')} », absent de la carte.")
            bonus = pouvoir.get("bonus", 0)
            base = attributs.get(pouvoir["attribut"], 0)
            if not isinstance(bonus, int) or bonus <= 0:
                erreur(f"{tag} : bonus de pouvoir invalide ({bonus!r}).")
            elif base + bonus > 100:
                erreur(
                    f"{tag} : pouvoir trop puissant, la valeur effective dépasse 100 "
                    f"({base}+{bonus})."
                )
            elif base >= 100:
                erreur(
                    f"{tag} : le pouvoir s'applique à un attribut déjà à 100 — "
                    "ciblez une statistique qui peut encore monter."
                )

        if num in ids_vus:
            erreur(f"{tag} : identifiant dupliqué.")
        ids_vus.add(num)

        # Le pouvoir actif doit référencer une entrée du catalogue jeu.pouvoirs.
        if actif is not None and actif not in pouvoirs:
            erreur(f"{tag} : pouvoir actif inconnu « {actif} ».")
        if isinstance(actif, str) and SUSPECTS.search(actif):
            erreur(f"{tag} : caractères suspects dans pouvoir_actif -> {actif!r}")

        for champ in ("nom", "titre", "description"):
            valeur = c.get(champ)
            if isinstance(valeur, str) and SUSPECTS.search(valeur):
                erreur(f"{tag} : caractères suspects dans « {champ} » -> {valeur!r}")
        for champ in ("nom", "texte"):
            valeur = pouvoir.get(champ) if pouvoir else None
            if isinstance(valeur, str) and SUSPECTS.search(valeur):
                erreur(f"{tag} : caractères suspects dans pouvoir.{champ} -> {valeur!r}")

    # --- Catalogues : pouvoirs actifs et événements ------------------------
    for cle_catalogue, objets in (("jeu.pouvoirs", jeu.get("pouvoirs", [])),
                                  ("jeu.evenements", jeu.get("evenements", []))):
        vues = set()
        for objet in objets:
            tag = f"{cle_catalogue} : {objet.get('nom', 'sans nom')}"
            for champ in ("cle", "nom", "icone", "description"):
                if not isinstance(objet.get(champ), str) or not objet[champ]:
                    erreur(f"{tag} : champ « {champ} » manquant ou vide.")
            for champ in ("nom", "description"):
                valeur = objet.get(champ)
                if isinstance(valeur, str) and SUSPECTS.search(valeur):
                    erreur(f"{tag} : caractères suspects dans {champ} -> {valeur!r}")
            if objet.get("cle") in vues:
                erreur(f"{tag} : clé dupliquée dans {cle_catalogue}.")
            vues.add(objet.get("cle"))

    # --- Catalogue des boosters --------------------------------------------
    if not boosters:
        erreur("jeu.boosters : aucun booster défini, la boutique serait vide.")
    cles_boosters = set()
    for b in boosters:
        tag = f"jeu.boosters : {b.get('nom', 'sans nom')}"
        for champ in ("cle", "nom", "icone", "description"):
            if not isinstance(b.get(champ), str) or not b[champ]:
                erreur(f"{tag} : champ « {champ} » manquant ou vide.")
        if not isinstance(b.get("prix"), int) or b["prix"] <= 0:
            erreur(f"{tag} : prix manquant ou non positif ({b.get('prix')!r}).")
        if not isinstance(b.get("cartes"), int) or b["cartes"] < 1:
            erreur(f"{tag} : nombre de cartes invalide ({b.get('cartes')!r}).")
        poids = b.get("poids")
        if not isinstance(poids, dict) or not poids:
            erreur(f"{tag} : poids manquants ou vides.")
        else:
            inconnues = set(poids) - cles_raretes
            if inconnues:
                erreur(f"{tag} : raretés inconnues dans les poids -> {', '.join(sorted(inconnues))}.")
            for cle, valeur in poids.items():
                if not isinstance(valeur, int) or valeur < 0:
                    erreur(f"{tag} : poids « {cle} » invalide ({valeur!r}).")
            if sum(poids.values()) <= 0:
                erreur(f"{tag} : la somme des poids est nulle, aucun tirage possible.")
        if b.get("cle") in cles_boosters:
            erreur(f"{tag} : clé de booster dupliquée.")
        cles_boosters.add(b.get("cle"))

    # Raretés : le remboursement d'un doublon alimente l'économie.
    for r in jeu.get("raretes", []):
        if not isinstance(r.get("remboursement"), int) or r["remboursement"] < 0:
            erreur(
                f"jeu.raretes : remboursement manquant ou invalide pour « {r.get('cle')} »."
            )

    # Économie : bonus de bienvenue et base des pièces de victoire.
    economie = jeu.get("economie", {})
    if not isinstance(economie.get("bienvenue"), int) or economie["bienvenue"] < 0:
        erreur("jeu.economie.bienvenue doit être un entier positif ou nul.")
    if not isinstance(economie.get("baseVictoire"), int) or economie["baseVictoire"] < 0:
        erreur("jeu.economie.baseVictoire doit être un entier positif ou nul.")

    # --- Contrôles sur les règles ------------------------------------------
    pile = regles.get("cartes_par_joueur")
    if not isinstance(pile, int) or pile * 2 > len(cartes):
        erreur(
            f"regles.cartes_par_joueur = {pile} : il faut {len(cartes)} cartes "
            f"pour 2 joueurs, donc au plus {len(cartes) // 2} par joueur."
        )
    if regles.get("main_initiale", 0) > pile:
        erreur("regles.main_initiale ne peut pas dépasser le nombre de cartes par joueur.")
    if regles.get("egalite_max_consecutive", 0) < 1:
        erreur("regles.egalite_max_consecutive doit valoir au moins 1 (sinon une partie peut ne pas finir).")
    if not isinstance(regles.get("tours_max"), int) or regles["tours_max"] < 1:
        erreur("regles.tours_max doit être un entier positif : c'est la limite que l'arbitre applique.")
    if not isinstance(regles.get("score_victoire"), int) or regles["score_victoire"] < 1:
        erreur("regles.score_victoire doit être un entier positif : c'est la base du barème du classement.")
    if not isinstance(regles.get("evenement_tous"), int) or regles["evenement_tous"] < 1:
        erreur("regles.evenement_tous doit être un entier positif : c'est la cadence des événements.")

    # Une clé de réglage que le moteur n'utilise plus est une règle morte :
    # elle brouille la page des règles, qui la génère depuis ce fichier.
    inconnues = sorted(set(regles) - REGLES_ATTENDUES)
    if inconnues:
        erreur(
            "règle(s) inconnue(s) dans data/cartes.json, donc sans effet sur le jeu : "
            + ", ".join(inconnues)
        )

    # --- Rapport -----------------------------------------------------------
    print(f"{len(cartes)} cartes  |  {len(cles_attributs)} attributs  |  {len(archetypes)} archétypes"
          f"  |  {len(pouvoirs)} pouvoirs actifs  |  {len(evenements)} événements"
          f"  |  {len(boosters)} boosters")
    par_rarete = {}
    for c in cartes:
        par_rarete[c.get("rarete", "?")] = par_rarete.get(c.get("rarete", "?"), 0) + 1
    print("Raretés : " + ", ".join(f"{k}={v}" for k, v in sorted(par_rarete.items())))

    for msg in avertissements:
        print(f"  [avertissement] {msg}")
    for msg in erreurs:
        print(f"  [ERREUR] {msg}")

    if erreurs:
        print(f"\nECHEC : {len(erreurs)} erreur(s), {len(avertissements)} avertissement(s).")
        return 1
    print(f"\nOK : {len(cartes)} cartes valides, 0 erreur.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
