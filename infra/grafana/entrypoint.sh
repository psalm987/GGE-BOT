#!/bin/sh
set -e
# Grafana refuses to start with a provisioned Discord receiver whose URL is
# empty, so the contact point and its policy go in only when a webhook is set.
if [ -n "$GRAFANA_ALERT_DISCORD_WEBHOOK" ]; then
    cp "$(dirname "$0")"/discord-alerting/*.yml "$GF_PATHS_PROVISIONING/alerting/"
fi
# Compose sets GGE_DB_USER to grafana_ro only when GRAFANA_DB_PASSWORD is set.
export GGE_DB_USER="${GGE_DB_USER:-gge}"
exec /run.sh "$@"
