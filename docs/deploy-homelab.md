# Déployer le fork « copilote » sur un homelab (Komodo + Pangolin)

Ce guide installe ce fork de Ghostfolio avec **Komodo** (gestion des stacks Docker) et **Pangolin** (reverse proxy tunnelé, agent **Newt**) :

- connexion **uniquement via Authentik** (OIDC, PKCE, liste blanche sur votre compte) ;
- **notifications push** sur le téléphone (PWA, HTTPS obligatoire) ;
- **serveur MCP** joignable par claude.ai (OAuth 2.1) et par Claude Code ;
- **contrôle de l'en-tête Host** (réponse 421 hors de votre domaine) ;
- sauvegardes PostgreSQL et procédure de mise à jour.

Les fichiers sont dans [`deploy/homelab/`](../deploy/homelab/) :

| Fichier                    | Rôle                                                                           |
| -------------------------- | ------------------------------------------------------------------------------ |
| `docker-compose.yml`       | À coller dans la stack Komodo : Ghostfolio, PostgreSQL, Redis (aucun port)     |
| `komodo.env.example`       | À coller dans le champ Environment de la stack (variante `[[SECRET]]` incluse) |
| `print-secrets.sh`         | Affiche des secrets prêts à coller (openssl seul, n'écrit rien)                |
| `backup.sh`                | Sauvegarde `pg_dump` avec rotation                                             |
| `docker-compose.build.yml` | Surcharge pour compiler l'image localement (stack sur dépôt Git)               |

Le workflow `.github/workflows/docker-image-copilote.yml` construit l'image.

**Ce qui a été vérifié, et ce qui ne l'a pas été.** Les pages de documentation de Komodo (stacks, variables) et de Pangolin (ressources, règles, en-têtes, cibles) ont été lues dans leurs dépôts GitHub sources. Rien n'a été testé sur une vraie instance Komodo ou Pangolin : les libellés de l'interface peuvent différer, et les points marqués « non vérifié » sont à contrôler chez vous.

## 0. Prérequis

- Komodo (Core + agent Periphery) sur l'hôte Docker (amd64 ; arm64 aussi, par exemple un Raspberry Pi 4/5 en OS 64 bits). 2 Go de RAM libres suffisent pour exécuter l'image.
- Pangolin avec un **site** (agent **Newt**) qui peut joindre l'hôte Docker, et un **domaine** géré dans Pangolin (HTTPS, certificat émis par Pangolin). HTTPS est indispensable : le service worker et le push n'existent qu'en HTTPS, et claude.ai (cloud d'Anthropic) doit joindre `/mcp` depuis Internet.
- Une instance **Authentik** accessible depuis le conteneur Ghostfolio (découverte OIDC et clés de signature).

Dans la suite, `ghostfolio.example.com` désigne le domaine de Ghostfolio et `auth.example.com` celui d'Authentik.

## 1. Image Docker

À chaque `push` sur la branche `copilote`, le workflow `Docker image (copilote)` construit l'image pour `linux/amd64` et `linux/arm64` et la publie sur :

- `ghcr.io/themlaw/ghostfolio:copilote` (dernière version de la branche) ;
- `ghcr.io/themlaw/ghostfolio:sha-<commit court>` (version précise, pour revenir en arrière).

Le workflow n'a que les permissions `contents: read` et `packages: write`, et ses actions sont épinglées par SHA. Il ne se déclenche pas si seuls `deploy/`, `docs/` ou des `.md` changent. Vous pouvez aussi le lancer à la main (onglet Actions, « Run workflow »).

Après le premier build, **rendez le paquet lisible par votre homelab** (une des deux façons) :

1. GitHub > votre profil > Packages > `ghostfolio` > Package settings > Change visibility > **Public**. Le plus simple : l'image ne contient aucun secret. ou
2. Gardez-le privé et connectez l'hôte avec un jeton classique GitHub ayant uniquement `read:packages` : `echo <jeton> | docker login ghcr.io -u Themlaw --password-stdin` (sur l'hôte de Periphery). Komodo sait aussi gérer des comptes de registre (Settings > Providers ; non vérifié ici).

