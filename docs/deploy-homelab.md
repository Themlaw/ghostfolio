# Déployer le fork « copilote » sur un homelab

Ce guide installe ce fork de Ghostfolio sur un serveur personnel avec :

- connexion **uniquement via Authentik** (OIDC, PKCE, liste blanche sur votre compte) ;
- **notifications push** sur le téléphone (PWA, HTTPS obligatoire) ;
- **serveur MCP** joignable par claude.ai (OAuth 2.1) et par Claude Code ;
- sauvegardes PostgreSQL et procédure de mise à jour.

Les fichiers sont dans [`deploy/homelab/`](../deploy/homelab/) :

| Fichier                                   | Rôle                                                               |
| ----------------------------------------- | ------------------------------------------------------------------ |
| `docker-compose.yml`                      | Ghostfolio, PostgreSQL, Redis, et `cloudflared` (profil optionnel) |
| `docker-compose.traefik.yml`              | Surcharge : labels Traefik                                         |
| `docker-compose.build.yml`                | Surcharge : build local au lieu de l'image GHCR                    |
| `Caddyfile.example`                       | Bloc Caddy                                                         |
| `.env.example`, `.env.cloudflare.example` | Modèles de configuration                                           |
| `init-secrets.sh`                         | Génère les secrets dans `.env` (idempotent)                        |
| `backup.sh`                               | Sauvegarde `pg_dump` avec rotation                                 |

Le workflow `.github/workflows/docker-image-copilote.yml` construit l'image.

## 0. Prérequis

- Un hôte Docker avec Docker Compose v2.24 ou plus récent (amd64 ; arm64 aussi, par exemple un Raspberry Pi 4/5 en OS 64 bits). 2 Go de RAM libres suffisent pour exécuter l'image ; la compiler localement demande nettement plus (voir plus bas).
- Un **nom de domaine public** pointant vers votre homelab, en **HTTPS** (certificat valide). C'est indispensable : le service worker et les notifications push n'existent qu'en HTTPS, et claude.ai (qui tourne dans le cloud d'Anthropic) doit joindre `/mcp` depuis Internet.
- Une instance **Authentik** accessible depuis le conteneur Ghostfolio (le conteneur télécharge la découverte OIDC et les clés de signature).
- Un reverse proxy (Traefik, Caddy...) **ou** un compte Cloudflare pour un tunnel.

Dans la suite, `ghostfolio.example.com` désigne le domaine de Ghostfolio et `auth.example.com` celui d'Authentik.

## 1. Image Docker

### Option recommandée : image construite par GitHub Actions

À chaque `push` sur la branche `copilote`, le workflow `Docker image (copilote)` construit l'image pour `linux/amd64` et `linux/arm64` et la publie sur :

- `ghcr.io/themlaw/ghostfolio:copilote` (dernière version de la branche) ;
- `ghcr.io/themlaw/ghostfolio:sha-<commit court>` (version précise, pour revenir en arrière).

Le workflow n'a que les permissions `contents: read` et `packages: write`, et ses actions sont épinglées par SHA de commit. Il ne se déclenche pas si seuls `deploy/`, `docs/` ou des `.md` changent. Vous pouvez aussi le lancer à la main (onglet Actions, « Run workflow »).

Après le premier build, **rendez le paquet lisible par votre homelab** (une des deux façons) :

1. GitHub > votre profil > Packages > `ghostfolio` > Package settings > Change visibility > **Public**. Le plus simple : l'image ne contient pas de secret (ils sont dans `.env`). ou
2. Gardez-le privé et connectez-vous sur le homelab avec un jeton classique GitHub ayant uniquement le droit `read:packages` :
   `echo <jeton> | docker login ghcr.io -u Themlaw --password-stdin`

Le premier build prend 15 à 30 minutes (compilation de l'application et émulation arm64 pour l'étape finale) ; les suivants profitent du cache.

### Option : compiler sur le homelab

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

