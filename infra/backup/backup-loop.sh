#!/bin/bash
# Nightly pg_dump into the backups volume, keeping BACKUP_KEEP_DAYS days.
# Copy /backups off the host as well (see docs/deployment/backup-restore.md).
set -euo pipefail
while true; do
    stamp=$(date -u +%Y-%m-%dT%H%M%SZ)
    pg_dump -h postgres -U gge -d gge --format=custom --file="/backups/gge-$stamp.dump"
    echo "backup written: gge-$stamp.dump"
    find /backups -name 'gge-*.dump' -mtime +"${BACKUP_KEEP_DAYS:-14}" -delete
    # Next run at 03:00 UTC.
    now=$(date -u +%s); next=$(date -u -d "tomorrow 03:00" +%s)
    sleep $((next - now))
done
