#!/usr/bin/env python3
"""RENDER MATRIX — runner. Serves the pages build_matrix.js wrote, the REAL page assets
(dashboard/public/wq) and a stub of the page's API (/api/wq/*), then opens every page in
headless Chromium the way a child's phone does (WhatsApp Android in-app browser UA,
360x740, muted), resumes straight into the item under test, and asserts on the QUESTION
screen and, after an answer, on the FEEDBACK screen:

  h_overflow      the page scrolls sideways
  offscreen       an element sits past the screen edge
  clipped         a text box cuts its own text (scroll size > box, overflow not visible)
  overlap         two text lines from different elements cover each other
  empty_option    an option with no visible text and no visible picture
  raw_dollar / raw_tex   maths left as "$…$" or "\\frac" on screen; no_math: $…$ in, no <math> out
  tex_letters     a TeX command the page did not know, spelled out inside <math> ("Omega", "begin")
  urdu_font       Urdu text not set in the page's Nastaliq face, or the face never loaded
  figure_missing / figure_empty / figure_img_broken   the item has a picture and it is not drawn

Usage: run_matrix.py <outDir> [--only <substring>] [--no-shots]
Writes <outDir>/results.json and PNGs under <outDir>/shots/. Exit 0 always; the caller
(dashboard/tests/web-quiz-render-matrix.test.js) decides what fails. Synthetic data only.
"""
import json, os, re, sys, threading, struct, zlib
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
PUBLIC = os.path.join(ROOT, 'dashboard', 'public')
UA = ('Mozilla/5.0 (Linux; Android 13; SM-A145F Build/TP1A.220624.014; wv) AppleWebKit/537.36 '
      '(KHTML, like Gecko) Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36 WhatsApp/2.24.18.80')


def png(w=480, h=320):
    """A plain grey PNG: the stored-picture fallback the stub serves for /api/wq/media."""
    raw = b''.join(b'\x00' + b'\xd0\xd8\xe0' * w for _ in range(h))
    def chunk(t, d):
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', zlib.crc32(t + d) & 0xffffffff)
    return b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2, 0, 0, 0)) + chunk(b'IDAT', zlib.compress(raw)) + chunk(b'IEND', b'')


PNG = png()


def server(out_dir, missing=()):
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
            if p.startswith('/q/'):
                f = os.path.join(pages, os.path.basename(p) + '.html')
                if os.path.exists(f):
                    return self.send(200, open(f, 'rb').read(), 'text/html; charset=utf-8')
                return self.send(404, b'no page', 'text/plain')
            if p.startswith('/api/wq/media/'):
                # a case whose picture file never arrives (an object missing from the bucket)
                if any('/' + q in p for q in missing):
                    return self.send(404, b'', 'text/plain')
                return self.send(200, PNG, 'image/png')
            if p.startswith('/api/wq/'):
                return self.send(200, b'{}', 'application/json')
            if p.startswith('/wq/'):
                f = os.path.normpath(os.path.join(PUBLIC, p.lstrip('/')))
                if f.startswith(PUBLIC) and os.path.isfile(f):
                    ext = os.path.splitext(f)[1]
                    ctype = {'.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.woff2': 'font/woff2',
                             '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg'}.get(ext, 'application/octet-stream')
                    return self.send(200, open(f, 'rb').read(), ctype)
            return self.send(404, b'', 'text/plain')

        def do_POST(self):
            n = int(self.headers.get('content-length') or 0)
            if n:
                self.rfile.read(n)
            return self.send(200, b'{"ok":true}', 'application/json')

    httpd = ThreadingHTTPServer(('127.0.0.1', 0), H)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd


