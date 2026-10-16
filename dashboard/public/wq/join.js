/* The join screen (/quiz/join/<token>; quiz_student_join): grade chips, a first name, "Let's go!" → the child's home.
 * The grade tap tells the server at once and warms the home's long-cached files, so the home paints from cache.
 * The page keeps nothing that decides who the child is: the server answers every step. ES5, no dependencies. */
(function () {
  'use strict';
  var boot = {};
  try { boot = JSON.parse(document.getElementById('boot').textContent || '{}'); } catch (e) { boot = {}; }
  var C = boot.copy || {};
  var grade = null;
  var busy = false;
  var warmed = false;
  var nameEl = document.getElementById('jn-name');
  var goEl = document.getElementById('jn-go');
  var outEl = document.getElementById('jn-out');

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  // This phone's device_ref, under the same key and cookie the hub keeps it (hub.js deviceRef): one phone to the server.
  function keepCookie(d) {
    try { document.cookie = 'wq_dv=' + d + '; path=/; max-age=2592000; samesite=lax' + (location.protocol === 'https:' ? '; secure' : ''); } catch (e) {}
    return d;
  }
  function deviceRef() {
    var d = null;
    try { d = JSON.parse(localStorage.getItem('wq_d') || 'null'); } catch (e) { d = null; }
    if (typeof d === 'string' && /^[A-Za-z0-9_-]{22}$/.test(d)) return keepCookie(d);
    try { var m = /(?:^|;\s*)wq_dv=([A-Za-z0-9_-]{22})(?:;|$)/.exec(document.cookie || ''); if (m) { try { localStorage.setItem('wq_d', JSON.stringify(m[1])); } catch (e) {} return keepCookie(m[1]); } } catch (e) {}
    var ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    var bytes = [];
    try { var a = new Uint8Array(22); window.crypto.getRandomValues(a); bytes = Array.prototype.slice.call(a); } catch (e) { bytes = []; }
    d = '';
    for (var i = 0; i < 22; i++) d += ABC.charAt((bytes.length ? bytes[i] : Math.floor(Math.random() * 256)) & 63);
    try { localStorage.setItem('wq_d', JSON.stringify(d)); } catch (e) {}
    return keepCookie(d);
  }
  var device = deviceRef();

  function post(path, body, done) {
    var x = new XMLHttpRequest();
    x.open('POST', path, true);
    x.setRequestHeader('content-type', 'application/json');
    x.timeout = 15000;
    x.onload = function () { var b = null; try { b = JSON.parse(x.responseText || '{}'); } catch (e) { b = null; } done(x.status, b || {}); };
    x.onerror = x.ontimeout = function () { done(0, {}); };
    body.device_ref = device;
    x.send(JSON.stringify(body));
  }

  function say(html) { outEl.innerHTML = html; }
  function line(text) { say('<p class="line">' + esc(text) + '</p>'); }
  function name() { return String(nameEl.value || '').replace(/\s+/g, ' ').trim(); }
  function okName(n) { return n.length >= 1 && n.length <= 20 && !/[0-9٠-٩۰-۹]/.test(n); }
  function sync() { goEl.disabled = busy || !grade || !okName(name()); }
  function go(url) { try { location.replace(url); } catch (e) { location.href = url; } }

  // The home's files, fetched at low priority while the child types (cancelled by the browser if the page leaves).
  function warm(list) {
    if (warmed) return;
    warmed = true;
    (list || boot.warm || []).forEach(function (p) {
      if (typeof p !== 'string' || p.charAt(0) !== '/') return;
      var l = document.createElement('link');
      l.rel = 'prefetch';
      l.href = p + (boot.v ? '?v=' + encodeURIComponent(boot.v) : '');
      document.head.appendChild(l);
    });
  }

  function answer(status, b) {
    busy = false;
    if (b.next && typeof b.next === 'string' && b.next.charAt(0) === '/') {
      if (b.refused === 'max_kids') return say('<p class="line">' + esc(C.full) + '</p><a class="go" style="line-height:60px;text-align:center;text-decoration:none" href="' + esc(b.next) + '">' + esc(C.open) + '</a>');
      if (b.refused === 'teacher_phone') { line(C.teacher); return setTimeout(function () { go(b.next); }, 1800); }
      if (b.refused) { line(C.error); return sync(); }
      return go(b.next);
    }
    if (b.ask === 'is_this_you' && b.kids && b.kids.length) {
      var k = b.kids[0];
      var first = String(k.first || '');
      return say('<p class="line">' + esc(String(C.isYou || '').replace('{n}', first)) + '</p>' +
        '<button type="button" class="pick" data-tap="same" data-chip="' + esc(k.chip) + '">' + esc(C.yesMe) + '</button>' +
        '<button type="button" class="pick" data-tap="new">' + esc(String(C.diff || '').replace('{n}', first)) + '</button>');
    }
    if (b.off) return say('<p class="line">' + esc(C.off) + '</p><p class="small">' + esc(C.offNone) + '</p>');
    if (b.stale) { goEl.disabled = true; return line(C.stale); }
    line(C.error);
    sync();
  }

  function send(extra) {
    if (busy) return;
    busy = true;
    sync();
    say('<p class="small">' + esc(C.wait) + '</p>');
    var body = { t: boot.t, grade: grade, name: name() };
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) body[k] = extra[k];
    post('/api/wq/join', body, answer);
  }

  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-tap]') : null;
    if (!el) return;
    var tap = el.getAttribute('data-tap');
    if (tap === 'grade') {
      grade = Number(el.getAttribute('data-grade'));
      var all = document.querySelectorAll('.chip');
      for (var i = 0; i < all.length; i++) all[i].setAttribute('aria-pressed', all[i] === el ? 'true' : 'false');
      warm();
      post('/api/wq/join/grade', { t: boot.t, grade: grade }, function (s, b) {
        if (b && b.prefetch) warm(b.prefetch);
        if (b && b.stale) answer(s, b);
        if (b && b.off) answer(s, b);
      });
      sync();
      if (!name()) try { nameEl.focus(); } catch (er) {}
    } else if (tap === 'go') {
      if (!goEl.disabled) send(null);
    } else if (tap === 'same') {
      send({ same: el.getAttribute('data-chip') });
    } else if (tap === 'new') {
      send({ force: true });
    }
  });
  nameEl.addEventListener('input', sync);
  nameEl.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !goEl.disabled) send(null); });
  sync();
})();
