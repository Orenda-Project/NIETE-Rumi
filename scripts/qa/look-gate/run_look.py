#!/usr/bin/env python3
"""The look gate: every child screen built by build_pages.js, opened as a phone (EN + UR, 360 and 390 wide), measured.

    python3 run_look.py <out_dir> [--shots]   → <out_dir>/results.json (+ shots/<screen>-<lang>-<w>.png)

Per screen it writes:
  gutter   every box a child sees (a button, a link, anything with a background, border or shadow) whose
           getBoundingClientRect() has left < 16 or right > innerWidth - 16. A full-width fixed bar is a frame, not a
           box: its own rect is skipped, its children are measured.
  buttons  the button system: each Home / back / share / .wq-btn on screen with its computed size, radius, shadow,
           border and background, and how far its label's middle sits from the button's middle (px).
  primary  the [data-primary]'s bottom against innerHeight.
  targets / emoji  tappables under 48 px, emoji in visible text (look_probe.js, the same probe a walker runs).
  folds    a <details> row under 48 px, or one that lost its ▸ marker.
Then verdict(): PASS/FAIL per screen and one line per failing element (results.json "verdict", verdict.txt).
  hold     on the home: the grown-ups button's words, whether a short tap says "keep holding", and whether its
           label stays on top of the fill while held.
Synthetic children only. The page's sound is muted and no request leaves the machine.
"""
import json
import time
import os
import re
import sys
import threading
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

HERE = os.path.dirname(os.path.abspath(__file__))
PUBLIC = os.path.normpath(os.path.join(HERE, '..', '..', '..', 'dashboard', 'public'))
UA = ('Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 '
      '[FB_IAB/FB4A;FBAV/400.0.0.0;] WhatsApp')
WIDTHS = tuple(int(x) for x in os.environ.get('LOOK_WIDTHS', '360,390').split(','))