CHECK_JS = r"""
([lang, expectFig, maths]) => {
  const P = [];
  const vw = window.innerWidth;
  const root = document.querySelector('#wq');
  const desc = (e) => (e.className && typeof e.className === 'string' ? '.' + e.className.trim().split(/\s+/)[0] : e.tagName.toLowerCase());
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && cs.opacity !== '0'; };
  if (document.documentElement.scrollWidth > vw + 1) P.push('h_overflow:' + document.documentElement.scrollWidth);
  // inside a box that scrolls or clips on its own (a long maths line), the overflow is the box's, not the page's
  const inScroller = (e) => { for (let p = e.parentElement; p && p !== root; p = p.parentElement) if (getComputedStyle(p).overflowX !== 'visible') return true; return false; };
  for (const e of root.querySelectorAll('*')) {
    if (e.closest('svg') && e.tagName.toLowerCase() !== 'svg') continue;
    if (inScroller(e)) continue;
    const r = e.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && (r.right > vw + 1 || r.left < -1) && getComputedStyle(e).position !== 'fixed') { P.push('offscreen:' + desc(e) + ':' + Math.round(r.left) + '..' + Math.round(r.right)); break; }
  }
  const TEXT = '.wq-qtext,.wq-lab,.wq-pname,.wq-small,.wq-glyph,.wq-why,.wq-fb,.wq-qof,.wq-emoji,.wq-let,.wq-hotn,.wq-btn';
  const els = [...root.querySelectorAll(TEXT)].filter(vis);
  for (const e of els) {
    const cs = getComputedStyle(e);
    if ((e.scrollWidth > e.clientWidth + 2 && cs.overflowX !== 'visible') || (e.scrollHeight > e.clientHeight + 2 && cs.overflowY !== 'visible')) P.push('clipped:' + desc(e));
  }
  // line boxes of each element's own text
  const lines = [];
  for (const e of els) {
    for (const n of e.childNodes) {
      if (n.nodeType !== 3 || !n.textContent.trim()) continue;
      const rg = document.createRange(); rg.selectNodeContents(n);
      for (const r of rg.getClientRects()) if (r.width > 1 && r.height > 1) lines.push({ e, r });
    }
  }
  let overlaps = 0;
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) {
    const a = lines[i], b = lines[j];
    if (a.e === b.e || a.e.contains(b.e) || b.e.contains(a.e)) continue;
    const w = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
    const h = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
    if (w > 4 && h > 4) { overlaps++; if (overlaps === 1) P.push('overlap:' + desc(a.e) + '/' + desc(b.e)); }
  }
  for (const b of root.querySelectorAll('.wq-opt,.wq-mr,.wq-ml')) {
    if (!vis(b)) continue;
    const t = (b.innerText || '').replace(/\s+/g, '').replace(/^[A-D]$/, '');
    const pic = [...b.querySelectorAll('svg,img,.wq-glyph,.wq-emoji')].some((x) => { const r = x.getBoundingClientRect(); return r.width > 8 && r.height > 8; });
    if (!t && !pic) P.push('empty_option');
  }
  const txt = root.innerText || '';
  if (/\$/.test(txt)) P.push('raw_dollar');
  if (/\\[a-zA-Z]+/.test(txt)) P.push('raw_tex');
  if (maths && !root.querySelector('math')) P.push('no_math');
  for (const mi of root.querySelectorAll('math mi')) if ([...mi.textContent].length > 1) { P.push('tex_letters:' + mi.textContent); break; }
  if (lang === 'ur') {
    if (!document.fonts.check('20px "WQ Nastaliq"', 'سیب')) P.push('urdu_font:not_loaded');
    for (const e of root.querySelectorAll('.wq-qtext,.wq-lab,.wq-pname,.wq-why,.wq-fb')) {
      if (/[؀-ۿ]/.test(e.innerText || '') && !/Nastaliq/i.test(getComputedStyle(e).fontFamily)) { P.push('urdu_font:' + desc(e)); break; }
    }
  }
  // A figure that hid itself (its file never arrived) counts as no figure: the documented fallback.
  const fig = [...root.querySelectorAll('.wq-fig')].find(vis) || null;
  if (expectFig && !fig) P.push('figure_missing');
  if (fig) {
    const s = fig.querySelector('.wq-svg svg, img');
    const r = s && s.getBoundingClientRect();
    if (!r || r.width < 40 || r.height < 20) P.push('figure_empty');
    if (s && s.tagName === 'IMG' && !s.naturalWidth) P.push('figure_img_broken');
  }
  return P;
}
"""

