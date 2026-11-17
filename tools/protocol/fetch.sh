#!/bin/sh
# usage: fetch.sh [OUTDIR] -> the current HTML5 client bundle, constants DLL, items and English strings
set -eu

base="${GGE_CDN:-https://empire-html5.goodgamestudios.com}"
out="${1:-$(dirname "$0")/dl}"
mkdir -p "$out/dll" "$out/items" "$out/lang"

curl -fsS "$base/default/index.html" -o "$out/default_index.html"
for file in $(grep -o '"\(dll/ggs\.dll\|Game\.bundle\)\.[0-9a-f]*\.js"' "$out/default_index.html" | tr -d '"' | sort -u); do
    curl -fsS "$base/default/$file" -o "$out/$file"
done

version=$(curl -fsS "$base/default/items/ItemsVersion.properties" | sed 's/.*=//' | tr -d '\r\n')
curl -fsS "$base/default/items/items_v$version.json" -o "$out/items/items_v$version.json"

lang=$(curl -fsS "$base/config/languages/version.json" | python3 -I -c 'import json, sys; print(json.load(sys.stdin)["languages"]["en"])')
curl -fsS "$base/config/languages/$lang/en.json" -o "$out/lang/en.json"

ls -R "$out"
