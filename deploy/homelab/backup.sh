#!/usr/bin/env bash
#
# Sauvegarde PostgreSQL de Ghostfolio (pg_dump au format custom, compressé).
#
# Usage : ./backup.sh [dossier]      (défaut : ./backups)
# Conserve les 14 dernières sauvegardes (RETENTION=30 pour changer).
# Planification (cron de l'utilisateur) :
#   30 3 * * * /chemin/vers/ghostfolio/deploy/homelab/backup.sh >> /var/log/ghostfolio-backup.log 2>&1
#
# Restauration : voir docs/deploy-homelab.md

set -euo pipefail
umask 077

cd "$(dirname "${BASH_SOURCE[0]}")"

BACKUP_DIR="${1:-./backups}"
RETENTION="${RETENTION:-14}"
mkdir -p "$BACKUP_DIR"

file="$BACKUP_DIR/ghostfolio-$(date +%Y%m%d-%H%M%S).dump"

# Les variables POSTGRES_* sont celles du conteneur (lues depuis son env_file)
docker compose exec -T postgres sh -c \
  'pg_dump --format=custom --compress=6 --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  >"$file.tmp"

# Une sauvegarde vide ou illisible ne doit pas remplacer une bonne
if [[ ! -s "$file.tmp" ]]; then
  rm -f "$file.tmp"
  echo "Sauvegarde vide : abandon." >&2
  exit 1
fi
mv "$file.tmp" "$file"
echo "Sauvegarde écrite : $file ($(du -h "$file" | cut -f1))"

# Rotation : ne garde que les RETENTION plus récentes
# shellcheck disable=SC2012
ls -1t "$BACKUP_DIR"/ghostfolio-*.dump 2>/dev/null | tail -n +"$((RETENTION + 1))" | while read -r old; do
  rm -f -- "$old"
done
