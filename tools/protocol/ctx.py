import sys, re
# usage: ctx.py FILE REGEX [before] [after] [maxhits]
f, pat = sys.argv[1], sys.argv[2]
b = int(sys.argv[3]) if len(sys.argv) > 3 else 200
a = int(sys.argv[4]) if len(sys.argv) > 4 else 400
m = int(sys.argv[5]) if len(sys.argv) > 5 else 20
data = open(f, 'rb').read().decode('utf-8', 'replace')
for i, mt in enumerate(re.finditer(pat, data)):
    if i >= m:
        print('... more'); break
    s = mt.start()
    print(f'--- @{s}')
    print(data[max(0, s-b):s+a])
