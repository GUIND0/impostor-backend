# Imposteur - Backend

Serveur temps réel du jeu Imposteur, un jeu de bluff et de déduction jouable en ligne à distance.
Tous les joueurs reçoivent le même mot secret, sauf l'imposteur. Chacun donne un indice à son tour
(texte ou message vocal), puis tout le monde vote pour démasquer l'imposteur. Les catégories et les mots
se gèrent depuis une interface d'administration web.

## Technologies

- Node.js 22 et TypeScript
- Fastify pour l'API HTTP (profils, photos, messages vocaux, classement)
- Socket.IO pour le déroulement des parties en temps réel
- PostgreSQL pour les profils, l'historique des parties et le classement
- Docker Compose pour le déploiement

## Déroulement d'une partie

1. Chaque joueur crée son profil avec un nom et une photo.
2. Un joueur crée une partie et partage le code à 5 caractères.
3. Les autres rejoignent la partie avec ce code (3 à 12 joueurs).
4. L'hôte règle les paramètres puis lance la partie.
5. Chaque joueur touche sa carte pour voir son mot, dans le temps choisi par l'hôte.
6. Un ordre de passage est tiré au hasard. À son tour, chacun envoie un indice écrit ou vocal.
7. Après les tours d'indices, tout le monde vote. Le joueur le plus désigné est accusé (égalité : personne).
8. En mode classique, l'imposteur peut ensuite tenter de deviner le mot.
9. Les points sont attribués, puis l'hôte lance la manche suivante.

## Modes de jeu

| Mode | Fonctionnement |
| --- | --- |
| Mot similaire (par défaut) | L'imposteur reçoit un mot proche de celui des autres et ne sait pas qu'il est l'imposteur. Pas de devinette en fin de manche. |
| Classique | L'imposteur ne reçoit aucun mot, sait qu'il est l'imposteur et peut tenter de deviner le mot après le vote. |

En mode mot similaire, seuls les mots qui ont un mot d'imposteur sont tirés. Si la catégorie choisie n'en
contient aucun, la manche se joue en mode classique.

## Points

| Situation | Points |
| --- | --- |
| Imposteur démasqué | 1 point par joueur, 2 points pour ceux qui ont voté contre lui |
| Imposteur démasqué mais mot trouvé | 2 points pour l'imposteur, rien pour les autres |
| Imposteur non démasqué | 2 points pour l'imposteur |
| Imposteur non démasqué et mot trouvé | 3 points pour l'imposteur |

À la fin de la partie, les scores sont ajoutés au total de chaque joueur pour le classement général.

## Paramètres d'une partie

| Paramètre | Valeurs | Défaut |
| --- | --- | --- |
| Manches | 1 à 10 | 3 |
| Temps pour lire son mot | 10 à 120 s | 20 s |
| Mode | mot similaire / classique | mot similaire |
| Tours d'indices par manche | 1 à 3 | 2 |
| Temps par indice | 20 à 180 s | 60 s |
| Temps de vote | 20 à 180 s | 60 s |
| Catégorie | aléatoire ou une catégorie précise | aléatoire |
| L'imposteur voit la catégorie (mode classique) | oui / non | oui |

Un joueur qui ne joue pas avant la fin du temps passe son tour. Un joueur déconnecté plus de
8 secondes est ignoré pour les tours et les votes, et retrouve la partie dès qu'il se reconnecte.

## Administration

L'interface d'administration est disponible sur `/admin` (par exemple `http://151.80.60.71:3000/admin`).
Elle est protégée par le mot de passe défini dans la variable `ADMIN_PASSWORD` du fichier `.env`.
Sans mot de passe, l'administration est désactivée.

Elle permet de :

- consulter le nombre de joueurs, de parties, de catégories et de mots ;
- créer, renommer, masquer ou supprimer une catégorie ;
- ajouter, modifier ou supprimer des mots, chacun avec un mot similaire pour l'imposteur ;
- importer des mots en masse, un par ligne, au format `Plage ; Piscine`.

Les modifications sont prises en compte immédiatement pour les nouvelles manches. Au premier démarrage,
la base est remplie avec 8 catégories et environ 170 paires de mots.

## API HTTP