def server(out_dir):
    pages = os.path.join(out_dir, 'pages')

    class H(BaseHTTPRequestHandler):
        def log_message(self, *a):
            pass

        def send(self, code, body, ctype):
            self.send_response(code)
            self.send_header('content-type', ctype)
            self.send_header('content-length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            p = self.path.split('?')[0]
            if p.startswith('/q/') or p.startswith('/h/'):
                f = os.path.join(pages, os.path.basename(p) + '.html')
                if os.path.exists(f):
                    return self.send(200, open(f, 'rb').read(), 'text/html; charset=utf-8')
                return self.send(404, b'no page', 'text/plain')
            if p.startswith('/api/'):
                ref = self.headers.get('referer') or ''
                if p.startswith('/api/wq/ch/') and '/h/ch-' in ref:
                    # the Challenge page: its read (a short story) and its menu, invented
                    ur = '/h/ch-ur' in ref
                    if p.endswith('/read'):
                        text = 'پتنگ ہرے پہاڑ کے اوپر اڑی۔ ہوا نرم اور گرم تھی۔' if ur else 'The kite flew over the green hill. The wind was soft and warm.'
                        toks = text.split(' ')
                        clip = {'text': '', 'url': None}
                        body = {'ex': 'read', 'ct': 'CT-look', 'secs': 60, 'lang': 'ur' if ur else 'en', 'record': True, 'questions_on': True,
                                'clips': {'intro': clip, 'start': clip, 'stop': clip, 'done': clip},
                                'story': {'text': text, 'dir': 'rtl' if ur else 'ltr', 'tokens': toks, 'lines': [{'from': 0, 'to': len(toks) - 1}]}}
                    else:
                        body = {'lang': 'ur' if ur else 'en', 'form': 'G3', 'record': True, 'exercises': [{'id': 'read', 'name': 'Read aloud', 'mins': 2, 'done': False, 'last': None}]}
                    return self.send(200, json.dumps(body, ensure_ascii=False).encode('utf-8'), 'application/json')
                if p.startswith('/api/wq/doors/') and '/h/shelf-' in (self.headers.get('referer') or ''):
                    return self.send(200, b'{"shelf":true,"stories":[],"games":[]}', 'application/json')
                if 'shelf' in p:
                    # a shelf page opened with ?wait=1 holds its answer (the wait); otherwise the answer fails (the retry)
                    if 'wait=1' in (self.headers.get('referer') or ''):
                        time.sleep(15)
                    return self.send(500, b'{}', 'application/json')
                return self.send(404, b'{}', 'application/json')
            if p.startswith('/wq/'):
                f = os.path.normpath(os.path.join(PUBLIC, p.lstrip('/')))
                if f.startswith(PUBLIC) and os.path.isfile(f):
                    ext = os.path.splitext(f)[1]
                    ctype = {'.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.woff2': 'font/woff2',
                             '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg',
                             '.ogg': 'audio/ogg'}.get(ext, 'application/octet-stream')
                    return self.send(200, open(f, 'rb').read(), ctype)
            return self.send(404, b'', 'text/plain')

        def do_POST(self):
            n = int(self.headers.get('content-length') or 0)
            if n:
                self.rfile.read(n)
            if self.path.split('?')[0] == '/api/wq/finish':
                # the quiz's end: 4 of 5, counted (the results card and its card screen)
                return self.send(200, b'{"score":{"correct":4,"total":5,"pct":80},"counted":true}', 'application/json')
            return self.send(200, b'{"ok":true}', 'application/json')

    httpd = ThreadingHTTPServer(('127.0.0.1', 0), H)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


# the file's head comment is dropped so the page gets a bare function expression
MEASURE_JS = re.sub(r'^\s*/\*[\s\S]*?\*/\s*', '', open(os.path.join(HERE, 'look_probe.js'), encoding='utf-8').read())

# The grown-ups hold on the home: what a child sees on it, a short tap, and a press held for half of its time.
HOLD_JS = r"""
async () => {
  const g = document.querySelector('[data-tap="grownups"]');
  if (!g) return { present: false };
  const out = { present: true, text: (g.innerText || '').trim(), label: g.getAttribute('aria-label') };
  const fire = (t) => { try { g.dispatchEvent(new PointerEvent(t, { bubbles: true, pointerId: 1, isPrimary: true })); } catch (e) { g.dispatchEvent(new Event(t, { bubbles: true })); } };
  fire('pointerdown'); await new Promise((r) => setTimeout(r, 150)); fire('pointerup');
  await new Promise((r) => setTimeout(r, 120));
  const hint = document.querySelector('[data-hold-hint]');
  out.tapHint = hint && hint.getBoundingClientRect().height > 0 ? (hint.innerText || '').trim() : null;
  fire('pointerdown'); await new Promise((r) => setTimeout(r, 900));
  const r = g.getBoundingClientRect();
  const lab = g.querySelector('[data-hold-label]');
  const lr = (lab || g).getBoundingClientRect();
  const top = document.elementFromPoint(lr.left + lr.width / 2, lr.top + lr.height / 2);
  out.labelOnTop = Boolean(top && (top === lab || (lab && lab.contains(top))));
  out.ring = Boolean(g.querySelector('[data-hold-ring]'));
  // half way through the hold the ring's arc is part drawn (100 = none, 0 = full)
  const arc = g.querySelector('[data-hold-ring] circle:last-child');
  out.ringOffset = arc ? Math.round(parseFloat(getComputedStyle(arc).strokeDashoffset)) : null;
  out.box = { w: Math.round(r.width), h: Math.round(r.height) };
  fire('pointerup');
  return out;
}
"""

# The story-done card (shot 3): the shipped finish card mounted on a screen with its Home, as the reader does.
CARD_JS = r"""
async ([lang, token, kid]) => {
  const load = (src, css) => new Promise((ok) => { const el = document.createElement(css ? 'link' : 'script'); if (css) { el.rel = 'stylesheet'; el.href = src; } else { el.src = src; } el.onload = ok; el.onerror = ok; document.head.appendChild(el); });
  await load('/wq/wq-finish-card.css', true); await load('/wq/wq-finish-card.js');
  const root = document.getElementById('wq');
  root.innerHTML = '<section class="wq-screen" data-screen="story-done"><div class="wq-stack" id="lg-stack"></div></section>';
  window.location.hash = '#lg';
  window.WQFC.mount(document.getElementById('lg-stack'), { source: 'story', ended: true, pages_read: 3, stars: 3, title: lang === 'ur' ? 'لال پتنگ' : 'The red kite', lang, auth: { hub: token, kid }, home: true, ev: function () {} });
  await new Promise((r) => setTimeout(r, 400));
  return true;
}
"""


def main():
    out_dir = os.path.abspath(sys.argv[1])
    shots = '--shots' in sys.argv
    man = json.load(open(os.path.join(out_dir, 'manifest.json')))
    from playwright.sync_api import sync_playwright
    os.makedirs(os.path.join(out_dir, 'shots'), exist_ok=True)
    httpd = server(out_dir)
    base = 'http://127.0.0.1:%d' % httpd.server_address[1]
    init = ("try{if(window.speechSynthesis){speechSynthesis.speak=function(){};}}catch(e){}"
            "try{HTMLMediaElement.prototype.play=function(){return Promise.resolve();};}catch(e){}"
            "try{localStorage.setItem('wq_sound','false');localStorage.setItem('wq_snd','0');}catch(e){}")
    results = []
    with sync_playwright() as p:
        browser = p.chromium.launch(args=['--mute-audio', '--autoplay-policy=user-gesture-required'])
        try:
            for pg in man['pages']:
                for w in WIDTHS:
                    ctx = browser.new_context(viewport={'width': w, 'height': 740}, user_agent=UA, device_scale_factor=2, is_mobile=True, has_touch=True)
                    ctx.add_init_script(init)
                    if pg['kind'] == 'quiz':
                        # a child already picked, one question answered: the landing's Continue (render-matrix's state)
                        state = {'st': 'look-gate', 'child': {'first': 'Sana Testwala', 'animal': 'cat', 'chip': 'lg'}, 'answers': {pg['filler']: {'slot': 'A', 'ok': True}},
                                 'queue': [], 'seq': 1, 'wrong': [], 'result': None}
                        ctx.add_init_script("try{localStorage.setItem(%s,%s);}catch(e){}" % (json.dumps('wq_s_' + pg['code']), json.dumps(json.dumps(state))))
                    page = ctx.new_page()
                    errs = []
                    page.on('pageerror', lambda e: errs.append(str(e)[:200]))

                    def shot(screen):
                        page.evaluate('document.fonts.ready.then(()=>1)')
                        page.wait_for_timeout(250)
                        m = page.evaluate(MEASURE_JS)
                        m.update({'page': pg['name'], 'lang': pg['lang'], 'width': w, 'view': screen, 'errors': list(errs)})
                        if shots:
                            page.screenshot(path=os.path.join(out_dir, 'shots', '%s-%s-%d.png' % (screen, pg['lang'], w)), full_page=False)
                        results.append(m)
                        return m

                    try:
                        if pg['kind'] == 'hub':
                            for screen, h in (('home', ''), ('stories', '#stories'), ('games', '#games'), ('videos', '#videos')):
                                page.goto(base + pg['path'] + h, wait_until='load')
                                page.wait_for_selector('[data-screen]', timeout=8000)
                                page.wait_for_timeout(600)
                                m = shot(screen)
                                if screen == 'home':
                                    m['hold'] = page.evaluate(HOLD_JS)
                                    if shots:
                                        # after a short tap (the hint shows), then half way through a real hold (the ring part drawn)
                                        page.evaluate("()=>{const g=document.querySelector('[data-tap=grownups]');if(!g)return;g.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));setTimeout(()=>g.dispatchEvent(new PointerEvent('pointerup',{bubbles:true})),150);}")
                                        page.wait_for_timeout(400)
                                        page.screenshot(path=os.path.join(out_dir, 'shots', 'hold-tap-%s-%d.png' % (pg['lang'], w)), full_page=False)
                                        page.wait_for_timeout(1700)
                                        page.evaluate("()=>{const g=document.querySelector('[data-tap=grownups]');if(g)g.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));}")
                                        page.wait_for_timeout(1000)
                                        page.screenshot(path=os.path.join(out_dir, 'shots', 'hold-mid-%s-%d.png' % (pg['lang'], w)), full_page=False)
                                        page.evaluate("()=>{const g=document.querySelector('[data-tap=grownups]');if(g)g.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));}")
                            page.goto(base + pg['path'], wait_until='load')
                            page.wait_for_selector('[data-screen]', timeout=8000)
                            page.evaluate(CARD_JS, [pg['lang'], man['token'], man['kid']])
                            shot('story-done')
                        elif pg['kind'] == 'ch':
                            page.goto(base + pg['path'], wait_until='load')
                            page.wait_for_selector('#wqc-ex-read', timeout=8000)
                            page.wait_for_timeout(400)
                            shot('ch-menu')
                            page.click('#wqc-ex-read')
                            page.wait_for_timeout(1500)
                            shot('ch-read')
                        elif pg['kind'] == 'practice':
                            page.goto(base + pg['path'], wait_until='load')
                            page.wait_for_selector('[data-screen]', timeout=8000)
                            page.wait_for_timeout(600)
                            shot('practice-home')
                        elif pg['kind'] == 'shelf':
                            page.goto(base + pg['path'] + '?wait=1#stories', wait_until='load')
                            page.wait_for_selector('[data-screen]', timeout=8000)
                            page.wait_for_timeout(900)
                            shot('stories-wait')
                            page.goto(base + pg['path'] + '#stories', wait_until='load')
                            page.wait_for_selector('[data-screen]', timeout=8000)
                            try:
                                page.wait_for_selector('[data-screen="stories-retry"]', timeout=6000)
                            except Exception:
                                pass
                            page.wait_for_timeout(400)
                            shot('stories-retry')
                        else:
                            page.goto(base + pg['path'], wait_until='load')
                            page.wait_for_selector('#wq-cont', timeout=8000)
                            shot('quiz-start')
                            page.click('#wq-cont')
                            page.wait_for_selector('#wq[data-m="M6"] .wq-item', timeout=8000)
                            shot('quiz-question')
                            # the end: a run that already finished opens on its card screen (the share card, the class
                            # table and the league doors), as a child who comes back to the link sees it
                            state['result'] = {'score': {'correct': 4, 'total': 5, 'pct': 80}, 'counted': True}
                            ctx2 = browser.new_context(viewport={'width': w, 'height': 740}, user_agent=UA, device_scale_factor=2, is_mobile=True, has_touch=True)
                            ctx2.add_init_script(init)
                            ctx2.add_init_script("try{localStorage.setItem(%s,%s);}catch(e){}" % (json.dumps('wq_s_' + pg['code']), json.dumps(json.dumps(state))))
                            try:
                                page = ctx2.new_page()
                                page.on('pageerror', lambda e: errs.append(str(e)[:200]))
                                page.goto(base + pg['path'], wait_until='load')
                                page.wait_for_selector('#wq[data-m="M10"]', timeout=8000)
                                page.wait_for_timeout(500)
                                shot('quiz-card')
                            finally:
                                ctx2.close()
                    except Exception as e:
                        results.append({'page': pg['name'], 'lang': pg['lang'], 'width': w, 'fatal': str(e).split('\n')[0][:240], 'errors': list(errs)})
                    finally:
                        ctx.close()
        finally:
            browser.close()
            httpd.shutdown()
    v = verdict(results)
    json.dump({'results': results, 'verdict': v}, open(os.path.join(out_dir, 'results.json'), 'w'), indent=1, ensure_ascii=False)
    with open(os.path.join(out_dir, 'verdict.txt'), 'w') as f:
        for row in v['rows']:
            f.write('%s %-12s %s %s %d  %s\n' % (row['ok'] and 'PASS' or 'FAIL', row['view'], row['lang'], row['dir'], row['width'], '; '.join(row['why'])))
        f.write('ALL %s (%d/%d screens)\n' % ('PASS' if v['pass'] else 'FAIL', sum(1 for r in v['rows'] if r['ok']), len(v['rows'])))
    print(open(os.path.join(out_dir, 'verdict.txt')).read())
    for r in results:
        if r.get('fatal'):
            print('FATAL', r['page'], r['width'], r['fatal'])
            continue
        homes = [b for b in r['buttons'] if b['home']]
        print('%-14s %s %d  1b=%s gutter=%d  buttons=%d homes=%d off>2=%d  primary=%s' % (
            r['view'], r['lang'], r['width'], r['oneButton'], len(r['gutter']), len(r['buttons']), len(homes),
            sum(1 for b in r['buttons'] if b['labelOff'] is not None and abs(b['labelOff']) > 2),
            (r['primary'] or {}).get('ok')))


# One Home look per phone: every Home on every screen of one language and width draws the same box.
HOME_KEYS = ('h', 'radius', 'shadow', 'border', 'bg')


def verdict(results):
    rows = []
    homes = {}
    for r in results:
        if r.get('fatal'):
            rows.append({'view': r['page'], 'lang': r['lang'], 'dir': '?', 'width': r['width'], 'ok': False, 'why': ['fatal: ' + r['fatal']]})
            continue
        why = []
        if r['gutter']:
            why.append('gutter %d: ' % len(r['gutter']) + ', '.join('%s L%s R%s' % (g['el'][:40], g['left'], g['right']) for g in r['gutter'][:4]))
        if r['scrollW'] > r['vw']:
            why.append('sideways scroll %d > %d' % (r['scrollW'], r['vw']))
        if r['primary'] and not r['primary']['ok']:
            why.append('primary bottom %d > %d' % (r['primary']['bottom'], r['vh']))
        off = [b for b in r['buttons'] if b['labelOff'] is not None and abs(b['labelOff']) > 2]
        if off:
            why.append('label off-centre: ' + ', '.join('%s %+.1fpx' % (b['el'][:30], b['labelOff']) for b in off[:4]))
        if r.get('oneButton'):
            # the one button system's sizes (only when it is on): text buttons 56 / 52 (76 two-line), icon-only a 48 circle
            bad = [b for b in r['buttons'] if (b['w'] != 48 or b['h'] != 48 or not (b['radius'].endswith('%') or parseFloat(b['radius'] or 0) >= 24)) and b.get('icon')]
            bad += [b for b in r['buttons'] if not b.get('icon') and b['h'] not in (52, 56, 76)]
            if bad:
                why.append('size: ' + ', '.join('%s %dx%d r%s' % (b['el'][:30], b['w'], b['h'], b['radius']) for b in bad[:4]))
            hs = sorted({x['h'] for x in r.get('rows') or []})
            if len(hs) > 1:
                why.append('rows %d heights: %s' % (len(hs), ' '.join(map(str, hs))))
            if len(r.get('radii') or []) > 3:
                why.append('radii %d > 3: %s' % (len(r['radii']), ' '.join(r['radii'])))
        fl = [f for f in r.get('folds') or [] if not f['marker'] or f['h'] < 48]
        if fl:
            why.append('folds: ' + ', '.join('%s %dpx%s' % (f['el'][:30], f['h'], '' if f['marker'] else ' no marker') for f in fl[:4]))
        if r.get('targets'):
            why.append('targets < 48: ' + ', '.join('%s %dx%d' % (t['el'][:30], t['w'], t['h']) for t in r['targets'][:4]))
        h = r.get('hold')
        if h is not None:
            if not h.get('present'):
                why.append('hold: no grown-ups button')
            else:
                if not re.search(r'hold|دبائے', h.get('text') or '', re.I):
                    why.append('hold: the words do not say hold (%r)' % (h.get('text') or '')[:30])
                if not h.get('tapHint'):
                    why.append('hold: a short tap says nothing')
                if not h.get('labelOnTop'):
                    why.append('hold: the label is covered while held')
                if not (h.get('ring') and h.get('ringOffset') is not None and 0 < h['ringOffset'] < 100):
                    why.append('hold: no ring filling part way (%s)' % h.get('ringOffset'))
        for b in r['buttons']:
            if b['home']:
                homes.setdefault((r['lang'], r['width']), []).append((r['view'], b))
        rows.append({'view': r['view'], 'lang': r['lang'], 'dir': r.get('dir', 'ltr'), 'width': r['width'], 'ok': not why, 'why': why})
    for (lang, w), hs in homes.items():
        looks = {tuple(b[k] for k in HOME_KEYS) for _v, b in hs}
        if len(looks) > 1:
            rows.append({'view': 'home-buttons', 'lang': lang, 'dir': '-', 'width': w, 'ok': False,
                         'why': ['%d Home looks: ' % len(looks) + ' | '.join('%s %s h%s r%s' % (v, b['el'][:24], b['h'], b['radius']) for v, b in hs[:6])]})
        else:
            rows.append({'view': 'home-buttons', 'lang': lang, 'dir': '-', 'width': w, 'ok': True, 'why': ['%d Homes, one look' % len(hs)]})
    return {'pass': all(r['ok'] for r in rows), 'rows': rows}


if __name__ == '__main__':
    main()
