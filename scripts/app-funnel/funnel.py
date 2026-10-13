#!/usr/bin/env python3
"""The teacher-app funnel, one journey at a time — bd-4r3rei.

For a day (Pakistan time) or a range: how many journeys reached each step, per STARTING COMMAND, and for the ones that
opened the app and then stopped, the LAST PAGE they were seen on.

    AXIOM_TOKEN=... python3 scripts/app-funnel/funnel.py                       # today, production
    AXIOM_TOKEN=... python3 scripts/app-funnel/funnel.py --env sandbox --day 2026-10-13
    AXIOM_TOKEN=... python3 scripts/app-funnel/funnel.py --from 2026-10-12T19:00:00Z --to now --feature lesson_plan
    ... --json        machine-readable;  --journey j_0123456789abcdef   one journey's rows, in order

A journey is the rows that share a `journeyId`: the bot's app_funnel.command / link_sent / link_failed (WhatsApp), the
portal's app_link.open (the tap), app_funnel.page_view / page_leave / page_resume (the pages) and app_funnel.action
(what she did). Steps, each a count of journeys that reached it:

    asked         the bot decided about the app link for her command (link, or kept on WhatsApp)
    link_sent     the link message went out
    opened        she tapped it and was signed in (app_link.open outcome ok)
    landed        at least one page was seen
    went_deeper   two or more different pages
    acted         at least one key action (lesson plan opened, paper requested, attendance saved, ...)

Token: the NIETE services' AXIOM_TOKEN (Railway, any service). Datasets: production and staging are both in
`niete-logs` (`env` says which); the sandbox rung is its own dataset, `rumi-sandbox` (env == "sandbox").
APL equivalents for the Axiom UI: docs/app-funnel-telemetry.md. Pure part (build, render) is unit-tested:
test_funnel.py.
"""
import argparse
import datetime
import json
import os
import statistics
import sys
import urllib.request
from collections import Counter, defaultdict

EVENTS = [
    'app_funnel.command', 'app_funnel.link_sent', 'app_funnel.link_failed', 'app_link.open',
    'app_funnel.page_view', 'app_funnel.page_leave', 'app_funnel.page_resume', 'app_funnel.action',
]
DATASETS = {'production': ('niete-logs', 'production'), 'staging': ('niete-logs', 'staging'), 'sandbox': ('rumi-sandbox', 'sandbox')}
PK = datetime.timedelta(hours=5)
STEPS = ['asked', 'link_sent', 'opened', 'landed', 'went_deeper', 'acted']
NEVER = '(never landed)'
ROW_LIMIT = 50000


# ─── pure part ──────────────────────────────────────────────────────────────────────────────────────────────

def flat(row):
    """A row with the bot's data_json (everything that is not a core Axiom column) merged in; top-level wins."""
    out = {}
    raw = row.get('data_json')
    if isinstance(raw, str) and raw:
        try:
            extra = json.loads(raw)
            if isinstance(extra, dict):
                out.update(extra)
        except ValueError:
            pass
    out.update({k: v for k, v in row.items() if v is not None and k != 'data_json'})
    return out


def pk_day_bounds(day):
    """A Pakistan calendar day as UTC bounds: ('2026-10-12T19:00:00Z', '2026-10-13T19:00:00Z') for 2026-10-13."""
    d = datetime.datetime.strptime(day, '%Y-%m-%d')
    a = d - PK
    b = a + datetime.timedelta(days=1)
    return a.strftime('%Y-%m-%dT%H:%M:%SZ'), b.strftime('%Y-%m-%dT%H:%M:%SZ')


def _t(row):
    return str(row.get('_time') or '')


