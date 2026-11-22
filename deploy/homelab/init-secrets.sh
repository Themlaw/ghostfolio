#!/usr/bin/env bash
#
# Génère les secrets de .env à partir de .env.example.
#
# - Crée .env (chmod 600) depuis .env.example s'il n'existe pas.
# - Remplit UNIQUEMENT les variables dont la valeur est vide ; une valeur déjà
#   présente n'est jamais modifiée (le script peut être relancé sans risque).
# - Secrets : ACCESS_TOKEN_SALT, JWT_SECRET_KEY, POSTGRES_PASSWORD,
#   REDIS_PASSWORD (openssl rand) et la paire VAPID_PUBLIC_KEY /
#   VAPID_PRIVATE_KEY (openssl, sinon `web-push` dans un conteneur node:22-alpine).
#
# Usage : ./init-secrets.sh

set -euo pipefail
umask 077

cd "$(dirname "${BASH_SOURCE[0]}")"

ENV_FILE=".env"
EXAMPLE_FILE=".env.example"

if [[ ! -f "$EXAMPLE_FILE" ]]; then
  echo "Fichier $EXAMPLE_FILE introuvable." >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  cp "$EXAMPLE_FILE" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "Créé : $ENV_FILE (depuis $EXAMPLE_FILE)"
fi

# Valeur actuelle d'une variable (vide si absente)
get_value() {
  local line
  line="$(grep -E "^$1=" "$ENV_FILE" | head -n 1 || true)"
  printf '%s' "${line#*=}"
}

# Écrit une valeur si la variable existe avec une valeur vide
set_if_empty() {
  local key="$1" value="$2" tmp
  if ! grep -qE "^${key}=" "$ENV_FILE"; then
    echo "Variable $key absente de $ENV_FILE : ignorée." >&2
    return
  fi
  if [[ -n "$(get_value "$key")" ]]; then
    echo "Conservé : $key (déjà renseigné)"
    return
  fi
  tmp="$(mktemp "${ENV_FILE}.XXXXXX")"
  # Les valeurs générées sont en hexadécimal ou en base64 « URL-safe » :
  # aucun caractère spécial pour sed.
  sed "s|^${key}=\$|${key}=${value}|" "$ENV_FILE" >"$tmp"
  mv "$tmp" "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  echo "Généré  : $key"
}

b64url() {
  openssl base64 -A | tr '+/' '-_' | tr -d '='
}

# Paire de clés VAPID (P-256) : écrit « public<TAB>privée » sur la sortie
vapid_with_openssl() {
  local pem priv pub
  pem="$(openssl ecparam -name prime256v1 -genkey -noout 2>/dev/null)" || return 1
  # DER SEC1 : la clé privée brute (32 octets) commence à l'octet 7, la clé
  # publique non compressée (65 octets) occupe la fin
  priv="$(printf '%s\n' "$pem" | openssl ec -outform DER 2>/dev/null | dd bs=1 skip=7 count=32 2>/dev/null | b64url)"
  pub="$(printf '%s\n' "$pem" | openssl ec -outform DER 2>/dev/null | tail -c 65 | b64url)"
  # Une clé publique de 65 octets fait 87 caractères, la privée 43
  [[ ${#pub} -eq 87 && ${#priv} -eq 43 ]] || return 1
  printf '%s\t%s\n' "$pub" "$priv"
}

vapid_with_docker() {
  command -v docker >/dev/null 2>&1 || return 1
  local json
  json="$(docker run --rm node:22-alpine npx --yes web-push generate-vapid-keys --json)" || return 1
  printf '%s' "$json" | tr -d '\n ' |
    sed -E 's/.*"publicKey":"([^"]+)".*"privateKey":"([^"]+)".*/\1\t\2/'
}

hex() {
  openssl rand -hex "$1"
}

set_if_empty ACCESS_TOKEN_SALT "$(hex 32)"
set_if_empty JWT_SECRET_KEY "$(hex 32)"
set_if_empty POSTGRES_PASSWORD "$(hex 24)"
set_if_empty REDIS_PASSWORD "$(hex 24)"

if [[ -z "$(get_value VAPID_PUBLIC_KEY)" && -z "$(get_value VAPID_PRIVATE_KEY)" ]]; then
  pair="$(vapid_with_openssl || vapid_with_docker || true)"
  if [[ -z "$pair" ]]; then
    echo "Impossible de générer les clés VAPID (ni openssl ni docker)." >&2
    exit 1
  fi
  set_if_empty VAPID_PUBLIC_KEY "${pair%%$'\t'*}"
  set_if_empty VAPID_PRIVATE_KEY "${pair#*$'\t'}"
elif [[ -z "$(get_value VAPID_PUBLIC_KEY)" || -z "$(get_value VAPID_PRIVATE_KEY)" ]]; then
  echo "Une seule des deux clés VAPID est renseignée : complétez-la à la main" >&2
  echo "ou videz les deux lignes pour régénérer la paire." >&2
  exit 1
else
  echo "Conservé : VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY (déjà renseignés)"
fi

echo
echo "Reste à renseigner à la main dans $ENV_FILE :"
todo=0
for key in ROOT_URL OIDC_ISSUER OIDC_CLIENT_ID OIDC_CLIENT_SECRET VAPID_SUBJECT; do
  value="$(get_value "$key")"
  if [[ -z "$value" || "$value" == *example.com* ]]; then
    echo "  - $key"
    todo=1
  fi
done
if [[ -z "$(get_value OIDC_ALLOWED_SUBJECTS)" && -z "$(get_value OIDC_ALLOWED_EMAILS)" ]]; then
  echo "  - OIDC_ALLOWED_SUBJECTS (ou OIDC_ALLOWED_EMAILS) : voir docs/deploy-homelab.md"
  todo=1
fi
if [[ "$todo" -eq 0 ]]; then
  echo "  (rien)"
fi
