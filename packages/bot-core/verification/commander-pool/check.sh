#!/usr/bin/env bash
# Checks the commander pool (plugins/commander.js) two ways:
#   1. conformance.js runs the real commander.js and checks what the model
#      assumes about it.
#   2. TLC checks every rule in CommanderPool.tla on the code as it is, on a
#      variant with no attackKhan-shaped loops, and on broken variants that
#      must fail.
# Exit 0: every result matches EXPECTED below. Exit 1: something changed.
# Needs Java 11+ and Node. Usage: verification/commander-pool/check.sh
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
TLA_VERSION="1.7.4"
TLA_SHA256="936a262061c914694dfd669a543be24573c45d5aa0ff20a8b96b23d01e050e88"
JAR="${TLA2TOOLS_JAR:-${XDG_CACHE_HOME:-$HOME/.cache}/gge-bot-tla/tla2tools-$TLA_VERSION.jar}"

if [[ ! -f "$JAR" ]]; then
    echo "Downloading tla2tools $TLA_VERSION to $JAR"
    mkdir -p "$(dirname "$JAR")"
    curl -fsSL -o "$JAR.tmp" \
        "https://github.com/tlaplus/tlaplus/releases/download/v$TLA_VERSION/tla2tools.jar"
    mv "$JAR.tmp" "$JAR"
fi
actual_sha="$(shasum -a 256 "$JAR" | cut -d' ' -f1)"
if [[ "$actual_sha" != "$TLA_SHA256" ]]; then
    echo "tla2tools checksum mismatch: $actual_sha (want $TLA_SHA256)" >&2
    exit 2
fi

failures=0
report() { # name expected actual
    if [[ "$2" == "$3" ]]; then
        printf '  ok    %-52s %s\n' "$1" "$3"
    else
        printf '  DIFF  %-52s %s (expected %s)\n' "$1" "$3" "$2"
        failures=$((failures + 1))
    fi
}

# ---- 1. Conformance of the real commander.js -------------------------------
echo "conformance.js (real plugins/commander.js)"
conf="$(node "$DIR/conformance.js" 2>&1)" || true
conf_value() { # key -> true / false / crashed
    node -e 'try { const v = JSON.parse(process.argv[1])[process.argv[2]];
                   console.log(v === undefined ? "crashed" : v) }
             catch { console.log("crashed") }' "$conf" "$1"
}
# sameRunReacquireGetsWokenCommander was true before the hand-off fix
# (finding 1): a same-run re-acquire took the woken waiter's commander.
for key in fastPathMarksUsed waitsWhenAllUsed freeWakesFirstWaiterOnly \
           freeUnusedIsNoop returnFrees laterReacquireWaits; do
    report "$key" true "$(conf_value "$key")"
done
report sameRunReacquireGetsWokenCommander false "$(conf_value sameRunReacquireGetsWokenCommander)"
if [[ "$(conf_value fastPathMarksUsed)" == crashed ]]; then
    echo "        conformance.js output:"; echo "$conf" | sed 's/^/        /'
fi

# ---- 2. TLC ------------------------------------------------------------------
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp "$DIR/CommanderPool.tla" "$TMP/"

# name | LoopPlugins | Mutation | rule | expected (holds / violated)
EXPECTED='
code-as-is|{p1}|none|NoDoubleBooking|holds
code-as-is|{p1}|none|NoBusyLordSent|holds
code-as-is|{p1}|none|NoStrandedWaiter|holds
code-as-is|{p1}|none|NoLeakedLord|holds
code-as-is|{p1}|none|Deadlock|holds
sendHit-loops-only|{}|none|NoDoubleBooking|holds
sendHit-loops-only|{}|none|NoBusyLordSent|holds
sendHit-loops-only|{}|none|NoStrandedWaiter|holds
sendHit-loops-only|{}|none|NoLeakedLord|holds
sendHit-loops-only|{}|none|Deadlock|holds
broken:wake-skips-useCommander|{p1}|wakeSkipsUse|NoDoubleBooking|violated
broken:wake-skips-useCommander|{p1}|wakeSkipsUse|NoBusyLordSent|violated
broken:freeCommander-wakes-nobody|{}|freeSkipsWake|NoStrandedWaiter|violated
broken:return-does-not-free|{}|returnSkipsFree|NoLeakedLord|violated
broken:success-frees-commander|{}|okFreesLord|NoBusyLordSent|violated
'

echo "TLC $TLA_VERSION on CommanderPool.tla (Lords = {l1, l2}, Plugins = {p1, p2, p3})"
while IFS='|' read -r name loops mutation rule expected; do
    [[ -z "$name" ]] && continue
    case_id="${name//:/-}-$rule"
    cfg="$TMP/$case_id.cfg"
    {
        echo "CONSTANTS"
        echo "    Lords = {l1, l2}"
        echo "    Plugins = {p1, p2, p3}"
        echo "    LoopPlugins = $loops"
        echo "    NoLord = NoLord"
        echo "    Mutation = \"$mutation\""
        echo "INIT Init"
        echo "NEXT Next"
        echo "INVARIANT TypeOK"
        if [[ "$rule" != "Deadlock" ]]; then echo "INVARIANT $rule"; fi
    } > "$cfg"
    # TLC reads the config from the spec's folder, so run from $TMP.
    flags=(-workers auto -metadir "$TMP/meta-$case_id" -config "$case_id.cfg")
    if [[ "$rule" != "Deadlock" ]]; then flags+=(-deadlock); fi  # -deadlock turns the deadlock check off
    out="$TMP/$case_id.out"
    (cd "$TMP" && java -XX:+UseParallelGC -cp "$JAR" tlc2.TLC "${flags[@]}" CommanderPool.tla) > "$out" 2>&1 || true
    if grep -q "No error has been found" "$out"; then
        actual=holds
    elif grep -q "Invariant $rule is violated" "$out" || { [[ "$rule" == "Deadlock" ]] && grep -q "Deadlock reached" "$out"; }; then
        actual=violated
    elif grep -q "Invariant TypeOK is violated" "$out"; then
        actual=type-error
    else
        actual=tlc-error
    fi
    report "$name / $rule" "$expected" "$actual"
    if [[ "$actual" != "$expected" ]]; then
        mkdir -p "$DIR/out"
        cp "$out" "$DIR/out/$case_id.out"
        echo "        TLC output: verification/commander-pool/out/$case_id.out"
    fi
done <<< "$EXPECTED"

if (( failures > 0 )); then
    echo "$failures result(s) differ from EXPECTED. See the commander-pool skill."
    exit 1
fi
echo "All results match EXPECTED."