def build(raw_rows):
    rows = [flat(r) for r in raw_rows]
    order = {id(r): i for i, r in enumerate(rows)}
    rows.sort(key=lambda r: (_t(r), order[id(r)]))

    journeys = defaultdict(list)
    direct_views = []
    for r in rows:
        j = r.get('journeyId')
        if j:
            journeys[j].append(r)
        elif r.get('event') == 'app_funnel.page_view':
            direct_views.append(r)

    by_feature = {}
    orphans = 0
    for j, jr in journeys.items():
        cmd = next((r for r in jr if r.get('event') == 'app_funnel.command'), None)
        if not cmd:
            orphans += 1
            continue
        feature = cmd.get('feature') or 'unknown'
        f = by_feature.setdefault(feature, {
            'counts': Counter(), 'kept': Counter(), 'failed': Counter(), 'doors': Counter(), 'actions': Counter(),
            'open_outcomes': Counter(), 'last': Counter(), 'dwell': defaultdict(list), 'sent_not_opened': 0,
        })
        views = [r for r in jr if r.get('event') == 'app_funnel.page_view']
        shown = [r for r in jr if r.get('event') in ('app_funnel.page_view', 'app_funnel.page_resume') and r.get('route')]
        opens = [r for r in jr if r.get('event') == 'app_link.open']
        acts = {r.get('action') for r in jr if r.get('event') == 'app_funnel.action' and r.get('action')}
        sent = any(r.get('event') == 'app_funnel.link_sent' for r in jr)
        opened = any(r.get('outcome') == 'ok' for r in opens)

        f['counts']['asked'] += 1
        f['doors'][cmd.get('door') or 'unknown'] += 1
        if cmd.get('verdict') == 'whatsapp':
            f['kept'][cmd.get('why') or 'unknown'] += 1
        for r in jr:
            if r.get('event') == 'app_funnel.link_failed':
                f['failed'][r.get('reason') or 'unknown'] += 1
        for r in opens:
            f['open_outcomes'][r.get('outcome') or 'unknown'] += 1
        if sent:
            f['counts']['link_sent'] += 1
            if not opened:
                f['sent_not_opened'] += 1
        if opened:
            f['counts']['opened'] += 1
        if views:
            f['counts']['landed'] += 1
        if len({r.get('route') for r in views}) >= 2:
            f['counts']['went_deeper'] += 1
        if acts:
            f['counts']['acted'] += 1
            for a in acts:
                f['actions'][a] += 1
        elif opened:
            last = shown[-1].get('route') if shown else NEVER
            f['last'][last] += 1
            if shown:
                leaves = [r for r in jr if r.get('event') == 'app_funnel.page_leave' and r.get('route') == last and r.get('dwellMs') is not None]
                if leaves:
                    f['dwell'][last].append(leaves[-1]['dwellMs'])

    out = {'by_feature': {}, 'orphan_journeys': orphans}
    for feature, f in sorted(by_feature.items(), key=lambda kv: -kv[1]['counts']['asked']):
        out['by_feature'][feature] = {
            'steps': [{'name': s, 'n': f['counts'][s]} for s in STEPS],
            'kept_on_whatsapp': dict(f['kept']),
            'link_failed': dict(f['failed']),
            'sent_not_opened': f['sent_not_opened'],
            'doors': dict(f['doors']),
            'actions': dict(f['actions']),
            'open_outcomes': dict(f['open_outcomes']),
            'last_pages': sorted(f['last'].items(), key=lambda kv: (-kv[1], kv[0])),
            'last_page_dwell_s': {p: round(statistics.median(v) / 1000) for p, v in f['dwell'].items()},
        }
    out['direct'] = {
        'sessions': len({r.get('appSessionId') for r in direct_views if r.get('appSessionId')}),
        'users': len({r.get('userId') for r in direct_views if r.get('userId')}),
        'views': len(direct_views),
    }
    return out


def render(res, label=''):
    lines = [f'APP FUNNEL {label}'.rstrip()]
    if not res['by_feature']:
        lines.append('  no journeys started in this window')
    for feature, f in res['by_feature'].items():
        top = f['steps'][0]['n'] or 1
        lines.append('')
        lines.append(f'== {feature}')
        for s in f['steps']:
            lines.append(f"  {s['name']:<12}{s['n']:>6}  {round(100 * s['n'] / top):>3}%")
        if f['kept_on_whatsapp']:
            lines.append('  kept on WhatsApp: ' + ', '.join(f'{k} {v}' for k, v in sorted(f['kept_on_whatsapp'].items(), key=lambda kv: -kv[1])))
        if f['link_failed']:
            lines.append('  link failed: ' + ', '.join(f'{k} {v}' for k, v in sorted(f['link_failed'].items(), key=lambda kv: -kv[1])))
        if f['sent_not_opened']:
            lines.append(f"  sent, never opened: {f['sent_not_opened']}")
        bad = {k: v for k, v in f['open_outcomes'].items() if k != 'ok'}
        if bad:
            lines.append('  open outcomes (not ok): ' + ', '.join(f'{k} {v}' for k, v in sorted(bad.items())))
        lines.append('  doors: ' + ', '.join(f'{k} {v}' for k, v in sorted(f['doors'].items(), key=lambda kv: -kv[1])))
        if f['actions']:
            lines.append('  did: ' + ', '.join(f'{k} {v}' for k, v in sorted(f['actions'].items(), key=lambda kv: -kv[1])))
        if f['last_pages']:
            lines.append('  opened the app, did nothing we count, last seen on:')
            for page, n in f['last_pages'][:10]:
                d = f['last_page_dwell_s'].get(page)
                lines.append(f'    {n:>4}  {page}' + (f'   (median {d}s on the page)' if d is not None else ''))
    d = res['direct']
    lines.append('')
    lines.append(f"direct (no journey): {d['sessions']} sessions, {d['users']} users, {d['views']} page views")
    if res['orphan_journeys']:
        lines.append(f"journeys with page/open rows but no command row in this window: {res['orphan_journeys']} (started before the window?)")
    return '\n'.join(lines)


