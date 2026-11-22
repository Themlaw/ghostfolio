# Durcissement de la connexion OIDC

Cette note décrit le renforcement de la connexion OpenID Connect (OIDC) pour un
auto-hébergement mono-utilisateur. Les routes restent `GET /api/auth/oidc` et
`GET /api/auth/oidc/callback`, et les variables `OIDC_*` existantes sont
conservées.

## Ce qui a changé

1. **Flux Authorization Code + PKCE (S256) + `state` + `nonce`** avec la
   bibliothèque `openid-client` v6 (remplace `passport-openidconnect`).
   - Au démarrage, le serveur génère `state`, `nonce` et le `code_verifier`
     PKCE, les garde côté serveur (usage unique, 10 minutes) et n'envoie au
     navigateur qu'un identifiant aléatoire dans le cookie `gf_oidc_flow`
     (`HttpOnly`, `SameSite=Lax`, `Secure` si l'URL de callback est en https,
     chemin `/api/auth/oidc`). Le flux est donc lié au navigateur qui l'a
     démarré.
   - Au retour, l'`id_token` est validé entièrement : signature (JWKS de la
     découverte), `iss`, `aud`, `exp`, `nonce`. `state` et PKCE sont vérifiés.
   - L'URL de redirection du token endpoint est dérivée de `OIDC_CALLBACK_URL`
     (ou `ROOT_URL`), jamais de l'en-tête `Host`.
2. **Identité liée à `issuer|sub`** (`thirdPartyId = <issuer>|<sub>`), car un
   `sub` n'est unique que pour un émetteur donné.
3. **Liste blanche** (`OIDC_ALLOWED_SUBJECTS`, `OIDC_ALLOWED_EMAILS`) : si l'une
   est définie, tout autre utilisateur est refusé, y compris si l'inscription
   est ouverte, et y compris pour un compte existant.
4. **Plus de JWT dans l'URL.** Le callback redirige vers
   `ROOT_URL/<lang>/auth?code=<code>` : le code est aléatoire, à usage unique et
   valable 60 s. Le client l'échange via `POST /api/auth/oidc/exchange`
   (`{ "code": "..." }` -> `{ "authToken": "..." }`). La redirection porte
   `Referrer-Policy: no-referrer`.
5. **OIDC désactivé : 403** (et non plus 500) sur les deux routes.
6. **`JWT_EXPIRES_IN`** rend la durée de vie du JWT configurable.

En cas d'échec (refus, state invalide, etc.), l'utilisateur est redirigé vers
`ROOT_URL/<lang>/auth?error=oidc` sans jeton.

## Variables d'environnement

Existantes (inchangées) : `ENABLE_FEATURE_AUTH_OIDC`, `OIDC_ISSUER`,
`OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_CALLBACK_URL`, `OIDC_SCOPE`
(tableau JSON, `openid` est toujours ajouté), `OIDC_AUTHORIZATION_URL`,
`OIDC_TOKEN_URL`, `OIDC_USER_INFO_URL`.

Nouvelles :

