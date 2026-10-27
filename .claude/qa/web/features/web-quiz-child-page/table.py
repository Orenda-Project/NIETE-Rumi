#!/usr/bin/env python3
"""Regenerate the TABLE in ../web-quiz-child-page.cjs from the spec (id + title per @WQnnn scenario, spec order)."""
import json, os, re
HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..', '..', '..', '..'))
spec = open(os.path.join(ROOT, 'tests/features/web/web-quiz-child-page.feature'), encoding='utf-8').read().split('\n')
rows, tag = [], None
for l in spec:
    m = re.match(r'\s*@(WQ\d+)\b', l)
    if m: tag = m.group(1); continue
    m = re.match(r'\s*(?:Scenario Outline|Scenario):\s*(.*)', l)
    if m and tag: rows.append((tag, m.group(1).strip())); tag = None
p = os.path.join(HERE, '..', 'web-quiz-child-page.cjs')
s = open(p, encoding='utf-8').read()
table = 'const TABLE = [\n' + '\n'.join("  { id: '%s', title: %s }," % (t, json.dumps(ti, ensure_ascii=False).replace("'", "\\'").replace('"', "'")) for t, ti in rows) + '\n];'
s = re.sub(r'const TABLE = \[\n.*?\n\];', lambda _: table, s, count=1, flags=re.S)
open(p, 'w', encoding='utf-8').write(s)
print(len(rows), 'rows')
