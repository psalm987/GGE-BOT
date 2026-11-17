import sys, json
# usage: itemkeys.py ITEMS.json -> top-level keys with sizes
d = json.load(open(sys.argv[1], encoding='utf-8'))
for k, v in d.items():
    n = len(v) if hasattr(v, '__len__') else ''
    print(k, type(v).__name__, n)
