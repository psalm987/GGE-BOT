import sys, re
# usage: vos.py BUNDLE CMDS.tsv OUT.txt -> one block per C2S*VO class: cmd code, ctor params, ctor body (raw), byte offset
data = open(sys.argv[1], 'rb').read().decode('utf-8', 'replace')
codes = {}
for line in open(sys.argv[2]):
    p = line.rstrip('\n').split('\t')
    if len(p) >= 2: codes[p[0]] = p[1]
out = open(sys.argv[3], 'w')
n = 0
for mt in re.finditer(r'function (C2S\w+VO)\(([^)]*)\)\{', data):
    name, params, s = mt.group(1), mt.group(2), mt.end()
    end = data.find('return n.__extends(' + name, s)
    if end < 0 or end - s > 6000:
        end = s + 1500
    body = data[s:end]
    cm = re.search(name + r'\.prototype\.getCmdId=function\(\)\{return [a-z]\.ClientConstSF\.(C2S_\w+)\}', data[end:end+4000])
    const = cm.group(1) if cm else '?'
    out.write(f'## {name} cmd={codes.get(const, "?")} ({const}) @{mt.start()}\n  params({params})\n  body: {body}\n')
    n += 1
print(n, 'VO classes')
