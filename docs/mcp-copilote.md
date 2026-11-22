# Copilote MCP : veille, décisions et notifications

Ce document décrit l'extension du serveur MCP de Ghostfolio pour un usage de « copilote » : Claude publie des rapports (la veille), pose des décisions que l'utilisateur valide dans l'application, puis relit les réponses.

## Connecter Claude

1. Activer le serveur : `ENABLE_FEATURE_MCP=true` et `ROOT_URL=https://<domaine>` (l'endpoint n'accepte que le nom d'hôte de `ROOT_URL`).
2. Créer un accès de type MCP (`POST /api/v1/access` avec `"type": "MCP"`, ou depuis la page des accès une fois le client mis à jour). La réponse contient le champ `token` (`gfmcp_…`). **Il n'est affiché qu'une seule fois** : la base ne conserve que son hash SHA-256 (`Access.tokenHash`). `id` n'est plus un jeton.
3. Option `readOnly: true` à la création : retire tous les scopes d'écriture (publication de rapports, import d'activités, soldes, notifications). Sans `readOnly`, on peut aussi choisir finement les `scopes`.
4. Claude Code (l'en-tête attendu est `Authorization`, cf. `HEADER_KEY_TOKEN`) :

```
claude mcp add --transport http ghostfolio https://<domaine>/mcp \
  --header "Authorization: Bearer gfmcp_…"
```

### Jetons hérités

Les accès MCP créés avant ce changement n'ont pas de `tokenHash` et leur `id` servait de jeton. Ils sont **refusés** par défaut. `MCP_ALLOW_LEGACY_TOKENS=true` les autorise temporairement (par `id`) ; recréer les accès puis remettre la variable à `false`.

## Outils

| Outil                  | Scope                 | Rôle                                                                                                                                                                                                                              |
| ---------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `publish-report`       | `report:create`       | Publie un rapport (BRIEF, ANALYSIS, LESSON, ALLOCATION, REVIEW) avec points, concepts, détails markdown, sources, graphiques et décisions (question + options). Notifie si un point est `important` ou si une décision est posée. |
| `get-reports`          | `report:read`         | Liste filtrée (kind, subject, q, skip, take ≤ 20).                                                                                                                                                                                |
| `get-report`           | `report:read`         | Un rapport complet avec ses décisions.                                                                                                                                                                                            |
| `update-report`        | `report:update`       | Modifie des champs ; rouvre (`OPEN`) ou retire (`DISMISSED`) une décision. Claude ne peut pas répondre à la place de l'utilisateur.                                                                                               |
| `get-open-decisions`   | `report:read`         | Décisions en attente.                                                                                                                                                                                                             |
| `get-decision-answers` | `report:read`         | Décisions tranchées, filtre `since` (ISO 8601) pour la veille suivante.                                                                                                                                                           |
| `send-notification`    | `notification:create` | Notification push (titre, corps, url relative ou HTTPS).                                                                                                                                                                          |

Les outils existants sont inchangés (comptes, activités, performance, portefeuille, watchlist, import, recherche d'actifs, solde de compte).

`get-holding-detail` n'est **pas** ajouté : `PortfolioService.getHolding` existe, mais il renvoie des montants et n'est pas exposé via `PortfolioTableService` ; il faut d'abord un tableau dédié respectant `portfolio:read:values`. À faire.

## Variables d'environnement

| Variable                                                 | Défaut  | Rôle                                                                                                                  |
| -------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------- |
| `ENABLE_FEATURE_MCP`                                     | `false` | Active `/mcp`.                                                                                                        |
| `ENABLE_FEATURE_MCP_OAUTH`                               | `false` | Serveur d'autorisation OAuth 2.1 pour `/mcp` (voir plus bas).                                                         |
| `ENABLE_FEATURE_REPORTS`                                 | `true`  | Rapports et décisions (REST + MCP). Exposé via la permission globale `enableReports` d'`/info`.                       |
| `MCP_ALLOW_LEGACY_TOKENS`                                | `false` | Accepte les anciens accès MCP par `id`.                                                                               |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | vides   | Notifications web push (`npx web-push generate-vapid-keys` ; sujet `mailto:…`). Sans ces valeurs, l'envoi est ignoré. |

Dépendance à ajouter à `package.json` : `web-push` et `@types/web-push`.

## API REST

Préfixe `/api/v1`, permissions `createReport`, `readReport`, `updateReport`, `deleteReport` (rôles USER et ADMIN).

- `GET /reports?kind=&subject=&q=&skip=&take=` ; `GET /reports/:id` ; `POST /reports` ; `PATCH /reports/:id` ; `DELETE /reports/:id`
- `GET /decisions?status=OPEN&since=…` ; `POST /decisions/:id/answer` `{optionId?, text?}` ; `PATCH /decisions/:id` `{status: OPEN|DISMISSED}` (rouvrir / écarter)
- `GET /push/vapid-public-key` ; `POST /push-subscriptions` `{endpoint, p256dh, auth, userAgent?, preferences?}` ; `DELETE /push-subscriptions` `{endpoint}`

Modèles Prisma : `Report`, `Decision` (OPEN / DECIDED / DISMISSED, `options` JSON `[{id,label}]`, `answerOptionId`, `answerText`, `decidedAt`), `PushSubscription`, et `Access.tokenHash`. Migrations `20261122000000_added_report` et `20261122000001_added_token_hash_to_access`.

Le client Angular (page Veille, validation des décisions, service worker push) n'est pas implémenté.

## Autorisation OAuth 2.1 (connecteur personnalisé)

Avec `ENABLE_FEATURE_MCP_OAUTH=true` (et `ENABLE_FEATURE_MCP=true`, `ROOT_URL` en HTTPS), Ghostfolio est un serveur d'autorisation OAuth 2.1 pour `/mcp` (spec MCP Authorization 2025-06-18 / 2025-11-25). Sans le drapeau, tout ce qui suit répond 404, `resource_metadata` n'est pas annoncé et le comportement reste celui des jetons `gfmcp_`.

### Ajouter Ghostfolio dans claude.ai

1. Paramètres, Connecteurs, « Ajouter un connecteur personnalisé » : nom libre, URL `https://<domaine>/mcp` (sans identifiant ni secret).
2. claude.ai découvre les métadonnées (`WWW-Authenticate` puis `/.well-known/oauth-protected-resource/mcp`), s'enregistre (`POST /api/v1/oauth/register`) et ouvre le navigateur sur `/api/v1/oauth/authorize`.
3. Ghostfolio redirige vers la page de consentement du client (`/<langue>/oauth/consent`) : connecte-toi si besoin, puis relance la connexion depuis claude.ai (le retour automatique après connexion n'existe pas). La case « Lecture seule » est cochée par défaut ; décochée, Claude peut aussi publier des rapports, créer des activités, modifier des soldes et notifier.
4. « Autoriser » renvoie vers claude.ai avec un code (60 s, usage unique) que claude.ai échange contre un jeton d'accès (1 h) et un jeton de rafraîchissement (30 jours, rotation).

### Claude Code

```
claude mcp add --transport http ghostfolio https://<domaine>/mcp
```

puis `/mcp` dans Claude Code, « Authenticate » : le navigateur s'ouvre sur la page de consentement. Les jetons `gfmcp_` avec `--header` restent possibles.

### Endpoints

| Endpoint                                                      | Rôle                                                                                                                           |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `GET /.well-known/oauth-protected-resource/mcp`               | RFC 9728 : ressource `ROOT_URL/mcp`, serveur d'autorisation, scopes.                                                           |
| `GET /.well-known/oauth-authorization-server`                 | RFC 8414 : endpoints ci-dessous, PKCE `S256`, clients publics.                                                                 |
| `POST /api/v1/oauth/register`                                 | RFC 7591 : clients publics (`token_endpoint_auth_method: none`), 1 à 10 `redirect_uris` HTTPS ou HTTP loopback, 10/heure/IP.   |
| `GET /api/v1/oauth/authorize`                                 | Valide la requête (client, `redirect_uri`, PKCE S256 obligatoire, `resource` = `ROOT_URL/mcp`), redirige vers le consentement. |
| `GET/POST /api/v1/oauth/authorize/consent`                    | Avec le JWT : décrit la demande, puis `{approve, readOnly, …}` renvoie `{redirectUrl}` (code ou `access_denied`).              |
| `POST /api/v1/oauth/token`                                    | `authorization_code` et `refresh_token`, `Cache-Control: no-store`.                                                            |
| `POST /api/v1/oauth/revoke`                                   | RFC 7009 : révoque toute la famille (accès et rafraîchissement).                                                               |
| `GET /api/v1/oauth/grants`, `DELETE /api/v1/oauth/grants/:id` | Avec le JWT : liste et révoque les autorisations de l'utilisateur.                                                             |

### Conception et sécurité

- Tables `OAuthClient`, `OAuthAuthorizationCode`, `OAuthToken` (migration `20261122000002_added_oauth`). Codes et jetons sont opaques (`gfoac_`, `gfoat_`, `gfort_`) et **hachés SHA-256** en base. Les jetons d'une autorisation partagent un `familyId` (= id du code).
- Code à usage unique (mise à jour atomique), lié au client, à la `redirect_uri` et au `code_verifier` ; un code rejoué révoque les jetons qu'il a émis.
- Refresh avec rotation ; la réutilisation d'un jeton déjà utilisé révoque la famille.
- Jeton d'accès : audience (`resource`), expiration, révocation et scopes vérifiés à chaque appel par le middleware MCP ; scopes = demandés ∩ `SCOPES_OF_TYPE.MCP`, sans écriture en mode lecture seule. Un jeton OAuth ne vaut rien hors de `/mcp`.
- `redirect_uri` : comparaison exacte (seul le port d'une adresse loopback est libre, RFC 8252). Une erreur n'est redirigée vers le client qu'après vérification du client et de la `redirect_uri`. Les redirections portent `iss` (RFC 9207).
- Limitation de débit (`CustomThrottlerGuard`, avec `ENABLE_FEATURE_RATE_LIMITING`) sur register, authorize, consent, token et revoke.
- Les codes et jetons expirés depuis plus d'un jour sont purgés à l'octroi suivant.

### Écarts et limites

- Client ID Metadata Documents (préférés par la révision 2025-11-25) **non implémentés** : ils exigent une récupération HTTP côté serveur (SSRF). Seul DCR est annoncé, donc `client_id_metadata_document_supported` est absent.
- `authorize` est servi sous `/api/v1/oauth/authorize` et non `/oauth/authorize`, pour ne pas entrer en conflit avec le routage du client Angular.
- Pas de retour automatique vers le consentement après la connexion à Ghostfolio : relancer la connexion depuis le client MCP.
- Liste et révocation des autorisations dans `/api/v1/oauth/grants` (pas dans `/accesses`), sans écran dans le client.
- Les clients enregistrés ne sont jamais purgés (plafond de 10 000).
- Les textes de la page de consentement ne sont pas encore traduits (source anglaise).
