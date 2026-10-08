/*
 * Web quiz page telemetry: how long a page is open and what is on screen, in order.
 *
 * Loaded first on every web quiz page (quiz, hub, library, challenge). Does nothing at all unless the boot JSON
 * says rt === true (app_settings web_quiz_rich_telemetry): no listener, no timer, no request.
 *
 * Each page load gets a random page-session id `ps` (12 characters, no meaning) and every event a sequence
 * number `pseq` and the ms since load `sm`, so the server log can be put back in order and a lost batch shows
 * as a gap. The screen on show is read from the page's own `data-m` / `data-screen` marker, so a new screen is
 * captured without touching the page script. Ids only: never a name, a typed text or an answer's text. The
 * session token and the device ref ride the batch (never an event) so the server can log its own ids for them.
 *
 *   screen_enter {scr, from}            a new screen is on show
 *   screen_leave {scr, ms, vis_ms}      it went away: how long it was on, and how much of that was visible
 *   vis {state, ms}                     the page was hidden/shown: how long the previous state lasted
 *   hb {ms, vis_ms}                     every 30 s while visible, only if nothing else was sent; 20 at most
 *   page_start {page, pps, ua}          this page load began (pps: the page before it in this tab)
 *   page_end {total_ms, vis_ms, scr, count} the page is going away (sent once, by beacon)
 *
 * window.WQT.push(e) lets a page script send its own event through this queue (same ps/pseq); it returns
 * false when telemetry is off, and the page then sends it the way it always has.
 */
