#!/bin/bash
# Nightly pg_dump into the backups volume, keeping BACKUP_KEEP_DAYS days.
# With RCLONE_CONFIG_GDRIVE_TOKEN set, each dump is also copied, encrypted, to
# Google Drive: daily/ keeps BACKUP_KEEP_DAYS days, and monthly/ keeps the first
# dump of each month for BACKUP_KEEP_MONTHS months
# (see docs/deployment/backup-restore.md).
set -euo pipefail

offsite=false
if [[ -n "${RCLONE_CONFIG_GDRIVE_TOKEN:-}" ]]; then
    if [[ -z "${BACKUP_PASSPHRASE:-}" ]]; then
        echo "GDRIVE_TOKEN is set but BACKUP_PASSPHRASE is empty; refusing to upload unencrypted dumps" >&2
        exit 1
    fi
    RCLONE_CONFIG_OFFSITE_PASSWORD=$(rclone obscure "$BACKUP_PASSPHRASE")
    export RCLONE_CONFIG_OFFSITE_PASSWORD
    # Remotes come from RCLONE_CONFIG_* variables; the file only gives rclone
    # somewhere to cache refreshed access tokens.
    export RCLONE_CONFIG=/tmp/rclone.conf
    touch "$RCLONE_CONFIG"
    offsite=true
fi

# Chained with && because set -e does not apply inside a function called from `if`.
upload() {
    local file=$1 month
    month=$(date -u +%Y-%m)
    rclone copy "$file" offsite:daily &&
        rclone mkdir offsite:monthly &&
        # A copy already in monthly/ for this month means nothing to do; a host
        # that was down on the 1st catches up on its next dump.
        if [[ -z "$(rclone lsf offsite:monthly --include "gge-$month-*")" ]]; then
            rclone copy "$file" offsite:monthly
        fi &&
        rclone delete offsite:daily --min-age "${BACKUP_KEEP_DAYS:-14}d" &&
        rclone delete offsite:monthly --min-age "${BACKUP_KEEP_MONTHS:-12}M"
}

while true; do
    stamp=$(date -u +%Y-%m-%dT%H%M%SZ)
    file="/backups/gge-$stamp.dump"
    pg_dump -h postgres -U gge -d gge --format=custom --file="$file"
    echo "backup written: gge-$stamp.dump"
    if $offsite; then
        if upload "$file"; then
            echo "backup uploaded: gge-$stamp.dump"
        else
            echo "off-site upload failed: gge-$stamp.dump" >&2
        fi
    fi
    find /backups -name 'gge-*.dump' -mtime +"${BACKUP_KEEP_DAYS:-14}" -delete
    # Next run at 03:00 UTC.
    now=$(date -u +%s); next=$(date -u -d "tomorrow 03:00" +%s)
    sleep $((next - now))
done
