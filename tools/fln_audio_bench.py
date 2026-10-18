#!/usr/bin/env python3
"""FLN sound-player bench: measures the AUDIO BAR rows A1-A6, the mirror/orig switch path, tap targets and a mirror burst.

Drives a page that renders FLN sound controls and reads three things from it:
  * controls:   button[data-fln-clip]   (the clip id), with the state attribute data-fln-state = idle|loading|playing|error
  * the `playing` media event (capture phase; elements made with `new Audio()` are tracked by patching Audio/createElement)
  * window.__flnEvents / window.__flnAudios when the page exposes them (the dev bench page does)

Default target is the local Vite bench page (portal/src/portal/fln/player/bench/bench.html). It can also run against any real
page by URL: pass --url with `{plan}` in it (or the harness appends ?plan=<id>).

Plan JSON is fed to the bench page with page.route on /__fixture/plan/<id>.json from --plans-dir (or --orig-plans-dir with
--orig); no plan text is stored in the repo. Both directories default from FLN_PLANS_DIR / FLN_PLANS_ORIG_DIR.

Audio is never audible: Chromium runs with --mute-audio; WebKit has no such flag, so media volume is forced to 0 there.
Network throttling is CDP Network.emulateNetworkConditions (Chromium only; WebKit has no CDP and runs unthrottled).

Run through the project guard:  konya_guard.py run --class browser -- python3 tools/fln_audio_bench.py --plans 11156,11133,10152
"""
from __future__ import annotations

import argparse
import concurrent.futures
import datetime as dt
import json
import math
import os
import pathlib
import random
import re
import statistics
import sys
import time
import urllib.error
import urllib.request
from urllib.parse import unquote

try:
    from playwright.sync_api import Error as PWError
    from playwright.sync_api import TimeoutError as PWTimeout
    from playwright.sync_api import sync_playwright
except ImportError:  # pragma: no cover
    print('playwright for python is required: pip install playwright', file=sys.stderr)
    raise

DEFAULT_URL = 'http://localhost:5182/src/portal/fln/player/bench/bench.html'
SEL = 'button[data-fln-clip]'
AUDIO_RE = re.compile(r'\.(mp3|m4a|aac|ogg|wav|opus)(\?|$)', re.I)

UA = {
    'iab-android': (
        'Mozilla/5.0 (Linux; Android 13; SM-A145F Build/TP1A.220624.014; wv) AppleWebKit/537.36 (KHTML, like Gecko) '
        'Version/4.0 Chrome/129.0.6668.100 Mobile Safari/537.36 WhatsApp/2.24.21.80'
    ),
    'iab-ios': (
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) '
        'Mobile/15E148 WhatsApp/2.24.21.80'
    ),
}

# Thresholds from AUDIO_BAR.md
BAR = {'A1': 150, 'A2': 800, 'A3': 100, 'A6_ms': 6500, 'pill_h': 48, 'tile': 56, 'rate429_pct': 0.5}

# ----------------------------------------------------------------------------------------------------------------------
# In-page instrumentation (an init script: runs before the page's own code)
# ----------------------------------------------------------------------------------------------------------------------
INIT_JS = r"""
(() => {
  if (window.__benchInit) return;
  window.__benchInit = true;
  window.__bench = {};
  window.__benchBtn = null;
  window.__benchAudios = [];
  window.__benchLog = [];
  window.__pending = 0;
  window.__lastNet = performance.now();
  window.__fetchedOK = [];
  const AUD = /\.(mp3|m4a|aac|ogg|wav|opus)(\?|$)/i;
  const log = (k) => { if (window.__benchLog.length < 600) window.__benchLog.push([Math.round(performance.now()), k]); };

  // -- fetch bookkeeping: what is in flight, what audio finished (the warm state)
  const of = window.fetch;
  window.fetch = function (input, init) {
    window.__pending++;
    const url = typeof input === 'string' ? input : (input && input.url) || String(input);
    return of.apply(this, arguments).then((r) => {
      if (r.ok && AUD.test(url)) window.__fetchedOK.push(url);
      return r;
    }).finally(() => { window.__pending--; window.__lastNet = performance.now(); });
  };
  for (const m of ['blob', 'arrayBuffer']) {
    const orig = Response.prototype[m];
    Response.prototype[m] = function () {
      window.__pending++;
      return orig.apply(this, arguments).finally(() => { window.__pending--; window.__lastNet = performance.now(); });
    };
  }

  // -- every media element the page makes
  const onPlaying = () => {
    const b = window.__bench;
    if (b && b.t0 != null && b.tPlaying == null) b.tPlaying = performance.now();
  };
  const track = (el) => {
    if (el.__bt) return el;
    el.__bt = 1;
    window.__benchAudios.push(el);
    ['playing', 'error', 'pause', 'waiting', 'loadstart', 'loadedmetadata', 'canplay', 'stalled', 'ended'].forEach((ev) =>
      el.addEventListener(ev, () => { log(ev); if (ev === 'playing') onPlaying(); }, true));
    return el;
  };
  const NA = window.Audio;
  window.Audio = function Audio(...a) { return track(new NA(...a)); };
  window.Audio.prototype = NA.prototype;
  const oce = Document.prototype.createElement;
  Document.prototype.createElement = function (n, o) {
    const el = oce.call(this, n, o);
    if (String(n).toLowerCase() === 'audio') track(el);
    return el;
  };
  document.addEventListener('playing', onPlaying, true);
  const op = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function () {
    if (window.__benchMute) this.volume = 0;
    const r = op.apply(this, arguments);
    if (r && r.catch) r.catch((e) => { log('play-rejected:' + e.name); const b = window.__bench; if (b) b.playErr = e.name; });
    return r;
  };

  // -- t0: capture-phase pointerdown on the control
  document.addEventListener('pointerdown', (e) => {
    const btn = e.target && e.target.closest ? e.target.closest(__SEL__) : null;
    window.__benchBtn = btn;
    window.__bench = {
      t0: performance.now(),
      clip: btn ? btn.getAttribute('data-fln-clip') : null,
      state0: btn ? btn.getAttribute('data-fln-state') : null,
      evIdx: (window.__flnEvents || []).length,
    };
  }, true);

  // -- first data-fln-state change on the tapped control
  const watch = () => {
    new MutationObserver((muts) => {
      const now = performance.now();
      const b = window.__bench;
      if (!b || b.t0 == null) return;
      const btn = window.__benchBtn;
      for (const m of muts) {
        if (m.attributeName !== 'data-fln-state') continue;
        const t = m.target;
        const mine = t === btn || (btn && !btn.isConnected && t.getAttribute('data-fln-clip') === b.clip);
        if (!mine) continue;
        const v = t.getAttribute('data-fln-state');
        if (b.tState == null) { b.tState = now; b.firstState = v; }
        if (v === 'error' && b.tError == null) b.tError = now;
        if (v === 'playing' && b.tUiPlaying == null) b.tUiPlaying = now;
      }
    }).observe(document.documentElement, { attributes: true, subtree: true, attributeFilter: ['data-fln-state'] });
  };
  if (document.documentElement) watch(); else document.addEventListener('DOMContentLoaded', watch);

  // -- overlap sampler: >= 2 elements un-paused at the same sample
  window.__startOverlap = () => {
    const o = window.__overlap = { episodes: 0, samples: 0, max: 0, inOv: false };
    window.__ovTimer = setInterval(() => {
      const els = new Set(window.__benchAudios);
      (window.__flnAudios || []).forEach((a) => els.add(a));
      let n = 0;
      els.forEach((a) => { if (!a.paused && !a.ended) n++; });
      if (n > o.max) o.max = n;
      if (n >= 2) { o.samples++; if (!o.inOv) { o.episodes++; o.inOv = true; } } else o.inOv = false;
    }, 5);
  };
  window.__stopOverlap = () => { clearInterval(window.__ovTimer); return window.__overlap; };
})();
""".replace('__SEL__', json.dumps(SEL))