L'authentification se fait avec le jeton reçu à la création du profil : `Authorization: Bearer <jeton>`.

| Méthode | Route | Description |
| --- | --- | --- |
| GET | `/health` | État du serveur |
| GET | `/api/categories` | Catégories de mots |
| POST | `/api/players` | Création d'un profil `{ "name": "..." }`, renvoie le profil et le jeton |
| GET | `/api/players/me` | Profil courant |
| PATCH | `/api/players/me` | Modification du nom |
| POST | `/api/players/me/avatar` | Envoi de la photo de profil (multipart, champ `file`, jpeg/png/webp) |
| GET | `/api/players/me/games` | Dernières parties jouées |
| GET | `/api/leaderboard` | Classement général |
| POST | `/api/audio` | Envoi d'un indice vocal (multipart, champ `file`, m4a/aac/mp3/ogg/wav) |
| GET | `/api/rooms/:code` | Informations sur une partie |

Routes d'administration (jeton obtenu avec `/api/admin/login`) :

| Méthode | Route | Description |
| --- | --- | --- |
| POST | `/api/admin/login` | `{ "password": "..." }`, renvoie un jeton valable 12 heures |
| GET | `/api/admin/stats` | Statistiques |
| GET | `/api/admin/categories` | Catégories avec leurs mots |
| POST | `/api/admin/categories` | Création `{ "name": "..." }` |
| PATCH | `/api/admin/categories/:id` | Modification `{ "name", "active" }` |
| DELETE | `/api/admin/categories/:id` | Suppression avec ses mots |
| POST | `/api/admin/categories/:id/words` | Ajout `{ "words": [{ "word", "imposterWord" }] }` |
| PUT | `/api/admin/words/:id` | Modification d'un mot |
| DELETE | `/api/admin/words/:id` | Suppression d'un mot |

Les fichiers envoyés sont servis sous `/uploads/`.

## Événements Socket.IO

La connexion se fait avec `auth: { token }`. Chaque action reçoit une réponse
`{ ok: true, data }` ou `{ ok: false, error: { code, message } }`.

| Événement envoyé | Données |
| --- | --- |
| `room:create` | paramètres facultatifs |
| `room:join` | `{ code }` |
| `room:leave` | |
| `room:sync` | |
| `room:settings` | `{ rounds, revealSeconds, imposterMode, clueTurns, category, turnSeconds, voteSeconds, imposterSeesCategory }` |
| `room:kick` | `{ playerId }` |
| `game:start` | |
| `game:seen` | |
| `game:clue` | `{ type: "text", text }` ou `{ type: "audio", audioUrl, durationMs }` |
| `game:vote` | `{ targetId }` |
| `game:guess` | `{ guess }` |
| `game:next` | |
| `game:restart` | |

| Événement reçu | Description |
| --- | --- |
| `room:state` | État complet de la partie, propre à chaque joueur (le mot n'est jamais envoyé à l'imposteur) |
| `room:left` | Le joueur a quitté la partie ou en a été retiré |
| `room:none` | Le joueur n'est dans aucune partie |

## Développement

```bash
cp .env.example .env
docker compose up -d db
npm install
DATABASE_URL=postgres://impostor:changez-moi@localhost:5432/impostor npm run dev
```

Pour exposer la base en local pendant le développement, ajoutez `ports: ["5432:5432"]` au service `db`.

Tests :

```bash
npm test
```

## Déploiement

Sur le serveur, avec Docker et le plugin Compose installés :

```bash
git clone https://github.com/GUIND0/impostor-backend.git
cd impostor-backend
cp .env.example .env
```

Renseignez des mots de passe solides dans `POSTGRES_PASSWORD` et `ADMIN_PASSWORD`, puis :

```bash
sudo docker compose up -d --build
curl http://localhost:3000/health
```

Mise à jour :

```bash
git pull
sudo docker compose up -d --build
```

Les photos et messages vocaux sont conservés dans le volume `uploads`, la base dans `db-data`.

Pour la production, il est recommandé de placer le service derrière un reverse proxy (Nginx ou Caddy)
avec un nom de domaine et HTTPS, en transmettant les en-têtes `Upgrade` et `Connection` pour les WebSockets.