Prévoyez au moins 4 Go de RAM disponibles pour la compilation (Angular). Sur un Raspberry Pi, préférez l'image GHCR arm64.

## 2. Récupérer le kit et créer `.env`

```bash
git clone --branch copilote https://github.com/Themlaw/ghostfolio.git
cd ghostfolio/deploy/homelab
./init-secrets.sh
```

Le script crée `.env` (droits 600) depuis `.env.example` et génère `ACCESS_TOKEN_SALT`, `JWT_SECRET_KEY`, `POSTGRES_PASSWORD`, `REDIS_PASSWORD` et la paire de clés VAPID (avec `openssl` ; à défaut, avec `web-push` dans un conteneur `node:22-alpine`). Il **ne modifie jamais** une valeur déjà renseignée et peut donc être relancé. Il liste ce qu'il reste à remplir.

Éditez ensuite `.env` : `ROOT_URL`, `VAPID_SUBJECT` (`mailto:vous@exemple.fr`) et, après l'étape 4, `OIDC_*`. Sauvegardez `.env` dans votre gestionnaire de mots de passe : perdre `VAPID_PRIVATE_KEY` oblige à réactiver les notifications sur chaque appareil, et changer `ACCESS_TOKEN_SALT` invalide les jetons de sécurité existants.

Toutes les variables de `.env.example` existent dans `apps/api/src/services/configuration/configuration.service.ts`, sauf celles qui ne servent qu'à Docker Compose (`GHOSTFOLIO_IMAGE`, `GHOSTFOLIO_BIND`, `GHOSTFOLIO_PORT`, `GHOSTFOLIO_DOMAIN`, `PROXY_NETWORK`, `TRAEFIK_CERTRESOLVER`, `POSTGRES_DB/USER/PASSWORD`).

Réglages par défaut à connaître :

| Variable                              | Valeur   | Pourquoi                                                                                                |
| ------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| `JWT_EXPIRES_IN`                      | `7 days` | session de 7 jours ; la reconnexion via Authentik est rapide                                            |
| `ENABLE_FEATURE_RATE_LIMITING`        | `true`   | limite le débit sur les routes sensibles (connexion, OAuth). Nécessite `TRUST_PROXY`                    |
| `TRUST_PROXY`                         | `1`      | un seul proxy devant l'application. Mettre `2` si Cloudflare Tunnel **et** Traefik/Caddy sont en chaîne |
| `ENABLE_FEATURE_AUTH_TOKEN`           | `false`  | masque la connexion par jeton dans l'interface (OIDC seul)                                              |
| `ENABLE_FEATURE_AUTH_GOOGLE`          | `false`  | pas de connexion Google                                                                                 |
| `ENABLE_FEATURE_MCP`, `..._MCP_OAUTH` | `true`   | serveur MCP et OAuth 2.1 (exige `ROOT_URL` en HTTPS)                                                    |
| `ENABLE_FEATURE_REPORTS`              | `true`   | page « Veille » et décisions                                                                            |
| `MCP_ALLOW_LEGACY_TOKENS`             | `false`  | refuse les anciens jetons MCP                                                                           |

Limites de `ENABLE_FEATURE_AUTH_TOKEN=false` : cela ne masque que le bouton. La route d'API de connexion par jeton existe toujours, mais il n'y a aucun compte à jeton (ils ne se créent que par l'inscription publique, que l'étape 6 désactive).

## 3. Exposer Ghostfolio en HTTPS

Le conteneur n'écoute qu'en HTTP (port 3333) : le HTTPS est assuré par le proxy ou le tunnel. Seul le port de Ghostfolio est publié (par défaut sur `127.0.0.1`) ; PostgreSQL et Redis restent sur un réseau Docker interne **sans accès Internet ni hôte**. Ghostfolio, lui, a un second réseau (`web`) pour joindre Yahoo Finance, CoinGecko et Authentik.

### Variante A : reverse proxy existant

**Traefik** (dans Docker, avec un réseau partagé nommé `proxy`) :