# Taps a given answer ("B", "A,C", "C,A,B") through the page's own controls, by the kind the PAGE chose.
ANSWER_JS = r"""
(answer) => {
  const $ = (s) => document.querySelector(s);
  const item = $('.wq-item');
  const kind = item ? item.getAttribute('data-kind') : '';
  const slots = String(answer || '').split(',').filter(Boolean);
  const tap = (s) => { const e = $(s); if (!e) return false; e.click(); return true; };
  const check = () => tap('#wq-check');
  if (kind === 'order') { slots.forEach((x) => tap('.wq-pool [data-slot="' + x + '"]')); return check() ? 'order' : 'none'; }
  if (kind === 'match') { slots.forEach((x, i) => { tap('.wq-ml[data-i="' + i + '"]'); tap('.wq-mr[data-slot="' + x + '"]'); }); return check() ? 'match' : 'none'; }
  if (kind === 'label') return tap('.wq-hot[data-slot="' + slots[0] + '"]') ? 'label' : 'none';
  if (kind === 'multi') { slots.forEach((x) => tap('.wq-opt[data-slot="' + x + '"]')); return check() ? 'multi' : 'none'; }
  return tap('.wq-opt[data-slot="' + slots[0] + '"]') ? 'opt' : 'none';
}
"""


def main():
    out_dir = os.path.abspath(sys.argv[1])
    only = sys.argv[sys.argv.index('--only') + 1] if '--only' in sys.argv else None
    shots = '--no-shots' not in sys.argv
    fast = '--fast' in sys.argv
    manifest = json.load(open(os.path.join(out_dir, 'manifest.json')))
    if only:
        manifest = [m for m in manifest if only in m['id']]
    try:
        from playwright.sync_api import sync_playwright
    except ImportError:
        json.dump({'skipped': 'python playwright is not installed'}, open(os.path.join(out_dir, 'results.json'), 'w'))
        print('SKIP: python playwright is not installed')
        return
    os.makedirs(os.path.join(out_dir, 'shots'), exist_ok=True)
    httpd = server(out_dir, [m['missing_media'] for m in manifest if m.get('missing_media')])
    base = 'http://127.0.0.1:%d' % httpd.server_address[1]
    init = ("try{if(window.speechSynthesis){speechSynthesis.speak=function(){};}}catch(e){}"
            "try{HTMLMediaElement.prototype.play=function(){return Promise.resolve();};}catch(e){}")
    results = []
    with sync_playwright() as p:
        try:
            browser = p.chromium.launch(args=['--mute-audio', '--autoplay-policy=user-gesture-required'])
        except Exception as e:  # no browser binary
            json.dump({'skipped': 'chromium not available: %s' % str(e)[:200]}, open(os.path.join(out_dir, 'results.json'), 'w'))
            print('SKIP: chromium not available')
            httpd.shutdown()
            return
        try:
            for m in manifest:
                errs = []
                r = {'id': m['id'], 'lang': m['lang'], 'kind': m['kind'], 'note': m['note'], 'question': [], 'feedback_wrong': [], 'feedback': [], 'errors': errs}
                # Two passes on a fresh phone each: a wrong pick, then the right one (the feedback differs).
                # --fast (the jest run): the right pick is replayed only where its screen differs in kind
                # (order/match/multi/label controls, maths in the reason); the wrong pick always.
                passes = [('wrong', m.get('wrong'))]
                if not fast or m['kind'] in ('order', 'match', 'multi', 'label') or m['maths']:
                    passes.append(('right', m.get('right')))
                for pas, answer in passes:
                    ctx = browser.new_context(viewport={'width': 360, 'height': 740}, user_agent=UA, device_scale_factor=2, is_mobile=True, has_touch=True)
                    ctx.add_init_script(init)
                    state = {'st': 'render-matrix', 'child': {'first': 'Sana Testwala', 'animal': 'cat', 'chip': 'rm'}, 'answers': {m['filler']: {'slot': 'A', 'ok': True}},
                             'queue': [], 'seq': 1, 'wrong': [], 'result': None}
                    ctx.add_init_script("try{localStorage.setItem(%s,%s);localStorage.setItem('wq_sound','false');}catch(e){}" % (json.dumps('wq_s_' + m['code']), json.dumps(json.dumps(state))))
                    page = ctx.new_page()
                    page.on('pageerror', lambda e: errs.append(str(e)[:200]))
                    key = 'feedback' if pas == 'right' else 'feedback_wrong'
                    try:
                        page.goto(base + '/q/' + m['id'], wait_until='load')
                        page.wait_for_selector('#wq-cont', timeout=8000)
                        page.click('#wq-cont')
                        page.wait_for_selector('#wq[data-m="M6"] .wq-item', timeout=8000)
                        page.evaluate('document.fonts.ready.then(()=>1)')
                        page.wait_for_timeout(250)
                        if pas == 'wrong':
                            r['question'] = page.evaluate(CHECK_JS, [m['lang'], m['has_figure'] and not m.get('missing_media'), m['maths']])
                            if shots:
                                page.screenshot(path=os.path.join(out_dir, 'shots', m['id'] + '.q.png'), full_page=True)
                        # Jugnu's hint bubble opened (PR #1732's button; absent → skipped)
                        if pas == 'wrong' and page.query_selector('#wq-jhelp'):
                            page.click('#wq-jhelp')
                            page.wait_for_timeout(400)
                            r['hint'] = page.evaluate(CHECK_JS, [m['lang'], False, False])
                            r['hint_text'] = page.evaluate("(document.querySelector('#wq-hintbox')||{}).innerText||''")[:80]
                            if shots:
                                page.screenshot(path=os.path.join(out_dir, 'shots', m['id'] + '.hint.png'), full_page=True)
                        how = page.evaluate(ANSWER_JS, answer or 'A')
                        if how != 'none':
                            page.wait_for_selector('#wq[data-m="M7"] #wq-next', timeout=6000)
                            page.wait_for_timeout(200)
                            r[key] = page.evaluate(CHECK_JS, [m['lang'], False, False])
                            if shots:
                                page.screenshot(path=os.path.join(out_dir, 'shots', m['id'] + ('.fb.png' if pas == 'right' else '.fbw.png')), full_page=True)
                        else:
                            r[key] = ['no_answer_control']
                    except Exception as e:
                        r['fatal'] = (pas + ': ' + str(e).split('\n')[0])[:240]
                        try:
                            page.screenshot(path=os.path.join(out_dir, 'shots', m['id'] + '.fatal.png'), full_page=True)
                        except Exception:
                            pass
                    finally:
                        ctx.close()
                results.append(r)
        finally:
            browser.close()
            httpd.shutdown()
    json.dump(results, open(os.path.join(out_dir, 'results.json'), 'w'), indent=1, ensure_ascii=False)
    bad = [x for x in results if x['question'] or x['feedback'] or x.get('feedback_wrong') or x.get('hint') or x.get('fatal') or x['errors']]
    print('hint opened on', sum(1 for x in results if 'hint' in x), 'pages; with text:', sum(1 for x in results if x.get('hint_text')))
    print('render matrix: %d pages, %d with findings' % (len(results), len(bad)))
    for x in bad:
        print(' ', x['id'], 'Q=', x['question'], 'FBW=', x.get('feedback_wrong'), 'FB=', x['feedback'], 'HINT=', x.get('hint'), 'FATAL=', x.get('fatal', ''), 'JS=', x['errors'][:1])


if __name__ == '__main__':
    main()