# ----------------------------------------------------------------------------------------------------------------------
# small helpers
# ----------------------------------------------------------------------------------------------------------------------
def p95(xs):
    xs = sorted(x for x in xs if x is not None)
    if not xs:
        return None
    return xs[max(0, math.ceil(0.95 * len(xs)) - 1)]


def r1(x):
    return None if x is None else round(x, 1)


def add_query(url: str, **kv) -> str:
    out = url
    for k, v in kv.items():
        out += ('&' if '?' in out else '?') + f'{k}={v}'
    return out


def parse_throttle(s: str):
    if not s or s.lower() == 'none':
        return None
    m = re.fullmatch(r'(\d+)k/(\d+)ms', s.strip().lower())
    if not m:
        raise SystemExit(f'--throttle: expected like 400k/300ms or none, got {s!r}')
    return {'kbps': int(m.group(1)), 'latency_ms': int(m.group(2))}


OLD_HOST_RE = re.compile(r'https://pub-[0-9a-f]+\.r2\.dev')
_LIVE_BASE: list = []


def live_base():
    """The COS's live public base (root .env CONTENT_R2_PUBLIC_URL, read as ONE key), scheme+host only."""
    if not _LIVE_BASE:
        v = read_env_key('CONTENT_R2_PUBLIC_URL', pathlib.Path(__file__).resolve().parent)
        m = re.match(r'^(https?://[^/]+)', v or '')
        _LIVE_BASE.append(m.group(1) if m else '')
    return _LIVE_BASE[0]


def plan_text(f: pathlib.Path, rewrite=True) -> str:
    t = f.read_text()
    lb = live_base()
    return OLD_HOST_RE.sub(lb, t) if (rewrite and lb) else t


def load_plan(plans_dir: pathlib.Path, pid: str):
    f = plans_dir / f'{pid}.json'
    if not f.exists():
        return None
    return json.loads(plan_text(f))


def audio_media(plan) -> list:
    """Every audio media object of a plan, in document order."""
    out = []

    def walk(o):
        if isinstance(o, dict):
            if o.get('kind') == 'audio' and isinstance(o.get('src'), str):
                out.append(o)
            for v in o.values():
                walk(v)
        elif isinstance(o, list):
            for v in o:
                walk(v)

    walk(plan)
    return out


def read_env_key(key: str, start: pathlib.Path):
    """Read ONE key from the nearest ancestor .env that defines it. Nothing else in the file is read into memory."""
    pat = re.compile(r'^\s*' + re.escape(key) + r'\s*=\s*(.*?)\s*$')
    for d in [start, *start.parents]:
        f = d / '.env'
        if not f.is_file():
            continue
        try:
            with f.open() as fh:
                for line in fh:
                    m = pat.match(line)
                    if m:
                        return m.group(1).strip('"\'')
        except OSError:
            continue
    return None


