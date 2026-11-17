import sys, json, re
# usage: table.py ITEMS.json SECTION FIELD_REQUIRED col1,col2,... [REGEX]  -> TSV of rows having FIELD_REQUIRED
d = json.load(open(sys.argv[1], encoding='utf-8'))
need = sys.argv[3]; cols = sys.argv[4].split(',')
pat = re.compile(sys.argv[5], re.I) if len(sys.argv) > 5 else None
print('\t'.join(cols))
for r in d[sys.argv[2]]:
    if need and need not in r: continue
    if pat and not pat.search(json.dumps(r, ensure_ascii=False, separators=(',', ':'))): continue
    print('\t'.join(str(r.get(c, '-')) for c in cols))