| Variable                     | Défaut     | Rôle                                                                               |
| ---------------------------- | ---------- | ---------------------------------------------------------------------------------- |
| `OIDC_ALLOWED_SUBJECTS`      | vide       | `sub` autorisés, séparés par des virgules                                          |
| `OIDC_ALLOWED_EMAILS`        | vide       | emails autorisés (insensible à la casse), **et** `email_verified=true` obligatoire |
| `OIDC_LEGACY_TOKEN_REDIRECT` | `false`    | `true` : ancien comportement (`/auth/<jwt>` dans l'URL), déconseillé               |
| `JWT_EXPIRES_IN`             | `180 days` | durée du JWT (`7 days`, `12h`, ...). Conseillé : `30 days`                         |

Notes :

- Si les deux listes sont définies, un utilisateur est accepté s'il figure dans
  l'une **ou** l'autre. Pour un mono-utilisateur, définir `OIDC_ALLOWED_SUBJECTS`
  (le plus strict, le `sub` est stable) est recommandé.
- Avec `OIDC_ALLOWED_EMAILS`, ajouter `email` à `OIDC_SCOPE`. Si l'`id_token`
  ne contient pas l'email, l'endpoint userinfo est interrogé.
- La découverte (`/.well-known/openid-configuration`) est toujours utilisée,
  car elle fournit `jwks_uri` pour vérifier la signature. Les URL manuelles
  (`OIDC_AUTHORIZATION_URL`, etc.) priment sur les valeurs découvertes. Un
  émetteur en `http://` est toléré (réseau local de confiance uniquement).
- Les états de flux et les codes d'échange sont en mémoire : l'API doit tourner
  en une seule instance (cas mono-utilisateur) ; un redémarrage entre le
  démarrage et le retour du fournisseur oblige à recommencer la connexion.

## Exemples

Authelia (client confidentiel, redirect URI `https://folio.example.com/api/auth/oidc/callback`) :

```env
ENABLE_FEATURE_AUTH_OIDC=true
ROOT_URL=https://folio.example.com
OIDC_ISSUER=https://auth.example.com
OIDC_CLIENT_ID=ghostfolio
OIDC_CLIENT_SECRET=<secret>
OIDC_SCOPE=["openid","profile","email"]
OIDC_ALLOWED_SUBJECTS=<sub-de-votre-compte>
JWT_EXPIRES_IN=30 days
```

Pocket ID :

```env
ENABLE_FEATURE_AUTH_OIDC=true
ROOT_URL=https://folio.example.com
OIDC_ISSUER=https://id.example.com
OIDC_CLIENT_ID=<client id>
OIDC_CLIENT_SECRET=<secret>
OIDC_SCOPE=["openid","email"]
OIDC_ALLOWED_EMAILS=moi@example.com
```

Google :

```env
ENABLE_FEATURE_AUTH_OIDC=true
ROOT_URL=https://folio.example.com
OIDC_ISSUER=https://accounts.google.com
OIDC_CLIENT_ID=<id>.apps.googleusercontent.com
OIDC_CLIENT_SECRET=<secret>
OIDC_SCOPE=["openid","email"]
OIDC_ALLOWED_EMAILS=moi@gmail.com
```

Pour trouver votre `sub`, faites une première connexion avec la liste vide
(en environnement de confiance) et lisez-le dans l'interface du fournisseur ou
dans la colonne `thirdPartyId` de la table `User` (valeur `<issuer>|<sub>`),
puis renseignez `OIDC_ALLOWED_SUBJECTS`. Sur Google, le `sub` est un entier
long, l'email est plus pratique.

## Migration

- **Comptes existants** : un compte lié à l'ancien `thirdPartyId = <sub>`
  (provider `OIDC`) est migré automatiquement vers `<issuer>|<sub>` à sa
  prochaine connexion. Aucune migration de base n'est nécessaire.
  Le `sub` seul n'étant pas lié à l'émetteur, ne changez pas d'`OIDC_ISSUER`
  vers un autre fournisseur avant que le compte soit migré.
- **Client Angular** : le composant `apps/client/src/app/pages/auth/auth-page.component.ts`
  lit désormais `?code=` et appelle `POST /api/auth/oidc/exchange` ; il accepte
  toujours `/auth/:jwt` (utilisé par Google OAuth et par
  `OIDC_LEGACY_TOKEN_REDIRECT=true`). Sans jeton ni code, il redirige vers `/`.
- **Reverse proxy** : le cookie `gf_oidc_flow` doit traverser le proxy ; le
  chemin `/api/auth/oidc*` doit être servi sous le même domaine que l'interface.
- **Dépendances** : `openid-client` 6.9.1 est ajouté (ESM, Node >= 22.12).
  `passport-openidconnect` n'est plus utilisé et peut être retiré de
  `package.json` (`npm uninstall passport-openidconnect @types/passport-openidconnect`).
- **Route publique** : `POST /auth/oidc/exchange` est ajoutée à la liste
  `PUBLIC_ROUTES` de `app.module.spec.ts`.
