import sys, json, re
# usage: langgrep.py LANG.json REGEX [maxhits]  -> key = value where key or value matches
d = json.load(open(sys.argv[1], encoding='utf-8'))
pat = re.compile(sys.argv[2], re.I)
m = int(sys.argv[3]) if len(sys.argv) > 3 else 60
n = 0
def walk(o, prefix=''):
    global n
    if isinstance(o, dict):
        for k, v in o.items(): walk(v, f'{prefix}{k}' if not prefix else f'{prefix}.{k}')
    elif isinstance(o, str):
        if pat.search(prefix) or pat.search(o):
            n += 1
            if n <= m: print(f'{prefix} = {o[:220]!r}')
walk(d)
print('hits', n)
