"""Writes cmd-names.json: wire command code -> { c2s?: "C2S...VO", s2c?: "S2C_..." }.

usage: python3 -I gen-cmd-names.py <Game.bundle.js> [out.json]
"""
import json
import re
import sys


def main() -> None:
    src = open(sys.argv[1], encoding="utf-8").read()
    out = sys.argv[2] if len(sys.argv) > 2 else "cmd-names.json"

    consts: dict[str, str] = {}
    for name, code in re.findall(r'\b((?:C2S|S2C)_\w+)\s*=\s*"([^"]+)"', src):
        consts.setdefault(name, code)

    names: dict[str, dict[str, str]] = {}
    pattern = r"(C2S\w+VO)\.prototype\.getCmdId=function\(\)\{return \w+\.ClientConstSF\.(C2S_\w+)\}"
    for vo, const in re.findall(pattern, src):
        code = consts.get(const)
        if code:
            names.setdefault(code, {}).setdefault("c2s", vo)
    for name, code in consts.items():
        if name.startswith("S2C_"):
            names.setdefault(code, {}).setdefault("s2c", name)

    ordered = {k: names[k] for k in sorted(names)}
    with open(out, "w", encoding="utf-8") as f:
        json.dump(ordered, f, indent=1, ensure_ascii=False)
        f.write("\n")
    c2s = sum("c2s" in v for v in ordered.values())
    s2c = sum("s2c" in v for v in ordered.values())
    print(f"{len(ordered)} codes, {c2s} with a C2S VO, {s2c} with an S2C name -> {out}")


main()
