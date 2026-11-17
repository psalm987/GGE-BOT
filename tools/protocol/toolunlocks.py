import sys, json
# usage: toolunlocks.py ITEMS.json OUT.tsv -> which research / sceat skill enables (46) or disables (84) each workshop tool wodID
d = json.load(open(sys.argv[1]))
units = {u['wodID']: u for u in d['units']}
rows = []
for sec, idk in (('researches', 'researchID'), ('sceatSkills', 'skillID')):
    for r in d[sec]:
        for part in str(r.get('effects', '')).split(','):
            if '&' not in part: continue
            eid, val = part.split('&', 1)
            if eid not in ('46', '84'): continue
            for v in val.replace('+', '#').split('#'):
                try: w = int(v)
                except ValueError: continue
                u = units.get(w)
                if not u or u.get('name') not in ('Workshop', 'Dworkshop'): continue
                rows.append((sec, r[idk], r.get('comment2', r.get('skillGroupID', '')), r.get('level', ''), 'enable' if eid == '46' else 'disable', w, u['name'], u['type'], u.get('level', '-')))
with open(sys.argv[2], 'w') as o:
    o.write('section\tid\tcomment\tlevel\taction\twodID\tbuilding\ttoolType\ttoolLevel\n')
    for r in rows: o.write('\t'.join(map(str, r)) + '\n')
from collections import Counter
print(len(rows), Counter((r[0], r[4]) for r in rows))
print(Counter((r[0], r[7]) for r in rows if r[4] == 'enable').most_common(40))