(function () {
  'use strict';
  var W = window.WQT = { on: false, push: function () { return false; }, screen: function () {} };
  var B;
  try { B = JSON.parse(document.getElementById('boot').textContent) || {}; } catch (e) { return; }
  if (!B || B.rt !== true) return;

  var ROOT = document.getElementById('wq');
  var PAGE = B.view === 'hub' ? 'hub' : B.view === 'lib' ? 'lib' : (B.menu || B.token) && !B.quiz ? 'ch' : 'quiz';
  var CODE = B.code || (B.quiz && B.quiz.code) || undefined;
  var LANG = B.lang || (B.quiz && B.quiz.lang) || (B.menu && B.menu.lang) || undefined;
  var FLUSH_N = 20, FLUSH_MS = 15000, HB_MS = 30000, HB_MAX = 20;

  function now() { try { return performance.now(); } catch (e) { return Date.now(); } }
  var T0 = now();
  function rid() {
    var a = 'abcdefghijklmnopqrstuvwxyz0123456789', s = '', b = null, i;
    try { b = new Uint8Array(12); crypto.getRandomValues(b); } catch (e) { b = null; }
    for (i = 0; i < 12; i += 1) s += a.charAt((b ? b[i] : Math.floor(Math.random() * 256)) % 36);
    return s;
  }
  var PS = rid();
  var PPS;
  try { PPS = sessionStorage.getItem('wq_ps') || undefined; sessionStorage.setItem('wq_ps', PS); } catch (e) { PPS = undefined; }

  // The ids the server turns into its own (it logs neither): this quiz's session token and this phone's device ref.
  function read(k) { try { return JSON.parse(localStorage.getItem(k) || 'null'); } catch (e) { return null; } }
  function ids() {
    var o = {}, s = CODE ? read('wq_s_' + CODE) : null, d = read('wq_d');
    if (s && typeof s.st === 'string') o.st = s.st;
    if (typeof d === 'string') o.dr = d;
    return o;
  }

  var q = [], seq = 0, sent = 0, lastSend = 0, hbs = 0, ended = false;
  function push(e) {
    if (ended) return true;
    e.t = e.t || Date.now();
    if (CODE && e.code === undefined) e.code = CODE;
    if (LANG && e.lang === undefined) e.lang = LANG;
    seq += 1;
    e.ps = PS; e.pseq = seq; e.sm = Math.round(now() - T0);
    q.push(e);
    lastSend = now();
    if (q.length >= FLUSH_N) flush(false);
    return true;
  }
  function flush(beacon) {
    while (q.length) {
      var batch = q.splice(0, FLUSH_N);
      sent += batch.length;
      var body = { events: batch, ps: PS }, x = ids(), k;
      for (k in x) body[k] = x[k];
      body = JSON.stringify(body);
      var done = false;
      try { if (beacon && navigator.sendBeacon) done = navigator.sendBeacon('/api/wq/e', new Blob([body], { type: 'application/json' })); } catch (e) { done = false; }
      if (!done) { try { fetch('/api/wq/e', { method: 'POST', headers: { 'content-type': 'application/json' }, body: body, keepalive: true }).catch(function () {}); } catch (e) {} }
    }
  }

  // Visible time: the sum of the visible spans so far.
  var visible = document.visibilityState !== 'hidden', visAcc = 0, since = now();
  function visMs() { return Math.round(visAcc + (visible ? now() - since : 0)); }

  // Which screen is on show: the page's own marker, named.
  var NAMES = { M3: 'landing', M4: 'who', M5: 'video', M6: 'question', M7: 'feedback', M9: 'results', M10: 'card', M11: 'board',
    M12: 'share', M13: 'history', M14: 'today', M15: 'library', M16: 'schools' };
  // The hub page's moments, by number: no children here, pick a child, the hub itself.
  var HUB = ['hub_empty', 'hub_pick', 'hub'];
  function nameOf(m, chScreen) {
    if (chScreen) return ('ch_' + String(chScreen).toLowerCase().replace(/[^a-z0-9]+/g, '_')).slice(0, 24);
    if (!m) return null;
    var p = String(m).split('-'), hub = /^H(\d)$/.exec(p[0]), base = NAMES[p[0]] || (hub && HUB[+hub[1]]) || p[0].toLowerCase();
    return (base + (p.length > 1 ? '_' + p.slice(1).join('_') : '')).toLowerCase().replace(/[^a-z0-9_]+/g, '_').slice(0, 24);
  }
  function current() {
    var sec = null;
    try { sec = ROOT && ROOT.querySelector('.wq-screen'); } catch (e) { sec = null; }
    var ch = sec && sec.getAttribute && sec.getAttribute('data-screen');
    var m = (ROOT && ROOT.getAttribute && ROOT.getAttribute('data-m')) || (sec && sec.getAttribute && sec.getAttribute('data-m'));
    return { name: nameOf(ch ? null : m, ch), sec: sec };
  }
  var scr = null, scrSec = null, scrAt = 0, scrVis = 0;
  function leave() {
    if (!scr) return;
    push({ n: 'screen_leave', scr: scr, ms: Math.round(now() - scrAt), vis_ms: visMs() - scrVis });
    scr = null;
  }
  function check() {
    var c = current();
    if (!c.name) return;
    // The same screen painted again counts once, except a new question (a fresh section for the next one).
    if (c.name === scr && (c.sec === scrSec || c.name !== 'question')) return;
    var from = scr;
    leave();
    scr = c.name; scrSec = c.sec; scrAt = now(); scrVis = visMs();
    push({ n: 'screen_enter', scr: scr, from: from || undefined });
  }
  var pending = false;
  function soon() { if (pending) return; pending = true; setTimeout(function () { pending = false; check(); }, 0); }

  W.on = true;
  W.push = push;
  W.screen = function () { check(); };
  push({ n: 'page_start', page: PAGE, pps: PPS, ua: String(navigator.userAgent || '').slice(0, 300) });
  try { if (ROOT && window.MutationObserver) new MutationObserver(soon).observe(ROOT, { attributes: true, attributeFilter: ['data-m', 'data-screen'], childList: true, subtree: true }); } catch (e) {}
  check();

  document.addEventListener('visibilitychange', function () {
    var hidden = document.visibilityState === 'hidden';
    if (hidden === !visible) return;
    var t = now(), ms = Math.round(t - since);
    if (hidden) visAcc += t - since;
    visible = !hidden; since = t;
    push({ n: 'vis', state: hidden ? 'hidden' : 'visible', ms: ms });
    if (hidden) flush(true);
  });
  setInterval(function () {
    if (ended || !visible || hbs >= HB_MAX || now() - lastSend < HB_MS) return;
    hbs += 1;
    push({ n: 'hb', ms: Math.round(now() - T0), vis_ms: visMs() });
  }, HB_MS);
  setInterval(function () { flush(false); }, FLUSH_MS);
  function end() {
    if (ended) return;
    var last = scr || undefined;
    leave();
    push({ n: 'page_end', total_ms: Math.round(now() - T0), vis_ms: visMs(), scr: last, count: seq + 1 });
    ended = true;
    flush(true);
  }
  window.addEventListener('pagehide', end);
  // A frozen page (Page Lifecycle) may never come back: send what is queued.
  document.addEventListener('freeze', function () { flush(true); });
})();