# ----------------------------------------------------------------------------------------------------------------------
# the browser side
# ----------------------------------------------------------------------------------------------------------------------
class Bench:
    def __init__(self, args, pw):
        self.a = args
        self.pw = pw
        self.throttle = parse_throttle(args.throttle)
        self.warm_throttle = parse_throttle(args.warm_throttle)
        self.ua = UA[args.ua]
        self.diag: list[str] = []
        if args.engine == 'chromium':
            self.browser = pw.chromium.launch(headless=True, args=['--mute-audio', '--autoplay-policy=user-gesture-required'])
        else:
            try:
                self.browser = pw.webkit.launch(headless=True)
            except PWError as e:  # not installed
                raise SystemExit(f'webkit could not launch ({str(e).splitlines()[0]}). Install it via the guard: --class install')
        self.cdp_ok = args.engine == 'chromium'
        self.plans_dir = pathlib.Path(args.orig_plans_dir if args.orig else args.plans_dir or '.')
        self.plan_cache: dict = {}

    # -- plans
    def plan(self, pid):
        if pid not in self.plan_cache:
            self.plan_cache[pid] = load_plan(self.plans_dir, pid)
        return self.plan_cache[pid]

    def url_for(self, pid, nowarm=False):
        base = self.a.url
        u = base.replace('{plan}', str(pid)) if '{plan}' in base else add_query(base, plan=pid)
        if nowarm:
            u = add_query(u, nowarm=1)
        return u

    # -- page factory
    def _throttle(self, ctx, page, throttle):
        cdp = ctx.new_cdp_session(page)
        cdp.send('Network.enable')
        cdp.send('Network.setCacheDisabled', {'cacheDisabled': True})
        bps = throttle['kbps'] * 1000 / 8
        cdp.send('Network.emulateNetworkConditions', {'offline': False, 'latency': throttle['latency_ms'], 'downloadThroughput': bps, 'uploadThroughput': bps})

    def open(self, pid, *, nowarm=False, routes=None, throttle=None, offline_after=False, throttle_first=False):
        """New context + page, the fixture route, optional extra routes, wait for controls, THEN throttle (the page is not
        what we measure). `routes` = list of (pattern, handler). `throttle_first` throttles before the page loads, so the
        page's own prefetch runs on the slow line too (the A2 phase)."""
        ctx = self.browser.new_context(
            viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True, user_agent=self.ua, locale='en-US'
        )
        ctx.add_init_script(INIT_JS)
        if self.a.engine != 'chromium':
            ctx.add_init_script('window.__benchMute = true;')
        plans_dir = self.plans_dir

        def fixture(route):
            m = re.search(r'/__fixture/plan/([^/]+)\.json', route.request.url)
            f = plans_dir / f'{m.group(1)}.json' if m else None
            if f and f.exists():
                route.fulfill(status=200, body=plan_text(f).encode(), headers={'content-type': 'application/json', 'access-control-allow-origin': '*'})
            else:
                route.fulfill(status=404, body='{}', headers={'access-control-allow-origin': '*'})

        ctx.route(re.compile(r'/__fixture/plan/[^/]+\.json'), fixture)
        for pat, h in routes or []:
            ctx.route(pat, h)
        page = ctx.new_page()
        errs: list[str] = []
        page.on('console', lambda m: errs.append('console:' + m.text[:160]) if m.type == 'error' else None)
        page.on('pageerror', lambda e: errs.append('pageerror:' + str(e)[:160]))
        page.__dict__['_errs'] = errs
        if throttle and throttle_first and self.cdp_ok:
            self._throttle(ctx, page, throttle)
        page.goto(self.url_for(pid, nowarm), wait_until='domcontentloaded', timeout=60000)
        try:
            page.wait_for_selector(SEL, timeout=self.a.ready_timeout * 1000, state='attached')
        except PWTimeout:
            self.diag.append(f'plan {pid}: no {SEL} rendered within {self.a.ready_timeout}s; page errors: {errs[:3]}')
        if throttle and self.cdp_ok and not throttle_first:
            self._throttle(ctx, page, throttle)
        if offline_after:
            ctx.set_offline(True)
        return ctx, page

    def settle_warm(self, page, quiet_ms=700, timeout_s=90):
        """Wait until the page's warm finished: nothing in flight for quiet_ms, at least 1.5 s after the controls rendered."""
        page.wait_for_timeout(1500)
        try:
            # fetch() idle AND no audio element still loading (networkState 2), both for quiet_ms
            page.wait_for_function(
                f'''() => {{ const busy = window.__pending > 0 || (window.__benchAudios || []).some(a => a.networkState === 2 && a.readyState < 4);
                   const t = performance.now(); if (busy) {{ window.__busyAt = t; return false; }}
                   return t - Math.max(window.__lastNet, window.__busyAt || 0) > {quiet_ms}; }}''', timeout=timeout_s * 1000, polling=100
            )
            return True
        except PWTimeout:
            self.diag.append('warm did not settle within %ds' % timeout_s)
            return False

    # -- controls
    def n_buttons(self, page):
        return page.evaluate(f'() => document.querySelectorAll({json.dumps(SEL)}).length')

    def distinct_first(self, page):
        return page.evaluate(
            f'''() => {{ const seen = new Set(), out = [];
              document.querySelectorAll({json.dumps(SEL)}).forEach((b, i) => {{ const id = b.getAttribute('data-fln-clip');
                if (!seen.has(id)) {{ seen.add(id); out.push([i, id]); }} }}); return out; }}'''
        )

    def tap(self, page, idx, timeout_ms=7500):
        """One real click on button #idx; returns the measured timings (ms from the page's pointerdown)."""
        loc = page.locator(SEL).nth(idx)
        page.evaluate('() => { window.__bench = {}; window.__benchBtn = null; }')
        # warm = the clip's own element could already play (the player tags it data-fln-clip), or a fetch() had it whole
        fetched_before = page.evaluate('''() => window.__fetchedOK.slice().concat(
          (window.__benchAudios || []).filter(a => a.dataset && a.dataset.flnClip && a.readyState >= 3).map(a => a.dataset.flnClip))''')
        try:
            loc.click(timeout=5000)
        except PWError as e:
            return {'click_error': str(e).splitlines()[0][:120], 'idx': idx}
        try:
            page.wait_for_function(
                '() => { const b = window.__bench || {}; return b.tPlaying != null || b.tError != null; }', timeout=timeout_ms, polling=15
            )
        except PWTimeout:
            pass
        r = page.evaluate(
            '''() => { const b = window.__bench || {}, btn = window.__benchBtn;
              const ev = (window.__flnEvents || []).slice(b.evIdx || 0);
              const d = (t) => (t != null && b.t0 != null) ? t - b.t0 : null;
              return { clip: b.clip, state0: b.state0, state_end: btn ? btn.getAttribute('data-fln-state') : null,
                       ms_state: d(b.tState), first_state: b.firstState || null, ms_playing: d(b.tPlaying), ms_error: d(b.tError),
                       ms_ui_playing: d(b.tUiPlaying), play_err: b.playErr || null, events: ev.map(e => ({ kind: e.kind, ms: e.ms, result: e.result })) }; }'''
        )
        r['idx'] = idx
        r['fetched_before'] = None
        # warm = an audio file for this clip was already fully fetched before the tap
        return r, fetched_before

    def settle_tap(self, tapped):
        return tapped

    def stop(self, page, idx):
        """Tap again to stop a playing/loading control and wait for idle."""
        try:
            st = page.locator(SEL).nth(idx).get_attribute('data-fln-state')
            if st in ('playing', 'loading'):
                page.locator(SEL).nth(idx).click(timeout=3000)
                page.wait_for_function(
                    f'() => {{ const b = document.querySelectorAll({json.dumps(SEL)})[{idx}]; return !b || b.getAttribute("data-fln-state") === "idle"; }}',
                    timeout=2000, polling=30,
                )
        except (PWError, PWTimeout):
            pass
        page.wait_for_timeout(120)

    def ms_playing(self, t):
        """Time to first sound: the `playing` event, else the player's own audio_play.ms."""
        if t.get('ms_playing') is not None:
            return t['ms_playing'], 'playing-event'
        for e in t.get('events', []):
            if e.get('kind') == 'audio_play' and e.get('ms') is not None:
                return e['ms'], 'audio_play-event'
        return None, None

    def event_result(self, t):
        for e in t.get('events', []):
            if e.get('kind') == 'audio_play' and e.get('result'):
                return e['result']
        for e in t.get('events', []):
            if e.get('kind') == 'audio_error':
                return e.get('result') or 'audio_error'
        return None

    # -- phases -------------------------------------------------------------------------------------------------------
    def phase_warm(self, pid, out):
        """A1 (warm), A3, tap targets, A4, A5 on one warm page."""
        ctx, page = self.open(pid, throttle=self.warm_throttle)
        try:
            n = self.n_buttons(page)
            out['controls'] = n
            if n == 0:
                return
            warm_ok = self.settle_warm(page)
            clips = self.distinct_first(page)
            out['distinct_clips'] = len(clips)
            if self.a.max_clips:
                clips = clips[: self.a.max_clips]
            a1 = []
            for idx, cid in clips:
                t, fetched = self.tap(page, idx)
                ms, src = self.ms_playing(t)
                was_warm = any(cid == u or cid in u or self._clip_matches(pid, cid, u) for u in fetched)
                a1.append({'clip': cid, 'idx': idx, 'warm': was_warm, 'ms_state': t.get('ms_state'), 'ms_playing': ms, 'source': src,
                           'state_end': t.get('state_end'), 'result': self.event_result(t), 'play_err': t.get('play_err'), 'click_error': t.get('click_error')})
                self.stop(page, idx)
            out['a1'] = a1
            out['warm_settled'] = warm_ok
            # tap targets
            out['targets'] = page.evaluate(
                f'''() => Array.from(document.querySelectorAll({json.dumps(SEL)})).map(b => {{ const r = b.getBoundingClientRect();
                      const tile = !!b.closest('[data-fln-grid],[data-fln-tile]') || b.hasAttribute('data-fln-tile');
                      return {{ clip: b.getAttribute('data-fln-clip'), w: r.width, h: r.height, tile }}; }})'''
            )
            # A4 random taps with an overlap sampler
            rnd = random.Random(self.a.seed + int(re.sub(r'\D', '', pid) or 0))
            page.evaluate('() => window.__startOverlap()')
            clicks = errs = 0
            for _ in range(self.a.taps):
                i = rnd.randrange(n)
                try:
                    page.locator(SEL).nth(i).click(timeout=3000)
                    clicks += 1
                except PWError:
                    errs += 1
                page.wait_for_timeout(rnd.randint(30, 220))
            page.wait_for_timeout(300)
            ov = page.evaluate('() => window.__stopOverlap()')
            out['a4'] = {'taps': clicks, 'click_errors': errs, 'overlap_episodes': ov['episodes'], 'overlap_samples': ov['samples'], 'max_concurrent': ov['max']}
            # settle: stop whatever is left
            for idx, _ in clips[:0]:
                pass
            page.evaluate(f'() => document.querySelectorAll({json.dumps(SEL)}).forEach(b => {{ if (["playing","loading"].includes(b.getAttribute("data-fln-state"))) b.click(); }})')
            page.wait_for_timeout(300)
            # A5: 20 consecutive tap -> playing -> tap-to-stop cycles on the first control
            reached = 0
            cyc = []
            for k in range(self.a.cycles):
                t = self.tap(page, 0)[0] if True else None
                ms, _ = self.ms_playing(t) if isinstance(t, dict) else (None, None)
                ok = isinstance(t, dict) and t.get('ms_playing') is not None
                reached += 1 if ok else 0
                cyc.append(ms)
                self.stop(page, 0)
            out['a5'] = {'cycles': self.a.cycles, 'reached_playing': reached, 'ms': [r1(x) for x in cyc]}
        finally:
            out.setdefault('page_errors', getattr(page, '_errs', [])[:5])
            ctx.close()

    def _clip_matches(self, pid, cid, url):
        """clip ids are sha8 or src; map a fetched URL back to a clip through the plan's media."""
        for m in audio_media(self.plan(pid) or {}):
            if (m.get('sha8') or m['src']) == cid and url in (m['src'], m.get('orig')):
                return True
        return False

    def phase_cold(self, pid, out):
        """A2: nowarm, throttled, a fresh page per clip (also feeds A3)."""
        ctx, page = self.open(pid, nowarm=True)
        try:
            clips = self.distinct_first(page) if self.n_buttons(page) else []
        finally:
            ctx.close()
        out['cold_clips'] = len(clips)
        if self.a.max_clips:
            clips = clips[: self.a.max_clips]
        a2 = []
        for idx, cid in clips:
            ctx, page = self.open(pid, nowarm=True, throttle=self.throttle)
            try:
                t, _ = self.tap(page, idx, timeout_ms=15000)
                ms, src = self.ms_playing(t)
                a2.append({'clip': cid, 'idx': idx, 'ms_state': t.get('ms_state'), 'ms_playing': ms, 'source': src,
                           'result': self.event_result(t), 'state_end': t.get('state_end'), 'play_err': t.get('play_err')})
            finally:
                ctx.close()
        out['a2_floor'] = a2

    def phase_a2(self, pid, out):
        """A2 as a teacher meets it: the page opens on the slow line (its prefetch included), the teacher reads for
        --dwell-ms, then taps the grid in order, listening --listen-ms to each. Prefetching is what A2 asks for."""
        ctx, page = self.open(pid, throttle=self.throttle, throttle_first=True)
        rows = []
        try:
            page.wait_for_timeout(self.a.dwell_ms)
            clips = self.distinct_first(page) if self.n_buttons(page) else []
            if self.a.max_clips:
                clips = clips[: self.a.max_clips]
            for idx, cid in clips:
                t, _ = self.tap(page, idx, timeout_ms=15000)
                ms, src = self.ms_playing(t)
                rows.append({'clip': cid, 'idx': idx, 'ms_state': t.get('ms_state'), 'ms_playing': ms, 'source': src,
                             'result': self.event_result(t), 'state_end': t.get('state_end')})
                page.wait_for_timeout(self.a.listen_ms)
                self.stop(page, idx)
        finally:
            ctx.close()
        out['a2'] = rows

    def inject_routes(self, kind, pid, only_src=False, stall_ms=3000):
        """Route handlers for a failure kind on every audio URL (or only the mirror `src` URLs when only_src)."""
        plan = self.plan(pid) or {}
        srcs = {m['src'] for m in audio_media(plan)}
        origs = {m.get('orig') for m in audio_media(plan) if m.get('orig')}
        # Every audio URL when the failure is total: the plan's orig strings and the URLs the element requests differ in
        # encoding for Urdu filenames (16:10Z run: 6/18 `timeout` taps reached orig and played).
        hit = {unquote(u) for u in srcs} if only_src else None
        cors = {'access-control-allow-origin': '*'}

        def handler(route):
            url = unquote(route.request.url)
            if (hit is not None and url not in hit) or (hit is None and not AUDIO_RE.search(url)):
                return route.continue_()
            try:
                if kind == '404':
                    return route.fulfill(status=404, headers=cors, body='')
                if kind == '429':
                    return route.fulfill(status=429, headers={**cors, 'retry-after': '1'}, body='')
                if kind == 'stall':
                    # Held, never answered: sleeping here blocks the sync dispatcher, so the orig request waited behind
                    # it (16:10Z run: every switch landed at ~3 s + orig). The element drops it when it switches.
                    return None
                if kind == 'timeout':
                    return None  # never answered
                if kind == 'offline':
                    return route.abort('internetdisconnected')
            except PWError:
                return None
            return route.continue_()

        return [(AUDIO_RE, handler)]

    def pw_wait(self, ms):
        # inside a route handler the sync API may wait on the dispatcher; time.sleep would block it
        time.sleep(ms / 1000.0)

    def phase_inject(self, pid, kind, out):
        """A6: the control reaches `error` within 6.5 s for an injected 404 / timeout / offline (cold, nowarm)."""
        res = []
        clips = None
        for k in range(self.a.a6_clips):
            routes = None if kind == 'offline' else self.inject_routes(kind, pid)
            ctx, page = self.open(pid, nowarm=True, routes=routes, offline_after=(kind == 'offline'))
            try:
                if clips is None:
                    clips = self.distinct_first(page) if self.n_buttons(page) else []
                if k >= len(clips):
                    break
                idx, cid = clips[k]
                t, _ = self.tap(page, idx, timeout_ms=9000 if kind != 'timeout' else 9000)
                # wait for the error state if the first wait ended on something else
                if t.get('ms_error') is None and t.get('ms_playing') is None:
                    try:
                        page.wait_for_function('() => { const b = window.__bench || {}; return b.tError != null; }', timeout=2500, polling=30)
                        t2 = page.evaluate('() => { const b = window.__bench || {}; return b.tError != null ? b.tError - b.t0 : null; }')
                        t['ms_error'] = t2
                    except PWTimeout:
                        pass
                res.append({'clip': cid, 'ms_error': t.get('ms_error'), 'ms_playing': t.get('ms_playing'), 'state_end': t.get('state_end'),
                            'result': self.event_result(t)})
            finally:
                ctx.close()
        out.setdefault('a6', {})[kind] = res

    def bare_cold_ms(self, url):
        """Tap-to-playing for one URL in a bare <audio> element (no player), throttled like the cold tap."""
        if not url:
            return None
        ctx = self.browser.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True, user_agent=self.ua)
        try:
            page = ctx.new_page()
            page.set_content('<button id=b style="height:60px;width:200px">go</button>')
            page.evaluate("""(u) => { window.__r = {}; const a = new Audio(); a.volume = 0; a.preload = 'none'; a.src = u;
              a.addEventListener('playing', () => { window.__r.t1 = performance.now(); });
              document.getElementById('b').onclick = () => { window.__r.t0 = performance.now(); a.play().catch(e => { window.__r.err = e.name; }); }; }""", url)
            if self.throttle and self.cdp_ok:
                cdp = ctx.new_cdp_session(page)
                cdp.send('Network.enable')
                cdp.send('Network.setCacheDisabled', {'cacheDisabled': True})
                bps = self.throttle['kbps'] * 1000 / 8
                cdp.send('Network.emulateNetworkConditions', {'offline': False, 'latency': self.throttle['latency_ms'], 'downloadThroughput': bps, 'uploadThroughput': bps})
            page.click('#b')
            try:
                page.wait_for_function('() => window.__r.t1 != null || window.__r.err', timeout=20000, polling=20)
            except PWTimeout:
                return None
            r = page.evaluate('() => window.__r')
            return (r['t1'] - r['t0']) if r.get('t1') is not None else None
        finally:
            ctx.close()

    def phase_switch(self, pid, out):
        plan = self.plan(pid) or {}
        media = audio_media(plan)
        mirrored = [m for m in media if m.get('orig') and m['orig'] != m['src']]
        if not mirrored:
            out['switch'] = {'skipped': 'plan has no distinct orig URLs (run without --orig on a mirror plan)'}
            return
        sw: dict = {}
        # (a) 429 on src for the WARM fetch: expect ok-orig and normal warm timing
        ctx, page = self.open(pid, routes=self.inject_routes('429', pid, only_src=True), throttle=self.warm_throttle)
        try:
            if self.n_buttons(page):
                self.settle_warm(page)
                clips = self.distinct_first(page)[: self.a.switch_clips]
                rows = []
                for idx, cid in clips:
                    t, _ = self.tap(page, idx)
                    ms, src = self.ms_playing(t)
                    rows.append({'clip': cid, 'ms_playing': ms, 'result': self.event_result(t)})
                    self.stop(page, idx)
                sw['warm_429'] = rows
        finally:
            ctx.close()
        # (b) 3 s stall on src, cold tap, throttled: expect the switch at ~1.5 s then ok-orig
        base = {}
        ctx, page = self.open(pid, nowarm=True)
        try:
            clips = self.distinct_first(page)[: self.a.switch_clips] if self.n_buttons(page) else []
        finally:
            ctx.close()
        rows = []
        for idx, cid in clips:
            # baseline: the same original URL loaded cold in a bare <audio>, same throttle (what the switch has to pay after 1.5 s)
            base[cid] = self.bare_cold_ms(next((m['orig'] for m in mirrored if (m.get('sha8') or m['src']) == cid), None))
            ctx, page = self.open(pid, nowarm=True, routes=self.inject_routes('stall', pid, only_src=True, stall_ms=3000), throttle=self.throttle)
            try:
                t, _ = self.tap(page, idx, timeout_ms=15000)
                ms, src = self.ms_playing(t)
                rows.append({'clip': cid, 'ms_playing': ms, 'result': self.event_result(t), 'orig_cold_baseline_ms': base[cid]})
            finally:
                ctx.close()
        sw['stall_3s'] = rows
        out['switch'] = sw

    # -- run
    def run(self):
        want = set(self.a.only.split(',')) if self.a.only else {'warm', 'a2', 'cold', 'a6', 'switch'}
        res: dict = {'plans': {}}
        for pid in self.a.plans.split(','):
            pid = pid.strip()
            if not pid:
                continue
            out: dict = {}
            res['plans'][pid] = out
            if self.plan(pid) is None and '{plan}' not in self.a.url and 'localhost' in self.a.url:
                out['error'] = f'plan json {pid} not found in {self.plans_dir}'
                continue
            steps = []
            if 'warm' in want:
                steps.append(('warm', lambda: self.phase_warm(pid, out)))
            if 'a2' in want:
                steps.append(('a2', lambda: self.phase_a2(pid, out)))
            if 'cold' in want:
                steps.append(('cold', lambda: self.phase_cold(pid, out)))
            if 'a6' in want:
                for kind in [k for k in self.a.inject.split(',') if k in ('404', 'offline', 'timeout')]:
                    steps.append((f'a6-{kind}', lambda kind=kind: self.phase_inject(pid, kind, out)))
            if 'switch' in want and ('429' in self.a.inject or 'stall3s' in self.a.inject):
                steps.append(('switch', lambda: self.phase_switch(pid, out)))
            for name, fn in steps:
                t0 = time.time()
                try:
                    fn()
                except Exception as e:  # keep going: a failed phase is a FAIL row, not a crashed bench
                    out.setdefault('errors', []).append(f'{name}: {type(e).__name__}: {str(e).splitlines()[0][:200]}')
                print(f'  plan {pid} {name:<10} {time.time() - t0:5.1f}s', flush=True)
        res['diag'] = self.diag
        return res

    def close(self):
        try:
            self.browser.close()
        except PWError:
            pass