# ─── Axiom ──────────────────────────────────────────────────────────────────────────────────────────────────

def axiom(apl, start, end, token):
    body = json.dumps({'apl': apl, 'startTime': start, 'endTime': end}).encode()
    req = urllib.request.Request('https://api.axiom.co/v1/datasets/_apl?format=tabular', data=body, method='POST',
                                 headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=180) as r:
        res = json.loads(r.read())
    t = res['tables'][0]
    cols = [f['name'] for f in t['fields']]
    return [dict(zip(cols, row)) for row in zip(*t['columns'])] if t.get('columns') else []


def funnel_apl(dataset, env, start, journey=None):
    ev = ', '.join(f'"{e}"' for e in EVENTS)
    extra = f' | where journeyId == "{journey}"' if journey else ''
    return (f'["{dataset}"] | where _time >= datetime({start}) and env == "{env}" | where event in ({ev}){extra} '
            f'| order by _time asc | take {ROW_LIMIT}')


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--env', default='production', choices=sorted(DATASETS))
    ap.add_argument('--day', help='a Pakistan day, YYYY-MM-DD (default: today)')
    ap.add_argument('--from', dest='frm', help='UTC start, ISO (overrides --day)')
    ap.add_argument('--to', help='UTC end, ISO or "now"')
    ap.add_argument('--feature', help='only this starting command (menu, lesson_plan, ...)')
    ap.add_argument('--journey', help='print one journey\'s rows in order and stop')
    ap.add_argument('--json', action='store_true')
    a = ap.parse_args(argv)
    token = os.environ.get('AXIOM_TOKEN')
    if not token:
        print('AXIOM_TOKEN is not set', file=sys.stderr)
        return 2
    dataset, env = DATASETS[a.env]
    if a.frm:
        start, end = a.frm, a.to or 'now'
    else:
        day = a.day or (datetime.datetime.now(datetime.timezone.utc) + PK).strftime('%Y-%m-%d')
        start, end = pk_day_bounds(day)
        if a.to:
            end = a.to
    try:
        rows = axiom(funnel_apl(dataset, env, start, a.journey), start, end, token)
    except Exception as e:  # noqa: BLE001 — a script that prints why it could not read is the whole interface
        print('QUERY FAILED', e, file=sys.stderr)
        return 1
    if a.journey:
        for r in (flat(x) for x in rows):
            keep = {k: r[k] for k in ('_time', 'event', 'feature', 'door', 'verdict', 'why', 'via', 'reason', 'outcome', 'route', 'prevRoute', 'dwellMs', 'how', 'action', 'browser', 'entry') if k in r}
            print(json.dumps(keep, ensure_ascii=False))
        return 0
    if len(rows) >= ROW_LIMIT:
        print(f'WARNING: {ROW_LIMIT} rows is the cap; narrow the window', file=sys.stderr)
    res = build(rows)
    if a.feature:
        res['by_feature'] = {k: v for k, v in res['by_feature'].items() if k == a.feature}
    print(json.dumps(res, ensure_ascii=False, indent=1) if a.json else render(res, f'{a.env}  {start} -> {end}  ({len(rows)} rows)'))
    return 0


if __name__ == '__main__':
    sys.exit(main())
