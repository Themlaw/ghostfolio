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
| `ENABLE_FEATURE_MCP_OAUTH`                               | `false` | Annonce les métadonnées OAuth (voir plan : non implémenté).                                                           |
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

## État des métadonnées OAuth

Avec `ENABLE_FEATURE_MCP_OAUTH=false` (défaut), `/.well-known/oauth-protected-resource/mcp` et `/.well-known/oauth-authorization-server` répondent 404 et le challenge `WWW-Authenticate` ne contient pas `resource_metadata` : rien d'inexistant n'est annoncé. Avec `true`, les métadonnées annoncent `/oauth/authorize` et `/api/v1/oauth/token`, qui n'existent pas encore : **ne pas activer** avant d'avoir implémenté le plan ci-dessous.

## Plan : OAuth 2.1 pour MCP (non implémenté)

Dépend de l'OIDC durci (connexion de l'utilisateur au moment du consentement).

1. **Découverte** : conserver RFC 9728 (`/.well-known/oauth-protected-resource/mcp`) et RFC 8414 ; ajouter `registration_endpoint` (DCR) et `client_id_metadata_document_supported: true`.
2. **Clients** : (a) Client ID Metadata Documents : `client_id` = URL HTTPS ; récupérer le document (SSRF : refuser les IP privées, taille et délai bornés, cache court), vérifier que `client_id` correspond et que `redirect_uris` contient l'URI demandée ; (b) DCR RFC 7591 (`POST /api/v1/oauth/register`), clients publics (`token_endpoint_auth_method: none`), table `OAuthClient` (redirect_uris exactes, nom, date), limitation de débit.
3. **`GET /oauth/authorize`** : valide `client_id`, `redirect_uri` (comparaison exacte), `response_type=code`, `state`, `code_challenge` avec `code_challenge_method=S256` (PKCE obligatoire, `plain` refusé), `resource` (RFC 8707, doit égaler `ROOT_URL/mcp`). Exige une session (OIDC/JWT) puis affiche une page de **consentement** (scopes demandés, niveau lecture seule ou écriture, expiration), protégée CSRF. Génère un code à usage unique (≈ 60 s) lié à client, utilisateur, redirect_uri, challenge, resource, scopes.
4. **`POST /api/v1/oauth/token`** : `grant_type=authorization_code` (vérifie `code_verifier` contre le challenge, `redirect_uri`, `resource`, usage unique) et `refresh_token` (rotation : à chaque usage, nouveau refresh, l'ancien invalide ; la réutilisation d'un refresh révoque toute la famille).
5. **Jetons** : access token opaque court (15 min), refresh token (30 j glissants), tous deux stockés **hachés** (SHA-256) dans une table `OAuthToken` (clientId, userId, scopes, audience, expiresAt, familyId, revokedAt). Chaque octroi crée en pratique un `Access` MCP lié (visible et révocable dans la page des accès). Le middleware MCP résout le jeton par hash comme aujourd'hui, et vérifie l'audience (`aud` = ressource MCP) : un jeton émis pour une autre ressource est refusé.
6. **Révocation** : RFC 7009 (`/api/v1/oauth/revoke`), révocation à la suppression de l'accès, purge périodique des jetons expirés.
7. **Sécurité** : redirections HTTPS ou loopback uniquement, pas de jeton dans l'URL, en-têtes `Cache-Control: no-store` sur le endpoint de jetons, journalisation des octrois, scopes demandés ∩ `SCOPES_OF_TYPE.MCP`.
8. **Tests** : PKCE (mauvais verifier), code rejoué, `redirect_uri` différent, `resource` incorrect, rotation/réutilisation du refresh, expiration, clients métadonnées malveillants (SSRF).
