import sys, re
# usage: constgrep.py PREFIX_REGEX FILE... -> NAME=VALUE @file:offset (numeric/string literal assignments)
pat = re.compile(r'\.((?:' + sys.argv[1] + r')[A-Z0-9_]*)=(-?\d+(?:\.\d+)?|"[^"]*")(?=[,;)}])')
seen = set()
for f in sys.argv[2:]:
    data = open(f, 'rb').read().decode('utf-8', 'replace')
    for m in pat.finditer(data):
        k = (m.group(1), m.group(2))
        if k in seen: continue
        seen.add(k)
        print(f'{m.group(1)}={m.group(2)}\t@{f.rsplit("/",1)[-1][:12]}:{m.start()}')
