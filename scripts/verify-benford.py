#!/usr/bin/env python3
"""Independent check of the shipped Benford histograms (and of stats.js) with Python:
random (office, candidate, UF) scopes of the section unit are recomputed straight from the source databases with a different
query form and Python digit extraction, compared with data/benford, and the chi-square and MAD of stats.js are compared with scipy.
    python3 scripts/verify-benford.py [seed] [n]
"""
import csv, gzip, json, math, random, subprocess, sys
from collections import Counter
from scipy.stats import chisquare

SEED, N = int(sys.argv[1]) if len(sys.argv) > 1 else 7, int(sys.argv[2]) if len(sys.argv) > 2 else 5
host = json.load(open('data/manifest.json'))['tables']
ELECTIONS = json.loads(subprocess.run(['node', '--input-type=module', '-e', "import { ELECTIONS } from './src/elections.js'; console.log(JSON.stringify(ELECTIONS))"], capture_output=True, text=True, check=True).stdout)


def psql(db, sql):
    out = subprocess.run(['psql', '-X', '-At', '-d', db, '-c', sql], capture_output=True, text=True, check=True).stdout
    return [line for line in out.split('\n') if line]


def shipped(election):
    scopes = {}
    for part, p in host['benford_hist']['parts'].items():
        if not part.startswith(election + '/'):
            continue
        for r in csv.reader(gzip.open('data/' + p['url'], 'rt')):
            e, turn, office, unit, uf, city, cand, pos, digit, n = r
            if unit == 'section' and city == '' and uf != 'br':
                scopes.setdefault((e, office, uf, cand, pos), {})[int(digit)] = int(n)
    return scopes


def values(election, office, uf, cand):
    """One vote count per section, from the source database (jsonb kinds: 2 nominal, 3 blank, 4/6/7 null)."""
    src = ELECTIONS[election]['source']
    turn = f" and turn = {ELECTIONS[election]['turn']}" if src['kind'] == 'open' else ''
    kinds = {'nominal': (2,), 'branco': (3,), 'nulo': (4, 6, 7)}
    if cand in kinds:
        total = ' + '.join(f"coalesce((select sum(value::int) from jsonb_each_text(votes->'{k}')), 0)" for k in kinds[cand])
        sql = f"select {total} from rdv_votes where office = {office} and state = '{uf}'{turn}"
    elif cand.startswith('p'):
        sql = f"select coalesce((select sum(value::int) from jsonb_each_text(votes->'2') where left(key, 2) = '{cand[1:]}'), 0) from rdv_votes where office = {office} and state = '{uf}'{turn}"
    else:
        sql = f"select coalesce((votes->'2'->>'{cand}')::int, 0) from rdv_votes where office = {office} and state = '{uf}'{turn}"
    return [int(x) for x in psql(src['db'], sql)]


def digit(pos, v):
    s = str(v)
    if pos == 'd1': return int(s[0])
    if pos == 'd_last': return v % 10
    if len(s) < 2: return None
    return int(s[1]) if pos == 'd2' else int(s[:2])


def expected(pos):
    if pos == 'd1': return {d: math.log10(1 + 1 / d) for d in range(1, 10)}
    if pos == 'd2': return {d: sum(math.log10(1 + 1 / (10 * k + d)) for k in range(1, 10)) for d in range(10)}
    if pos == 'd12': return {d: math.log10(1 + 1 / d) for d in range(10, 100)}
    return {d: 0.1 for d in range(10)}


def node_stats(pos, counts):
    js = f"import {{ chiSquare, expected, mad }} from './src/benford/stats.js'; const c = {json.dumps(counts)}; const p = expected('{pos}'); const r = chiSquare(c, p); console.log(JSON.stringify({{ chi2: r.chi2, p: r.p, mad: mad(c, p) }}))"
    return json.loads(subprocess.run(['node', '--input-type=module', '-e', js], capture_output=True, text=True, check=True).stdout)


random.seed(SEED)
pool = [(el, k) for el in ELECTIONS for k in shipped(el)]
cases = random.sample([x for x in pool if x[1][4] in ('d1', 'd2', 'd_last', 'd12')], N)
bad = 0
for election, (e, office, uf, cand, pos) in cases:
    ship = shipped(election)[(e, office, uf, cand, pos)]
    raw = Counter(d for d in (digit(pos, v) for v in values(election, office, uf, cand) if v > 0) if d is not None)
    keys = sorted(expected(pos))
    mine, theirs = [raw.get(d, 0) for d in keys], [ship.get(d, 0) for d in keys]
    n = sum(mine)
    probs = expected(pos)
    chi = chisquare(mine, [n * probs[d] for d in keys])
    mad = sum(abs(c / n - probs[d]) for c, d in zip(mine, keys)) / len(keys)
    js = node_stats(pos, mine)
    ok = mine == theirs and math.isclose(js['chi2'], chi.statistic, rel_tol=1e-9) and math.isclose(js['mad'], mad, rel_tol=1e-9) and (math.isclose(js['p'], chi.pvalue, rel_tol=1e-6, abs_tol=1e-300))
    bad += not ok
    print(f"{'OK ' if ok else 'BAD'} {election} office {office} cand {cand} uf {uf} {pos}: N={n} shipped==python {mine == theirs}; "
          f"chi2 stats.js {js['chi2']:.6f} scipy {chi.statistic:.6f}; p {js['p']:.4g} vs {chi.pvalue:.4g}; MAD {js['mad']:.8f} vs {mad:.8f}")
print('all equal' if not bad else f'{bad} differences')
sys.exit(bool(bad))
