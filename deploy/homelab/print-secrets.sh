#!/usr/bin/env bash
#
# Affiche des secrets prêts à coller dans le champ « Environment » de la stack
# Komodo (ou dans les Variables globales de Komodo, en « secret »).
# N'écrit AUCUN fichier. Dépend uniquement d'openssl (pas de node, pas de docker).
#
# Chaque exécution produit de NOUVELLES valeurs : exécutez-le une fois, collez
# le résultat, et conservez-le dans votre gestionnaire de mots de passe.
# Ne régénérez pas ACCESS_TOKEN_SALT, JWT_SECRET_KEY ni les clés VAPID sur une
# instance en service (voir docs/deploy-homelab.md).
#
# Usage : ./print-secrets.sh

set -euo pipefail

command -v openssl >/dev/null 2>&1 || {
  echo "openssl est requis." >&2
  exit 1
}

b64url() {
  openssl base64 -A | tr '+/' '-_' | tr -d '='
}

# Paire VAPID (EC P-256), sans fichier :
# - clé privée : 32 octets bruts, en base64url (43 caractères) ;
# - clé publique : point non compressé de 65 octets (0x04 || X || Y), en
#   base64url (87 caractères).
# La clé privée SEC1 au format DER (openssl ec -outform DER) contient la clé
# privée brute à l'octet 7 (après l'en-tête de 7 octets), et se termine par la
# clé publique de 65 octets.
pem="$(openssl ecparam -name prime256v1 -genkey -noout 2>/dev/null)"
der_file="$(mktemp)"
trap 'rm -f "$der_file"' EXIT
printf '%s\n' "$pem" | openssl ec -outform DER 2>/dev/null >"$der_file"
vapid_private="$(dd if="$der_file" bs=1 skip=7 count=32 2>/dev/null | b64url)"
vapid_public="$(tail -c 65 "$der_file" | b64url)"

if [[ ${#vapid_private} -ne 43 || ${#vapid_public} -ne 87 ]]; then
  echo "Génération VAPID invalide : version d'openssl inattendue ?" >&2
  exit 1
fi

cat <<OUT
# --- à coller dans l'Environment de la stack Komodo ---
ACCESS_TOKEN_SALT=$(openssl rand -hex 32)
JWT_SECRET_KEY=$(openssl rand -hex 32)
POSTGRES_PASSWORD=$(openssl rand -hex 32)
REDIS_PASSWORD=$(openssl rand -hex 32)
VAPID_PRIVATE_KEY=${vapid_private}
VAPID_PUBLIC_KEY=${vapid_public}
OUT
