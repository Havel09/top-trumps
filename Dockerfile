# Top Trump - Créatures Fantastiques
#
# Image légère : PHP 8.3 en mode CLI sert les fichiers statiques et l'API
# avec le serveur de développement intégré. Aucune dépendance supplémentaire
# (json et mbstring sont compilés d'origine dans l'image officielle).

FROM php:8.3-cli

WORKDIR /app

# On copie toute l'application. Le dossier data/ est monté en volume au
# lancement (docker-compose.yml) pour conserver ce que le serveur écrit :
# parties, sauvegardes et portefeuilles de pièces.
COPY . .

EXPOSE 8000

# -t /app : la racine du site est la racine du projet (index.html, php/api.php
# et les dossiers statiques s'y trouvent tous).
CMD ["php", "-S", "0.0.0.0:8000", "-t", "/app"]