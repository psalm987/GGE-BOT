#!/bin/sh
set -e
# Grafana refuses to start with a provisioned Discord receiver whose URL is
# empty, so the contact point and its policy go in only when a webhook is set.
if [ -n "$GRAFANA_ALERT_DISCORD_WEBHOOK" ]; then
    cp "$(dirname "$0")"/discord-alerting/*.yml "$GF_PATHS_PROVISIONING/alerting/"
fi
exec /run.sh "$@"
