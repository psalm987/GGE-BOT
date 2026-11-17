import sys, re
# usage: errors.py DLL OUT.tsv -> server ERROR enum (code -> name) from the TS enum IIFE starting at ALL_OK
d = open(sys.argv[1], 'rb').read().decode('utf-8', 'replace')
s = d.find('e[e.ALL_OK=0]="ALL_OK"')
end = d.find('}(', s)
rows = re.findall(r'e\[e\.([A-Z0-9_]+)=(-?\d+)\]', d[s:end])
with open(sys.argv[2], 'w') as o:
    o.write('code\tname\n')
    for n, c in rows: o.write(f'{c}\t{n}\n')
print(len(rows), 'error codes @', s)
