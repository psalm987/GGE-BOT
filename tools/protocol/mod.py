import sys, re
# usage: mod.py FILE REGEX [maxchars] [hit_index] -> prints the whole webpack module containing the match
f, pat = sys.argv[1], sys.argv[2]
cap = int(sys.argv[3]) if len(sys.argv) > 3 else 12000
idx = int(sys.argv[4]) if len(sys.argv) > 4 else 0
data = open(f, 'rb').read().decode('utf-8', 'replace')
hits = list(re.finditer(pat, data))
if not hits:
    print('no match'); sys.exit(1)
s = hits[idx].start()
start = data.rfind('function(e,t,i){', 0, s)
end = data.find('},function(e,t,i){', s)
if end < 0: end = len(data)
print(f'--- hits={len(hits)} match@{s} module@{start}..{end} len={end-start}')
print(data[start:min(end, start+cap)])