# ----------------------------------------------------------------------------------------------------------------------
# burst test (mirror 429 rate)
# ----------------------------------------------------------------------------------------------------------------------
def run_burst(args, bench_dir_plans: pathlib.Path):
    mirror_dir = pathlib.Path(args.plans_dir)
    plans = []
    for f in sorted(mirror_dir.glob('*.json')):
        try:
            d = json.loads(f.read_text())
        except (OSError, ValueError):
            continue
        urls = []
        seen = set()
        for m in audio_media(d):
            if m['src'] not in seen:
                seen.add(m['src'])
                urls.append(m['src'])
        if len(urls) >= args.burst_min_clips:
            plans.append((f.stem, urls))
    out: dict = {'plans_with_audio': len(plans)}
    if not plans:
        out['skipped'] = 'no mirror plans with audio found'
        return out
    live = read_env_key('CONTENT_R2_PUBLIC_URL', pathlib.Path(__file__).resolve().parent)
    live_host = re.sub(r'^https?://', '', live).split('/')[0] if live else None

    def rewrite(u):
        if live_host:
            return re.sub(r'^(https?://)[^/]+', lambda m: m.group(1) + live_host, u)
        return u

    rnd = random.Random(args.seed)
    chosen = rnd.sample(plans, min(args.burst_plans, len(plans)))
    reqs = []
    for pid, urls in chosen:
        for i in range(args.burst_clips):
            reqs.append((pid, rewrite(urls[i % len(urls)])))
    out.update({'plans': [p for p, _ in chosen], 'requests': len(reqs), 'concurrency': args.burst_conc, 'host_rewritten_to_live': bool(live_host),
                'distinct_urls': len({u for _, u in reqs})})
    # gate: the mirror must answer
    probe = reqs[0][1]
    try:
        rq = urllib.request.Request(probe, method='HEAD', headers={'User-Agent': UA['iab-android']})
        with urllib.request.urlopen(rq, timeout=20) as r:
            probe_status = r.status
    except urllib.error.HTTPError as e:
        probe_status = e.code
    except Exception as e:  # noqa: BLE001
        probe_status = f'err:{type(e).__name__}'
    out['probe_status'] = probe_status
    if probe_status != 200:
        out['skipped'] = f'mirror HEAD answered {probe_status}, not 200 (still uploading?)'
        return out

    def get(item):
        pid, u = item
        t0 = time.time()
        try:
            rq = urllib.request.Request(u, headers={'User-Agent': UA['iab-android']})
            with urllib.request.urlopen(rq, timeout=40) as r:
                r.read()
                return (r.status, time.time() - t0)
        except urllib.error.HTTPError as e:
            return (e.code, time.time() - t0)
        except Exception as e:  # noqa: BLE001
            return (f'err:{type(e).__name__}', time.time() - t0)

    t0 = time.time()
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.burst_conc) as ex:
        results = list(ex.map(get, reqs))
    out['seconds'] = round(time.time() - t0, 1)
    hist: dict = {}
    for s, _ in results:
        hist[str(s)] = hist.get(str(s), 0) + 1
    out['status_histogram'] = hist
    n = len(results)
    out['rate_429_pct'] = round(100.0 * hist.get('429', 0) / n, 2)
    out['rate_non200_pct'] = round(100.0 * (n - hist.get('200', 0)) / n, 2)
    lat = sorted(x for _, x in results)
    out['latency_s_p50'] = round(lat[len(lat) // 2], 2)
    out['latency_s_p95'] = round(lat[max(0, math.ceil(0.95 * len(lat)) - 1)], 2)
    return out


# ----------------------------------------------------------------------------------------------------------------------
# verdicts + report
# ----------------------------------------------------------------------------------------------------------------------
def summarise(args, res, burst):
    plans = res['plans']
    rows = []

    def collect(key, field=None):
        xs = []
        for p in plans.values():
            for r in p.get(key, []) or []:
                xs.append(r)
        return xs

    a1_all = collect('a1')
    a1_warm = [r['ms_playing'] for r in a1_all if r.get('warm') and r.get('ms_playing') is not None]
    a1_any = [r['ms_playing'] for r in a1_all if r.get('ms_playing') is not None]
    a2 = [r['ms_playing'] for r in collect('a2') if r.get('ms_playing') is not None]
    a2_n = len(collect('a2'))
    a2_orig = sum(1 for r in collect('a2') if r.get('result') == 'ok-orig')
    fl_rows = collect('a2_floor')
    fl = [r['ms_playing'] for r in fl_rows if r.get('ms_playing') is not None]
    fl_orig = sum(1 for r in fl_rows if r.get('result') == 'ok-orig')
    a3 = [r['ms_state'] for r in a1_all + collect('a2') + fl_rows if r.get('ms_state') is not None]
    a3_n = len(a1_all) + a2_n + len(fl_rows)
    cdp = args.engine == 'chromium'

    def verdict(ok):
        return 'PASS' if ok else 'FAIL'

    def row(rid, name, bar, value, v, note=''):
        rows.append({'id': rid, 'criterion': name, 'bar': bar, 'value': value, 'verdict': v, 'note': note})

    # A1
    if a1_warm:
        p = p95(a1_warm)
        row('A1', 'warm tap to first sound', f'p95 <= {BAR["A1"]} ms', f'p95 {r1(p)} ms (n={len(a1_warm)} warm of {len(a1_any)} tapped; all-taps p95 {r1(p95(a1_any))})',
            verdict(p <= BAR['A1']), 'throttle: ' + (args.warm_throttle if cdp else 'none (no CDP on WebKit)'))
    elif a1_any:
        p = p95(a1_any)
        row('A1', 'warm tap to first sound', f'p95 <= {BAR["A1"]} ms', f'p95 {r1(p)} ms over {len(a1_any)} taps, but NO clip was fetched before its tap (warm never ran)', 'FAIL')
    else:
        row('A1', 'warm tap to first sound', f'p95 <= {BAR["A1"]} ms', 'no tap produced a `playing` event', 'FAIL')
    # A2
    a2_name = f'tap on a slow line, page prefetching (opened throttled, {args.dwell_ms} ms reading, grid in order)'
    if a2:
        p = p95(a2)
        row('A2', a2_name, f'p95 <= {BAR["A2"]} ms', f'p95 {r1(p)} ms (n={len(a2)}/{a2_n}, median {r1(statistics.median(a2))}, max {r1(max(a2))}; {a2_orig} played from orig)',
            verdict(p <= BAR['A2'] and cdp), (f'throttle {args.throttle} from page load' if cdp else 'WebKit: unthrottled, not a valid A2 reading'))
    elif a2_n:
        row('A2', a2_name, f'p95 <= {BAR["A2"]} ms', f'no tap reached playing (0/{a2_n})', 'FAIL', f'throttle {args.throttle}')
    if fl:
        row('A2-floor', 'truly cold tap: fresh page, NO prefetch, throttled (what the line itself costs)', 'info (no bar)',
            f'p95 {r1(p95(fl))} ms (n={len(fl)}/{len(fl_rows)}, median {r1(statistics.median(fl))}; {fl_orig} switched to orig)', 'INFO',
            f'throttle {args.throttle}')
    # A3
    if a3:
        p = p95(a3)
        row('A3', 'visible state change per tap', f'p95 <= {BAR["A3"]} ms', f'p95 {r1(p)} ms (n={len(a3)}/{a3_n} taps changed state)', verdict(p <= BAR['A3'] and len(a3) == a3_n))
    else:
        row('A3', 'visible state change per tap', f'p95 <= {BAR["A3"]} ms', f'no tap changed data-fln-state (0/{a3_n})', 'FAIL')
    # A4
    a4 = [p.get('a4') for p in plans.values() if p.get('a4')]
    if a4:
        tot = sum(x['overlap_episodes'] for x in a4)
        row('A4', 'one sound at a time', '0 overlaps / 50 random taps / plan', f'{tot} overlap episodes ({sum(x["taps"] for x in a4)} taps over {len(a4)} plans; max concurrent {max(x["max_concurrent"] for x in a4)})',
            verdict(tot == 0 and sum(x["taps"] for x in a4) > 0))
    else:
        row('A4', 'one sound at a time', '0 overlaps', 'not run / no controls', 'FAIL')
    # A5
    a5 = [p.get('a5') for p in plans.values() if p.get('a5')]
    if a5:
        worst = min(x['reached_playing'] for x in a5)
        row('A5', 'repeat works', '20/20 cycles reach playing', ' / '.join(f'{x["reached_playing"]}/{x["cycles"]}' for x in a5) + ' per plan', verdict(all(x['reached_playing'] == x['cycles'] for x in a5)))
    else:
        row('A5', 'repeat works', '20/20', 'not run / no controls', 'FAIL')
    # A6
    a6 = {}
    for p in plans.values():
        for k, lst in (p.get('a6') or {}).items():
            a6.setdefault(k, []).extend(lst)
    if a6:
        parts, ok_all, tot, okn = [], True, 0, 0
        for k, lst in a6.items():
            good = [r for r in lst if r.get('ms_error') is not None and r['ms_error'] <= BAR['A6_ms'] and r.get('ms_playing') is None]
            tot += len(lst)
            okn += len(good)
            mx = max((r['ms_error'] for r in lst if r.get('ms_error') is not None), default=None)
            parts.append(f'{k} {len(good)}/{len(lst)} (max {r1(mx)} ms)')
            ok_all = ok_all and len(good) == len(lst) and len(lst) > 0
        row('A6', 'failure shows the retry state', '100% reach error <= 6.5 s', '; '.join(parts), verdict(ok_all))
    else:
        row('A6', 'failure shows the retry state', '100%', 'not run', 'FAIL')
    # switch path
    sws = [p.get('switch') for p in plans.values() if p.get('switch')]
    sws_real = [s for s in sws if 'skipped' not in s]
    if sws_real:
        w = [r for s in sws_real for r in s.get('warm_429', [])]
        st = [r for s in sws_real for r in s.get('stall_3s', [])]
        w_ok = bool(w) and all(r['result'] == 'ok-orig' for r in w) and (p95([r['ms_playing'] for r in w if r['ms_playing'] is not None]) or 1e9) <= BAR['A1']
        st_ok = bool(st)
        notes = []
        for r in st:
            exp = args.first_byte_ms + (r['orig_cold_baseline_ms'] or 0)
            good = r['result'] == 'ok-orig' and r['ms_playing'] is not None and args.first_byte_ms - 200 <= r['ms_playing'] <= exp + 1200
            st_ok = st_ok and good
            notes.append(f'{r["ms_playing"] and round(r["ms_playing"])} ms vs expected ~{round(exp)}')
        fbs = f'{args.first_byte_ms / 1000:g} s'
        row('Switch', f'429 on src (warm) then ok-orig; src never answers (cold) then switch at ~{fbs}',
            f'ok-orig; warm p95 <= 150 ms; stall ms ~ {fbs} + orig cold',
            f'429-warm: {sum(1 for r in w if r["result"] == "ok-orig")}/{len(w)} ok-orig, p95 {r1(p95([r["ms_playing"] for r in w if r["ms_playing"] is not None]))} ms; stall: '
            f'{sum(1 for r in st if r["result"] == "ok-orig")}/{len(st)} ok-orig [{"; ".join(notes[:6])}]', verdict(w_ok and st_ok), 'stall throttle ' + (args.throttle if cdp else 'none'))
    elif sws:
        row('Switch', 'src to orig switch path', 'ok-orig', sws[0]['skipped'], 'N/A')
    else:
        row('Switch', 'src to orig switch path', 'ok-orig', 'not run', 'FAIL')
    # tap targets
    tg = [t for p in plans.values() for t in (p.get('targets') or [])]
    if tg:
        tiles = [t for t in tg if t['tile']]
        pills = [t for t in tg if not t['tile']]
        def box(ts):
            if not ts:
                return 'none measured'
            return f'n={len(ts)} min box {r1(min(t["w"] for t in ts))} x {r1(min(t["h"] for t in ts))} px (min w x min h)'

        pmin = min((t['h'] for t in pills), default=None)
        tmin = min((min(t['w'], t['h']) for t in tiles), default=None)
        ok = (pmin is None or pmin >= BAR['pill_h'] - 0.01) and (tmin is None or tmin >= BAR['tile'] - 0.01) and bool(pills and tiles)
        row('Targets', 'tap targets at 390x844', 'pill h >= 48, tile >= 56x56',
            f'pills {box(pills)}; tiles {box(tiles)}', verdict(ok),
            '' if tiles else 'no control sits inside [data-fln-grid]/[data-fln-tile]: all measured as pills')
    else:
        row('Targets', 'tap targets', 'pill h >= 48, tile >= 56', 'no controls rendered', 'FAIL')
    # burst
    if burst is None:
        row('Burst', 'mirror 429 rate', f'<= {BAR["rate429_pct"]} %', 'not run (--burst)', 'N/A')
    elif 'skipped' in burst:
        row('Burst', 'mirror 429 rate', f'<= {BAR["rate429_pct"]} %', 'skipped: ' + burst['skipped'], 'N/A')
    else:
        row('Burst', 'mirror 429 rate', f'<= {BAR["rate429_pct"]} %',
            f'429 rate {burst["rate_429_pct"]} % of {burst["requests"]} GETs (conc {burst["concurrency"]}), histogram {burst["status_histogram"]}, non-200 {burst["rate_non200_pct"]} %',
            verdict(burst['rate_429_pct'] <= BAR['rate429_pct']))
    return rows


def to_markdown(args, rows, res, burst):
    when = dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d %H:%MZ')
    L = [f'# FLN audio bench ({when})', '',
         f'engine `{args.engine}` | UA `{args.ua}` | cold throttle `{args.throttle if args.engine == "chromium" else "none (WebKit has no CDP)"}` | '
         f'warm throttle `{args.warm_throttle if args.engine == "chromium" else "none"}` | plans `{args.plans}` | url `{args.url}`', '',
         '| Row | Criterion | Bar | Value | Verdict |', '|---|---|---|---|---|']
    for r in rows:
        note = f' ({r["note"]})' if r['note'] else ''
        L.append(f'| {r["id"]} | {r["criterion"]} | {r["bar"]} | {r["value"]}{note} | **{r["verdict"]}** |')
    L += ['', '## Per plan']
    for pid, p in res['plans'].items():
        L.append(f'- `{pid}`: controls {p.get("controls")}, distinct clips {p.get("distinct_clips")}, cold clips {p.get("cold_clips")}'
                 + (f', errors {p["errors"]}' if p.get('errors') else '') + (f', page errors {p["page_errors"]}' if p.get('page_errors') else '') + (f', {p["error"]}' if p.get('error') else ''))
    if res.get('diag'):
        L += ['', '## Diagnostics'] + [f'- {d}' for d in res['diag']]
    if burst and 'skipped' not in burst:
        L += ['', '## Burst', f'- plans {len(burst["plans"])}, {burst["requests"]} requests, {burst["distinct_urls"]} distinct URLs, {burst["seconds"]} s, latency p50/p95 {burst["latency_s_p50"]}/{burst["latency_s_p95"]} s']
    return '\n'.join(L) + '\n'


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--url', default=DEFAULT_URL, help='bench page URL; may contain {plan}, else ?plan=<id> is appended')
    ap.add_argument('--plans', default='11156,11133,10152')
    ap.add_argument('--throttle', default='400k/300ms', help='cold-tap / stall throttle, e.g. 400k/300ms or none')
    ap.add_argument('--warm-throttle', default='none', help='throttle while the warm phase runs (A1/A4/A5); default none')
    ap.add_argument('--ua', choices=sorted(UA), default='iab-android')
    ap.add_argument('--engine', choices=['chromium', 'webkit'], default='chromium')
    ap.add_argument('--inject', default='404,offline,timeout,429,stall3s', help='any of 404,offline,timeout (A6) and 429,stall3s (switch path)')
    ap.add_argument('--only', default='', help='comma list of phases: warm,a2,cold,a6,switch (default all)')
    ap.add_argument('--burst', action='store_true')
    ap.add_argument('--out', default='bench.json')
    ap.add_argument('--md', default='bench.md')
    ap.add_argument('--orig', action='store_true', help='feed the original-URL plans instead of the mirror plans')
    ap.add_argument('--plans-dir', default=os.environ.get('FLN_PLANS_DIR', ''), help='mirror plan JSONs (env FLN_PLANS_DIR)')
    ap.add_argument('--orig-plans-dir', default=os.environ.get('FLN_PLANS_ORIG_DIR', ''), help='original-URL plan JSONs (env FLN_PLANS_ORIG_DIR)')
    ap.add_argument('--max-clips', type=int, default=0, help='cap A1/A2 clips per plan (0 = all)')
    ap.add_argument('--first-byte-ms', type=int, default=2500, help="the player's cold-tap switch deadline (FlnPlayer firstByteMs)")
    ap.add_argument('--dwell-ms', type=int, default=3000, help='A2: reading time between the page opening and the first tap')
    ap.add_argument('--listen-ms', type=int, default=1500, help='A2: listening time after each tap reaches playing')
    ap.add_argument('--taps', type=int, default=50)
    ap.add_argument('--cycles', type=int, default=20)
    ap.add_argument('--a6-clips', type=int, default=3)
    ap.add_argument('--switch-clips', type=int, default=3)
    ap.add_argument('--seed', type=int, default=7)
    ap.add_argument('--ready-timeout', type=int, default=60)
    ap.add_argument('--burst-plans', type=int, default=20)
    ap.add_argument('--burst-clips', type=int, default=30)
    ap.add_argument('--burst-conc', type=int, default=200)
    ap.add_argument('--burst-min-clips', type=int, default=8)
    args = ap.parse_args(argv)

    if not (args.orig_plans_dir if args.orig else args.plans_dir) and 'localhost' in args.url:
        raise SystemExit('plans dir missing: pass --plans-dir (or set FLN_PLANS_DIR)')
    print(f'bench: engine={args.engine} ua={args.ua} throttle={args.throttle} plans={args.plans}', flush=True)
    with sync_playwright() as pw:
        b = Bench(args, pw)
        try:
            res = b.run()
        finally:
            b.close()
    burst = None
    if args.burst:
        print('burst ...', flush=True)
        burst = run_burst(args, pathlib.Path(args.plans_dir))
        res['burst'] = burst
    rows = summarise(args, res, burst)
    res['table'] = rows
    res['meta'] = {'engine': args.engine, 'ua': args.ua, 'throttle': args.throttle, 'warm_throttle': args.warm_throttle, 'plans': args.plans, 'url': args.url,
                   'cdp_throttle_applied': args.engine == 'chromium', 'when': dt.datetime.now(dt.timezone.utc).isoformat()}
    pathlib.Path(args.out).write_text(json.dumps(res, indent=1, ensure_ascii=False))
    md = to_markdown(args, rows, res, burst)
    pathlib.Path(args.md).write_text(md)
    print(md)
    return 0


if __name__ == '__main__':
    sys.exit(main())