```bash
# dans .env : GHOSTFOLIO_DOMAIN, PROXY_NETWORK, TRAEFIK_CERTRESOLVER
docker compose -f docker-compose.yml -f docker-compose.traefik.yml up -d
```

Vérifiez que l'entrypoint (`websecure`) et le resolver de certificats correspondent à votre Traefik (`docker-compose.traefik.yml`). **Ne mettez aucun middleware d'authentification** (forward-auth Authentik, basic auth) sur ce routeur.

**Caddy** : copiez le bloc de `Caddyfile.example` dans votre Caddyfile, adaptez le domaine et la cible (`127.0.0.1:3333` si Caddy est sur l'hôte ; `ghostfolio:3333` si Caddy est dans Docker et a rejoint le réseau `ghostfolio_web`), puis rechargez Caddy. Si le proxy est sur une autre machine, mettez `GHOSTFOLIO_BIND=<IP du LAN>` dans `.env`.

### Variante B : Cloudflare Tunnel

Pratique si vous ne voulez pas ouvrir de port sur votre box (ou si vous êtes derrière un CGNAT) :

1. Zero Trust > Networks > Tunnels > Create a tunnel (cloudflared). Copiez le **jeton**.
2. `cp .env.cloudflare.example .env.cloudflare`, collez le jeton après `TUNNEL_TOKEN=`, `chmod 600 .env.cloudflare`.
3. Dans le tunnel, onglet « Public hostname » : domaine `ghostfolio.example.com`, service `HTTP`, URL `ghostfolio:3333`.
4. `docker compose --profile cloudflare up -d`.

Le jeton est dans un fichier séparé afin de ne pas être transmis au conteneur Ghostfolio. Le DNS du domaine doit être géré par Cloudflare.

### Que faut-il exposer, et les compromis

Ghostfolio n'est **pas** placé derrière Authentik en forward-auth : il a sa propre authentification OIDC, et claude.ai, qui appelle `/mcp` depuis le cloud d'Anthropic, ne peut pas passer une page de connexion Authentik. Mettre un forward-auth, Cloudflare Access ou un basic auth devant tout le domaine casserait le connecteur.

**Recommandation : exposer tout Ghostfolio en HTTPS.** L'API exige un JWT, le serveur MCP exige un jeton, la connexion est liée à votre seul compte Authentik, et le rate limiting est actif. C'est aussi ce qu'il faut pour que le téléphone (PWA, notifications) fonctionne hors de chez vous.

Si vous voulez réduire la surface, voici ce que la technique permet, **non testé ici** : seules les routes suivantes sont appelées par les serveurs d'Anthropic.

| Chemin                                                                                                | Appelé par                    |
| ----------------------------------------------------------------------------------------------------- | ----------------------------- |
| `/mcp`                                                                                                | claude.ai (serveur à serveur) |
| `/.well-known/oauth-protected-resource/mcp`, `/.well-known/oauth-authorization-server`                | claude.ai                     |
| `POST /api/v1/oauth/register`, `POST /api/v1/oauth/token`, `POST /api/v1/oauth/revoke`                | claude.ai                     |
| `GET /api/v1/oauth/authorize`, page `/<langue>/oauth/consent` (et ses fichiers statiques et `/api/*`) | votre navigateur              |

La page de consentement est l'application Angular complète (fichiers statiques, `/api/v1/info`, connexion OIDC...) : filtrer par chemin est donc fragile. Une alternative raisonnable est un DNS « split-horizon » : le consentement se fait depuis votre navigateur, qui peut joindre Ghostfolio en LAN, mais cela empêche le téléphone de recevoir les notifications hors du domicile. Comme le gain est faible, gardez l'exposition complète.

Pour durcir sans casser quoi que ce soit : gardez le rate limiting, `TRUST_PROXY` correct, `OIDC_ALLOWED_SUBJECTS` renseigné, l'inscription désactivée, et surveillez les journaux (`docker compose logs -f ghostfolio`). Si vous utilisez la protection de Cloudflare (WAF, « Bot Fight Mode »), vérifiez qu'elle ne bloque pas les requêtes de claude.ai vers `/mcp` et `/api/v1/oauth/*`.

## 4. Authentik : créer l'application

Les libellés ci-dessous suivent la documentation d'intégration d'Authentik ; ils peuvent varier légèrement d'une version à l'autre (non vérifié sur une instance).

1. Interface d'administration > **Applications > Applications > Create** (l'assistant « Create with Provider »).
2. **Application** : nom `Ghostfolio`, **slug** `ghostfolio` (il fait partie de l'URL de l'émetteur), éventuellement l'URL de lancement `https://ghostfolio.example.com`.
3. **Type de fournisseur** : **OAuth2/OpenID Provider**.
4. Configuration du fournisseur :
   - **Authorization flow** : `default-provider-authorization-explicit-consent` (ou `implicit-consent` pour ne pas redemander à chaque fois) ;
   - **Client type** : **Confidential** ;
   - **Client ID** et **Client Secret** : générés par Authentik, à copier dans `OIDC_CLIENT_ID` et `OIDC_CLIENT_SECRET` ;
   - **Redirect URIs** : une entrée de type **Strict** (correspondance exacte) :
     `https://ghostfolio.example.com/api/auth/oidc/callback`
     (c'est le chemin `GET /api/auth/oidc/callback` du contrôleur d'authentification, préfixé par `ROOT_URL` ; il doit être identique à `OIDC_CALLBACK_URL`, ou à `ROOT_URL` + ce chemin si vous n'avez pas défini `OIDC_CALLBACK_URL`). Dans les versions d'Authentik qui n'ont pas le mode Strict, utilisez une expression exacte, par exemple `^https://ghostfolio\.example\.com/api/auth/oidc/callback$` ;
   - **Signing Key** : choisissez une clé (par exemple « authentik Self-signed Certificate »). Les jetons sont alors signés en **RS256**, vérifiables avec les clés publiées par Authentik. Sans clé de signature, Authentik signe en HS256 avec le secret client, ce qu'il vaut mieux éviter ;
   - **Scopes** : `openid`, `email`, `profile` (les mappings par défaut) ;
   - **Subject mode** (Advanced protocol settings) : **Based on the Hashed User ID** (défaut, stable). Alternative plus simple, voir plus bas : « Based on the User's Email ».
5. **Limiter l'accès à vous seul** : ouvrez l'application > onglet **Policy / Group / User Bindings** > **Bind existing policy/group/user** > onglet **User** > votre utilisateur. Dès qu'une liaison existe, seuls les utilisateurs liés peuvent ouvrir l'application. Sans liaison, tous les utilisateurs Authentik y ont accès. Cette règle s'ajoute à la liste blanche `OIDC_ALLOWED_SUBJECTS` de Ghostfolio (ceinture et bretelles).
6. L'émetteur à mettre dans `OIDC_ISSUER` est :
   `https://auth.example.com/application/o/ghostfolio/`
   **avec le slash final**. Vérifiez-le : `curl -s https://auth.example.com/application/o/ghostfolio/.well-known/openid-configuration` doit renvoyer un JSON dont le champ `issuer` est exactement cette valeur.

Renseignez dans `.env` : `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` (et `ROOT_URL`).

### Trouver votre `sub` pour `OIDC_ALLOWED_SUBJECTS`

Deux méthodes :

- **Sans première connexion (le plus propre)** : choisissez « Based on the User's Email » comme mode du sujet dans Authentik. Le `sub` est alors votre adresse e-mail Authentik, et vous pouvez écrire dès le départ `OIDC_ALLOWED_SUBJECTS=vous@exemple.fr`. Compromis : le `sub` change si vous changez d'e-mail.
- **Avec le mode « Hashed User ID » (défaut)** : démarrez avec les deux listes vides (la liaison Authentik de l'étape 5 vous protège pendant ce court instant), connectez-vous une fois, puis lisez le `sub` :
  ```bash
  docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
  SELECT id, role, "thirdPartyId" FROM "User";
  SQL
  ```
  La colonne `thirdPartyId` vaut `<émetteur>|<sub>` ; copiez la partie après le `|` dans `OIDC_ALLOWED_SUBJECTS`, puis `docker compose up -d` pour recharger.

Autre option : `OIDC_ALLOWED_EMAILS=vous@exemple.fr`, qui exige que le jeton contienne `email_verified=true` ; selon votre configuration Authentik ce n'est pas garanti, préférez `OIDC_ALLOWED_SUBJECTS`.

Si l'on définit les deux listes, un utilisateur est accepté s'il figure dans l'une **ou** l'autre.

## 5. Premier démarrage

```bash
cd deploy/homelab
docker compose pull          # (ou --build, voir plus haut)
docker compose up -d
docker compose logs -f ghostfolio
```

L'entrypoint de l'image lance tout seul `prisma migrate deploy` (y compris les migrations ajoutées par ce fork : rapports, jetons, OAuth), puis `prisma db seed`, puis le serveur. Il n'y a rien à lancer à la main ; le premier démarrage prend une à deux minutes (`start_period` du healthcheck : 90 s). Contrôle :

```bash
docker compose ps                                  # ghostfolio « healthy »
curl -s https://ghostfolio.example.com/api/v1/health   # {"status":"OK"}
curl -s https://ghostfolio.example.com/.well-known/oauth-authorization-server | head -c 300
```

Le dernier appel doit renvoyer du JSON (et non une erreur 404, signe que `ENABLE_FEATURE_MCP_OAUTH` ou `ROOT_URL` en HTTPS manque).

## 6. Créer le compte, devenir ADMIN, fermer l'inscription

1. Ouvrez `https://ghostfolio.example.com`, cliquez sur **Connexion** puis sur le bouton OIDC (« Sign in with OpenID Connect »). Authentik vous authentifie et vous revenez dans Ghostfolio.
2. **Le premier compte créé reçoit automatiquement le rôle `ADMIN`.** Il n'y a donc rien à faire si vous êtes le premier à vous connecter. Si un autre compte existait déjà (par exemple créé par inadvertance), promouvez le vôtre :
   ```bash
   docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
   UPDATE "User" SET role = 'ADMIN' WHERE "thirdPartyId" LIKE '%|<votre-sub>';
   SQL
   ```
3. **Désactivez l'inscription** : _Administration_ (menu du compte) > _Aperçu_ > interrupteur **« Inscription de Nouveaux Utilisateurs »** (`User Signup`) sur _off_. À faire **après** votre première connexion : la connexion OIDC crée le compte à la volée et refuse la création quand l'inscription est fermée. Un compte déjà créé continue de se connecter normalement.
4. Renseignez `OIDC_ALLOWED_SUBJECTS` (étape 4), `docker compose up -d`, puis vérifiez avec un autre compte Authentik (ou une fenêtre privée) que la connexion est refusée.

À partir de là, aucun autre compte ne peut se créer ni se connecter : `OIDC_ALLOWED_SUBJECTS` s'applique même aux comptes existants.

## 7. Notifications sur le téléphone (PWA)

Prérequis : HTTPS valide, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` et `VAPID_SUBJECT` renseignés.

- **Android (Chrome)** : ouvrez le site > menu ⋮ > **Installer l'application** (ou « Ajouter à l'écran d'accueil »).
- **iPhone / iPad (Safari, iOS 16.4 ou plus récent)** : bouton Partager > **Sur l'écran d'accueil**, puis ouvrez Ghostfolio **depuis l'icône** de l'écran d'accueil. Sous iOS, le push web ne fonctionne que dans l'application installée, pas dans un onglet Safari.
- Dans l'application, ouvrez **Compte > Paramètres** et activez **« Notifications sur cet appareil »** (`Notifications on this device`), puis acceptez la demande d'autorisation. Chaque appareil se règle séparément.
- Test : demandez à Claude (étape 9) d'envoyer une notification avec l'outil `send-notification`, ou publiez un rapport avec un point « important ».

Si l'interrupteur n'apparaît pas : vérifiez que la connexion est en HTTPS et que `ENABLE_FEATURE_REPORTS=true`. S'il est grisé, les notifications sont bloquées dans les réglages du navigateur ou du système.

## 8. Connecter Claude

### claude.ai

L'interface évolue ; d'après l'aide officielle de Claude (« Get started with custom connectors using remote MCP »), le chemin est **Paramètres (ou « Personnaliser ») > Connecteurs > + > Ajouter un connecteur personnalisé**. Si votre interface diffère, cherchez « connecteur personnalisé » ; sur les offres Team/Enterprise, seuls les propriétaires peuvent ajouter un connecteur.

1. Nom : `Ghostfolio`. URL : `https://ghostfolio.example.com/mcp`. **Laissez vides** l'ID et le secret client (Ghostfolio enregistre le client automatiquement).
2. Cliquez sur **Connecter** : le navigateur s'ouvre sur la page de consentement de Ghostfolio (`/fr/oauth/consent`).
3. Si vous n'êtes pas connecté, connectez-vous (Authentik), puis **relancez la connexion depuis claude.ai** : il n'y a pas de retour automatique à la page de consentement après la connexion.
4. Sur la page de consentement, la case **Lecture seule** est cochée par défaut. Pour la veille (publication de rapports, notifications), **décochez-la** ; gardez-la cochée si Claude ne doit que lire. Cliquez sur **Autoriser**.

Autorisations et révocation : les accès sont listés via `GET /api/v1/oauth/grants` et se révoquent via `DELETE /api/v1/oauth/grants/:id` (pas d'écran dédié) ; supprimer le connecteur dans claude.ai révoque aussi le jeton.

### Claude Code

```bash
claude mcp add --transport http ghostfolio https://ghostfolio.example.com/mcp
```

Puis `/mcp` dans Claude Code > `ghostfolio` > **Authenticate** : même page de consentement. Variante sans OAuth avec un jeton `gfmcp_` créé dans Ghostfolio (page des accès, type MCP) :

```bash
claude mcp add --transport http ghostfolio https://ghostfolio.example.com/mcp \
  --header "Authorization: Bearer gfmcp_..."
```

## 9. Recréer la tâche planifiée de veille

Les tâches planifiées sont enregistrées côté Claude, pas dans Ghostfolio : si vous changez d'URL (passage du développement au homelab), le connecteur change aussi. À refaire :

1. Vérifiez que le connecteur `Ghostfolio` est connecté (étape 8) avec l'autorisation d'écriture (case « Lecture seule » décochée).
2. Dans claude.ai, ouvrez la page des **tâches planifiées** (l'emplacement exact et son nom varient selon l'offre et la version de l'interface : cherchez « Scheduled tasks » / « Tâches planifiées » ou « Routines » ; je n'ai pas pu le vérifier) et créez une tâche : fréquence (par exemple chaque jour ouvré, hors des heures de pointe), et **autorisez le connecteur Ghostfolio** pour cette tâche (les connecteurs ne sont pas toujours repris automatiquement).
3. Texte de la tâche, à adapter (il s'appuie sur les outils MCP réels du fork, voir `docs/mcp-copilote.md`) :

   > Fais ma veille d'investissement. 1) Appelle `get-decision-answers` avec `since` = la date de la dernière veille et `get-open-decisions` pour tenir compte de mes décisions. 2) Lis mon portefeuille et ma watchlist avec les outils Ghostfolio. 3) Recherche l'actualité des positions. 4) Publie le résultat avec `publish-report` (type BRIEF), avec les points importants marqués `important` et, si une décision est nécessaire, une décision avec ses options. Ne réponds jamais à une décision à ma place.

4. Lancez la tâche une fois à la main et vérifiez : le rapport apparaît dans **Accueil > Veille**, et la notification arrive sur le téléphone.

## 10. Sauvegardes

La base PostgreSQL contient tout (volume Docker `ghostfolio_postgres`). `backup.sh` fait un `pg_dump` compressé et garde les 14 dernières copies :

```bash
./backup.sh                  # écrit dans ./backups (ignoré par git)
./backup.sh /mnt/nas/ghostfolio
```

Planification par `cron` (`crontab -e`) :

```cron
30 3 * * * /chemin/vers/ghostfolio/deploy/homelab/backup.sh /mnt/nas/ghostfolio >> /var/log/ghostfolio-backup.log 2>&1
```

Copiez aussi les sauvegardes **hors de la machine**, et gardez `.env` dans votre gestionnaire de mots de passe (sans `.env`, la base seule ne suffit pas à tout rétablir : clés VAPID, salage...).

Restauration (sur une pile vide ou après `docker compose down` + suppression du volume) :

```bash
docker compose up -d postgres
docker compose exec -T postgres sh -c 'pg_restore --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < backups/ghostfolio-AAAAMMJJ-HHMMSS.dump
docker compose up -d
```

Essayez une restauration à blanc au moins une fois.

## 11. Mises à jour

Mettre à jour le fork depuis Ghostfolio amont, sur votre machine de développement :

```bash
git checkout copilote
git fetch upstream
git merge upstream/main          # résoudre les conflits éventuels
# lancer les tests ; puis (vous) :
git push origin copilote         # déclenche le workflow qui publie l'image
```

Sur le homelab, une fois le workflow terminé :

```bash
cd ghostfolio && git pull        # pour récupérer le kit de déploiement
cd deploy/homelab
./backup.sh                      # toujours sauvegarder avant
docker compose pull
docker compose up -d             # les migrations s'appliquent au démarrage
docker compose logs -f ghostfolio
```

Pour figer ou revenir en arrière : mettez `GHOSTFOLIO_IMAGE=ghcr.io/themlaw/ghostfolio:sha-<commit>` dans `.env`. Les migrations Prisma ne se défont pas : pour revenir à une version plus ancienne après une migration, restaurez la sauvegarde faite avant la mise à jour.

Les images PostgreSQL (15) et Redis (8) sont celles de le `docker/docker-compose.yml` amont ; ne changez pas la version majeure de PostgreSQL sans migration des données (`pg_dump` puis `pg_restore` dans une nouvelle version).

## Dépannage

| Symptôme                                             | Piste                                                                                                                                                      |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Retour sur `/auth?error=oidc`                        | `docker compose logs ghostfolio` ; `redirect_uri` non identique dans Authentik, `OIDC_ISSUER` sans slash final, `sub` absent de la liste, jeton illisible. |
| Ghostfolio ne démarre pas, erreur de variable        | Variable obligatoire manquante : `ACCESS_TOKEN_SALT`, `JWT_SECRET_KEY`, et `OIDC_CLIENT_ID`/`SECRET`/`ISSUER` si l'OIDC est activé.                        |
| Le conteneur ne joint pas Authentik                  | DNS/split-horizon depuis le conteneur : `docker compose exec ghostfolio curl -sI https://auth.example.com`.                                                |
| `/.well-known/oauth-authorization-server` répond 404 | `ENABLE_FEATURE_MCP_OAUTH` ou `ENABLE_FEATURE_MCP` à `false`, ou `ROOT_URL` pas en HTTPS (le journal le signale).                                          |
| claude.ai ne se connecte pas                         | Un forward-auth/Cloudflare Access/WAF devant le domaine ; `ROOT_URL` différent du domaine réellement utilisé (`/mcp` n'accepte que son hôte).              |
| Pas de notification                                  | HTTPS, `VAPID_*` complets, PWA installée (iOS), interrupteur activé sur l'appareil, notifications autorisées dans le système.                              |
| Rate limiting appliqué à tout le monde à la fois     | `TRUST_PROXY` incorrect : 1 proxy = `1`, Cloudflare Tunnel + proxy = `2`.                                                                                  |
