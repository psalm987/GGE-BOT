import sys, re
# usage: consts.py FILE OUT.tsv -> every ClientConstSF.C2S_/S2C_ name="code" with byte offset
data = open(sys.argv[1], 'rb').read().decode('utf-8', 'replace')
rows = []
for mt in re.finditer(r'ClientConstSF\.((?:C2S|S2C)_[A-Z0-9_]+)="([^"]*)"', data):
    rows.append((mt.group(1), mt.group(2), mt.start()))
with open(sys.argv[2], 'w') as o:
    o.write('name\tcode\toffset\n')
    for r in rows:
        o.write(f'{r[0]}\t{r[1]}\t{r[2]}\n')
print(len(rows), 'rows')
