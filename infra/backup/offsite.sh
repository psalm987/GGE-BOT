#!/bin/bash
# rclone with the off-site crypt password derived from BACKUP_PASSPHRASE, for
# manual restores: bash /backup/offsite.sh lsf offsite:daily
set -euo pipefail
RCLONE_CONFIG_OFFSITE_PASSWORD=$(rclone obscure "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is not set}")
export RCLONE_CONFIG_OFFSITE_PASSWORD
export RCLONE_CONFIG=/tmp/rclone.conf
touch "$RCLONE_CONFIG"
exec rclone "$@"
