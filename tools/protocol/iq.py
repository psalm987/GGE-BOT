import sys, json, re
# usage: iq.py ITEMS.json SECTION [REGEX over the row's JSON] [max]
d = json.load(open(sys.argv[1], encoding='utf-8'))
rows = d[sys.argv[2]]
pat = re.compile(sys.argv[3], re.I) if len(sys.argv) > 3 and sys.argv[3] else None
m = int(sys.argv[4]) if len(sys.argv) > 4 else 50
n = 0
for r in rows:
    s = json.dumps(r, ensure_ascii=False, separators=(',', ':'))
    if pat is None or pat.search(s):
        n += 1
        if n <= m: print(s)
print('rows', n, 'of', len(rows))
