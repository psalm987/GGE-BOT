import sys, re
# usage: handlers.py BUNDLE CMDS.tsv OUT.tsv -> server-reply handler classes: class, S2C const, code, offset
data = open(sys.argv[1], 'rb').read().decode('utf-8', 'replace')
codes = {}
for line in open(sys.argv[2]):
    p = line.rstrip('\n').split('\t')
    if len(p) >= 2: codes[p[0]] = p[1]
out = open(sys.argv[3], 'w'); out.write('class\tconst\tcode\toffset\n'); n = 0
for m in re.finditer(r'Object\.defineProperty\((\w+)\.prototype,"cmdId",\{get:function\(\)\{return [a-z]\.ClientConstSF\.(S2C_\w+)\}', data):
    out.write(f'{m.group(1)}\t{m.group(2)}\t{codes.get(m.group(2), "?")}\t{m.start()}\n'); n += 1
print(n, 'handlers')