Le premier build prend 15 à 30 minutes ; les suivants profitent du cache.

Compiler sur le homelab (au moins 4 Go de RAM) suppose une stack sur **dépôt Git** (et non « UI defined ») : ajoutez `docker-compose.build.yml` aux fichiers de la stack. Sur un Raspberry Pi, préférez l'image GHCR arm64.

## 2. Créer la stack dans Komodo

D'après la documentation de Komodo, une stack peut avoir ses fichiers compose **écrits dans l'interface** (« UI defined » : Komodo les dépose sur l'hôte au déploiement) ; le champ **Environment** est écrit dans un fichier d'environnement passé à `docker compose --env-file`, et **réécrit à chaque déploiement** : ne modifiez jamais ce fichier à la main sur l'hôte. Compose interpole alors les `${VAR}` du compose avec ces valeurs.

1. Générez les secrets sur n'importe quelle machine disposant d'`openssl` :
   ```bash
   git clone --branch copilote https://github.com/Themlaw/ghostfolio.git
   ./ghostfolio/deploy/homelab/print-secrets.sh
   ```
   Le script affiche `ACCESS_TOKEN_SALT`, `JWT_SECRET_KEY`, `POSTGRES_PASSWORD`, `REDIS_PASSWORD` (`openssl rand -hex 32`) et la paire VAPID (EC P-256, clés brutes en base64url, générées avec `openssl` seul), au format `NOM=valeur`. Il n'écrit rien : chaque exécution donne de nouvelles valeurs, donc **exécutez-le une fois** et gardez le résultat dans votre gestionnaire de mots de passe. Les clés VAPID générées ont été vérifiées avec la bibliothèque `web-push` de ce dépôt (`setVapidDetails`, clé publique dérivée de la privée).
2. Komodo > Stacks > **New Stack**, nom `ghostfolio`, serveur = votre hôte Docker. Laissez la stack en mode « UI defined » (ni dépôt Git, ni fichiers sur l'hôte).
3. Dans la configuration de la stack, collez **`docker-compose.yml`** dans l'éditeur de fichier compose, et **`komodo.env.example`** dans **Environment**. Remplacez `ROOT_URL`, `OIDC_*` (après l'étape 4), `VAPID_SUBJECT`, et collez les secrets de l'étape 1.
4. **Variante Secrets globaux de Komodo.** Komodo permet de créer des Variables dans _Settings > Variables_ avec l'option « secret » (masquées dans les journaux et réservées aux administrateurs) et de les interpoler dans l'Environment avec la syntaxe `[[NOM]]`, par exemple `ACCESS_TOKEN_SALT=[[GHOSTFOLIO_ACCESS_TOKEN_SALT]]` (la liste est dans `komodo.env.example`). Avantage : les valeurs ne figurent plus dans la configuration de la stack. Inconvénient : elles sont dans la base de Komodo ; sauvegardez-la aussi.
5. **Save**, puis **Deploy**. Si une variable obligatoire manque, le déploiement échoue immédiatement avec un message du type `required variable JWT_SECRET_KEY is missing a value: JWT_SECRET_KEY est obligatoire (...)`.

Réglages par défaut du kit (modifiables dans l'Environment) :

| Variable                                | Valeur        | Pourquoi                                                                                             |
| --------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------- |
| `ENABLE_FEATURE_HOST_VALIDATION`        | `true`        | refuse les requêtes dont le Host n'est pas `ROOT_URL` (voir plus bas)                                |
| `TRUST_PROXY`                           | `uniquelocal` | le trafic arrive depuis Newt, sur un réseau Docker privé (voir plus bas)                             |
| `ENABLE_FEATURE_RATE_LIMITING`          | `true`        | limite le débit sur les routes sensibles ; nécessite un `TRUST_PROXY` correct                        |
| `JWT_EXPIRES_IN`                        | `7 days`      | session de 7 jours ; la reconnexion via Authentik est rapide                                         |
| `ENABLE_FEATURE_AUTH_TOKEN` / `_GOOGLE` | `false`       | OIDC seul (le bouton jeton est masqué ; il n'y a aucun compte à jeton une fois l'inscription fermée) |
| `ENABLE_FEATURE_MCP`, `..._MCP_OAUTH`   | `true`        | serveur MCP et OAuth 2.1 (exige `ROOT_URL` en HTTPS)                                                 |
| `ENABLE_FEATURE_REPORTS`                | `true`        | page « Veille » et décisions                                                                         |
| `MCP_ALLOW_LEGACY_TOKENS`               | `false`       | refuse les anciens jetons MCP                                                                        |

Chaque variable de l'application est listée dans `environment:` du compose : une variable ajoutée dans Komodo mais absente de cette liste n'atteint pas le conteneur. Pour en ajouter une, éditez aussi le compose.

## 3. Exposer Ghostfolio avec Pangolin

Le compose **ne publie aucun port**. Ghostfolio écoute en HTTP sur le port **3333** (`PORT` par défaut, `EXPOSE` du Dockerfile) ; Pangolin assure le HTTPS. PostgreSQL et Redis restent sur un réseau interne **sans accès Internet ni hôte**.

### Brancher Newt

- **Newt sur le même hôte (cas courant).** Le réseau `web` de la stack porte un nom fixe, `ghostfolio_web` (variable `GHOSTFOLIO_WEB_NETWORK`). Faites rejoindre ce réseau au conteneur Newt, dans sa propre stack ou la vôtre :
  ```yaml
  services:
    newt:
      # ... image, PANGOLIN_ENDPOINT, NEWT_ID, NEWT_SECRET comme d'habitude ...
      networks:
        - ghostfolio_web
  networks:
    ghostfolio_web:
      external: true
  ```
  Déployez d'abord la stack Ghostfolio (qui crée le réseau). Dans Pangolin, la cible est alors `ghostfolio` (nom du conteneur et du service), port `3333`. D'après la documentation de Pangolin, avec un réseau Docker défini, les noms d'hôte sont utilisés pour la découverte via le socket Docker.
- **Newt sur une autre machine.** Il ne voit pas le réseau Docker : publiez le port sur l'adresse du LAN dans le compose, sous le service `ghostfolio` : `ports: ['192.168.1.10:3333:3333']`. Cible Pangolin : `192.168.1.10:3333`. Ne liez pas `0.0.0.0` si l'hôte est exposé à Internet. Avec un port publié, le pair vu par Ghostfolio est l'adresse du LAN de Newt : `TRUST_PROXY=uniquelocal` reste valable, mais seule cette machine doit pouvoir joindre le port (pare-feu).

### Créer la ressource

1. Pangolin > Resources > **Add resource** > type **HTTP/HTTPS**. Nom `Ghostfolio`, domaine `ghostfolio.example.com` (sous-domaine d'un domaine géré par Pangolin), HTTPS actif.
2. Cible : le site de Newt, méthode `http`, hôte `ghostfolio`, port `3333`. **Laissez vide l'option « Custom Host Header »** : d'après la documentation de Pangolin, sans elle la requête arrive avec le nom d'hôte public de la ressource, ce que le contrôle de l'hôte de Ghostfolio attend. Si vous la renseignez, ajoutez cette valeur à `ALLOWED_HOSTS`.
3. Authentification : voir la section suivante (par défaut, Pangolin active son SSO sur toute nouvelle ressource).

### SSO de Pangolin : à ne pas activer sur cette ressource

Par défaut, une ressource Pangolin exige une connexion à Pangolin (« Platform SSO ») avant que la requête n'atteigne l'application. C'est **incompatible avec claude.ai** : claude.ai appelle `/mcp`, `/.well-known/oauth-*` et `/api/v1/oauth/{register,token,revoke}` **de serveur à serveur**, depuis le cloud d'Anthropic, sans navigateur ni cookie Pangolin ; il recevrait une redirection vers la page de connexion de Pangolin et le connecteur échouerait.

Deux options :

**A. Pas de SSO Pangolin sur la ressource (recommandé).** Désactivez les méthodes d'authentification de la ressource (SSO, PIN, mot de passe, e-mail). Ghostfolio a sa propre connexion (Authentik, liste blanche `OIDC_ALLOWED_SUBJECTS`, inscription fermée) ; l'API exige un JWT, `/mcp` un jeton OAuth, le rate limiting est actif et le contrôle de l'hôte filtre les requêtes mal adressées. Le téléphone (PWA, notifications) et Claude Code fonctionnent sans rien de plus. C'est l'option la plus simple et celle qui casse le moins de choses.

**B. SSO Pangolin + règles de contournement.** Pangolin permet des règles classées (onglet « Rules ») dont l'action « Bypass Auth » laisse passer sans authentification les chemins correspondants. Les motifs de chemin se comparent segment par segment, `*` remplaçant des caractères au sein d'un segment. Il faudrait contourner : `mcp` et `mcp/*`, `.well-known/*`, `api/v1/oauth/*`. Ce que cela implique :

- le navigateur et la PWA doivent aussi ouvrir une session Pangolin en plus d'Authentik (double connexion) ; une session Pangolin expirée fait échouer les appels `/api/*` de l'application (réponse de redirection au lieu de JSON) et peut perturber la PWA ;
- tout autre client d'API (scripts, `/api/v1/...` avec jeton) est bloqué tant qu'il n'a pas de session Pangolin, sauf à ajouter d'autres règles ;
- les chemins contournés restent exposés à Internet, protégés par les seules défenses de Ghostfolio : le SSO Pangolin n'apporte donc pas de protection supplémentaire là où les attaquants peuvent aller (`/mcp`, OAuth). Il ne protège que le reste de l'application, déjà protégé par le JWT ;
- les règles sont à tester (non vérifié ici), par exemple avec `curl -i https://ghostfolio.example.com/.well-known/oauth-authorization-server` qui doit renvoyer du JSON, pas une page de connexion.

Choisissez B seulement si vous voulez absolument une couche Pangolin devant l'interface web. Dans les deux cas, une règle Pangolin « Block » sur `admin/queues*` (interface Bull Board) est une défense en profondeur gratuite ; Bull Board a de toute façon sa propre authentification.

### Pourquoi `ROOT_URL` et le contrôle de l'hôte comptent

Ghostfolio construit des URL à partir de `ROOT_URL` (callback OIDC, métadonnées OAuth, redirections) et le serveur MCP n'accepte que son nom d'hôte. Si l'application répond aussi à d'autres noms d'hôte (adresse IP du serveur, domaine oublié, DNS d'un attaquant pointant vers votre IP), un en-tête `Host` forgé peut servir à contourner ces contrôles, à empoisonner des liens ou des redirections, ou à lancer une attaque de « DNS rebinding » depuis le navigateur d'une victime vers votre service. Avec `ENABLE_FEATURE_HOST_VALIDATION=true`, Ghostfolio répond **421 Misdirected Request** (corps minimal, sans détail) à toute requête dont le `Host`, sans le port et sans tenir compte de la casse, n'est pas celui de `ROOT_URL` ou de `ALLOWED_HOSTS` (liste séparée par des virgules). Les adresses `localhost`, `127.0.0.1` et `::1` ne sont acceptées que pour `/api/v1/health*`, afin que le healthcheck Docker fonctionne. Seul l'en-tête `Host` compte : `X-Forwarded-Host` est ignoré, car un client peut le forger. Si la variable est activée sans `ROOT_URL`, Ghostfolio **refuse de démarrer** (une protection demandée qui se désactiverait en silence serait pire qu'un échec visible).

### `TRUST_PROXY`

Ghostfolio a besoin de la vraie IP du client (rate limiting, journaux). Le pair TCP de Ghostfolio est le conteneur Newt, sur une adresse privée du réseau Docker ; Pangolin ajoute l'IP du client à `X-Forwarded-For`. `TRUST_PROXY=uniquelocal` (valeur acceptée par Express : nombre de sauts, `loopback`, `linklocal`, `uniquelocal`, adresse ou CIDR, liste séparée par des virgules) fait confiance aux adresses privées et lit l'IP du client dans l'en-tête. Sans cette valeur, tous les clients partagent la même limite de débit (celle de Newt). Précautions :

- ne publiez pas le port de Ghostfolio vers Internet : n'importe qui pourrait alors forger `X-Forwarded-For` ;
- si un client de votre LAN se connecte via Pangolin, son IP privée est traitée comme un proxy et ignorée (effet mineur) ;
- si Pangolin est derrière un autre proxy public (Cloudflare, par exemple), l'IP de celui-ci n'est pas privée : utilisez plutôt `TRUST_PROXY=uniquelocal,<CIDR de ce proxy>` ou un nombre de sauts. Le comportement exact d'`X-Forwarded-For` chez Pangolin/Newt n'est pas décrit dans la documentation lue : vérifiez, par exemple depuis les journaux de Ghostfolio, que les clients ont bien des IP distinctes.

### Autres reverse proxies (annexe)

Traefik, Caddy, nginx ou Cloudflare Tunnel conviennent aussi : le principe est le même (cible `http://ghostfolio:3333` sur le réseau `ghostfolio_web`, ou port publié sur l'hôte). Réglez `ROOT_URL` sur le domaine réel, laissez `ENABLE_FEATURE_HOST_VALIDATION=true`, mettez `TRUST_PROXY` au nombre de proxys devant l'application (`1` pour un seul), et **n'ajoutez aucune authentification devant le domaine** (forward-auth, Cloudflare Access, basic auth), pour la même raison que le SSO Pangolin. Les anciens fichiers Traefik, Caddy et Cloudflare Tunnel du kit ont été supprimés (ils dépendaient d'un `.env` écrit à la main).

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

Renseignez dans l'Environment de la stack Komodo : `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` (et `ROOT_URL`).

### Trouver votre `sub` pour `OIDC_ALLOWED_SUBJECTS`

Deux méthodes :

- **Sans première connexion (le plus propre)** : choisissez « Based on the User's Email » comme mode du sujet dans Authentik. Le `sub` est alors votre adresse e-mail Authentik, et vous pouvez écrire dès le départ `OIDC_ALLOWED_SUBJECTS=vous@exemple.fr`. Compromis : le `sub` change si vous changez d'e-mail.
- **Avec le mode « Hashed User ID » (défaut)** : démarrez avec les deux listes vides (la liaison Authentik de l'étape 5 vous protège pendant ce court instant), connectez-vous une fois, puis lisez le `sub` :
  ```bash
  docker exec -i gf-postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
  SELECT id, role, "thirdPartyId" FROM "User";
  SQL
  ```
  La colonne `thirdPartyId` vaut `<émetteur>|<sub>` ; copiez la partie après le `|` dans `OIDC_ALLOWED_SUBJECTS`, puis redéployez la stack dans Komodo pour recharger.

Autre option : `OIDC_ALLOWED_EMAILS=vous@exemple.fr`, qui exige que le jeton contienne `email_verified=true` ; selon votre configuration Authentik ce n'est pas garanti, préférez `OIDC_ALLOWED_SUBJECTS`.

Si l'on définit les deux listes, un utilisateur est accepté s'il figure dans l'une **ou** l'autre.

## 5. Premier démarrage

Dans Komodo, **Deploy** la stack, puis suivez les journaux de `ghostfolio` (onglet Log). L'entrypoint de l'image lance tout seul `prisma migrate deploy` (y compris les migrations de ce fork : rapports, jetons, OAuth), puis `prisma db seed`, puis le serveur. Le premier démarrage prend une à deux minutes (`start_period` du healthcheck : 90 s). Contrôle :

```bash
docker ps --filter name=ghostfolio                       # ghostfolio « healthy »
curl -s https://ghostfolio.example.com/api/v1/health     # {"status":"OK"}
curl -s https://ghostfolio.example.com/.well-known/oauth-authorization-server | head -c 300
curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: autre.example.org' https://ghostfolio.example.com/api/v1/health   # attendu : pas 200
```

Le troisième appel doit renvoyer du JSON (une 404 signale `ENABLE_FEATURE_MCP_OAUTH` ou `ROOT_URL` en HTTPS manquant). Le quatrième envoie un `Host` forgé ; Pangolin peut répondre lui-même 404 avant Ghostfolio. Pour tester le contrôle de l'hôte de bout en bout, depuis l'hôte : `docker exec ghostfolio curl -s -o /dev/null -w '%{http_code}\n' -H 'Host: autre.example.org' http://localhost:3333/api/v1/health` doit afficher `421` (alors que sans `-H`, `localhost` est accepté sur cette route de santé).

## 6. Créer le compte, devenir ADMIN, fermer l'inscription

1. Ouvrez `https://ghostfolio.example.com`, cliquez sur **Connexion** puis sur le bouton OIDC (« Sign in with OpenID Connect »). Authentik vous authentifie et vous revenez dans Ghostfolio.
2. **Le premier compte créé reçoit automatiquement le rôle `ADMIN`.** Il n'y a donc rien à faire si vous êtes le premier à vous connecter. Si un autre compte existait déjà (par exemple créé par inadvertance), promouvez le vôtre :
   ```bash
   docker exec -i gf-postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' <<'SQL'
   UPDATE "User" SET role = 'ADMIN' WHERE "thirdPartyId" LIKE '%|<votre-sub>';
   SQL
   ```
3. **Désactivez l'inscription** : _Administration_ (menu du compte) > _Aperçu_ > interrupteur **« Inscription de Nouveaux Utilisateurs »** (`User Signup`) sur _off_. À faire **après** votre première connexion : la connexion OIDC crée le compte à la volée et refuse la création quand l'inscription est fermée. Un compte déjà créé continue de se connecter normalement.
4. Renseignez `OIDC_ALLOWED_SUBJECTS` (étape 4), redéployez la stack, puis vérifiez avec un autre compte Authentik (ou une fenêtre privée) que la connexion est refusée.

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

La base PostgreSQL contient tout (volume Docker `ghostfolio_postgres`). `backup.sh` fait un `pg_dump` compressé (via `docker exec gf-postgres`, quel que soit le dossier de la stack Komodo) et garde les 14 dernières copies ; lancez-le depuis un clone du dépôt sur l'hôte :

```bash
./backup.sh                  # écrit dans ./backups (ignoré par git)
./backup.sh /mnt/nas/ghostfolio
```

Planification par `cron` (`crontab -e`) ; Komodo propose aussi des Procedures/Actions planifiées, qui peuvent faire la même chose (non vérifié ici) :

```cron
30 3 * * * /chemin/vers/ghostfolio/deploy/homelab/backup.sh /mnt/nas/ghostfolio >> /var/log/ghostfolio-backup.log 2>&1
```

Copiez aussi les sauvegardes **hors de la machine**, et gardez l'**Environment de la stack** (secrets, clés VAPID) dans votre gestionnaire de mots de passe : sans eux, la base seule ne suffit pas à tout rétablir.

Restauration (sur une pile vide, après avoir supprimé le volume) : déployez la stack, puis

```bash
docker exec -i gf-postgres sh -c 'pg_restore --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < backups/ghostfolio-AAAAMMJJ-HHMMSS.dump
```

et redéployez. Essayez une restauration à blanc au moins une fois.

## 11. Mises à jour

Mettre à jour le fork depuis Ghostfolio amont, sur votre machine de développement :

```bash
git checkout copilote
git fetch upstream
git merge upstream/main          # résoudre les conflits éventuels
# lancer les tests ; puis (vous) :
git push origin copilote         # déclenche le workflow qui publie l'image
```

Sur le homelab, une fois le workflow terminé : lancez `backup.sh`, puis dans Komodo **Pull** (ou « Deploy » avec récupération des images) et **Redeploy** la stack ; les migrations s'appliquent au démarrage. Pour recopier `docker-compose.yml` ou `komodo.env.example` à jour, collez-les à nouveau dans la stack (le champ Environment gardera vos valeurs si vous ne le remplacez pas ; ajoutez seulement les nouvelles variables). Komodo propose aussi l'option `auto_update` / `poll_for_updates` sur les stacks ; elle redéploie quand l'image change : à n'activer que si vous acceptez des migrations automatiques.

Pour figer ou revenir en arrière : `GHOSTFOLIO_IMAGE=ghcr.io/themlaw/ghostfolio:sha-<commit>` dans l'Environment. Les migrations Prisma ne se défont pas : pour revenir à une version plus ancienne après une migration, restaurez la sauvegarde faite avant la mise à jour.

Les images PostgreSQL (15) et Redis (8) sont celles du `docker/docker-compose.yml` amont ; ne changez pas la version majeure de PostgreSQL sans migration des données (`pg_dump` puis `pg_restore` dans une nouvelle version).

## Dépannage

| Symptôme                                                                           | Piste                                                                                                                                                                      |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Le déploiement échoue : `required variable X is missing a value`                   | Variable obligatoire absente ou vide de l'Environment de la stack (secrets, `ROOT_URL`, `OIDC_*`, `VAPID_*`).                                                              |
| Ghostfolio refuse de démarrer : `ENABLE_FEATURE_HOST_VALIDATION requires ROOT_URL` | `ROOT_URL` non transmis : vérifiez l'Environment.                                                                                                                          |
| Réponse 421 sur le site                                                            | Le `Host` reçu n'est pas celui de `ROOT_URL` : « Custom Host Header » de Pangolin renseigné (ajoutez-le à `ALLOWED_HOSTS`), domaine différent de `ROOT_URL`, accès par IP. |
| Conteneur `unhealthy`                                                              | `docker logs ghostfolio` ; migrations encore en cours (90 s), base ou Redis injoignable, mot de passe de la base différent de celui de la première initialisation.         |
| Pangolin : 502 / cible injoignable                                                 | Newt n'est pas sur le réseau `ghostfolio_web`, ou la cible n'est pas `ghostfolio:3333`.                                                                                    |
| Retour sur `/auth?error=oidc`                                                      | `docker logs ghostfolio` ; `redirect_uri` non identique dans Authentik, `OIDC_ISSUER` sans slash final, `sub` absent de la liste, jeton illisible.                         |
| Le conteneur ne joint pas Authentik                                                | DNS/split-horizon depuis le conteneur : `docker exec ghostfolio curl -sI https://auth.example.com`.                                                                        |
| `/.well-known/oauth-authorization-server` répond 404                               | `ENABLE_FEATURE_MCP_OAUTH` ou `ENABLE_FEATURE_MCP` à `false`, ou `ROOT_URL` pas en HTTPS (le journal le signale).                                                          |
| claude.ai ne se connecte pas                                                       | SSO Pangolin actif sur la ressource sans règles de contournement, WAF, ou `ROOT_URL` différent du domaine utilisé (`/mcp` n'accepte que son hôte).                         |
| Pas de notification                                                                | HTTPS, `VAPID_*` complets, PWA installée (iOS), interrupteur activé sur l'appareil, notifications autorisées dans le système.                                              |
| Rate limiting appliqué à tout le monde à la fois                                   | `TRUST_PROXY` incorrect (voir la section « TRUST_PROXY »).                                                                                                                 |
