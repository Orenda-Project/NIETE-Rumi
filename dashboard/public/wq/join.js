/* The join screen (/quiz/join/<token>; quiz_student_join): grade chips, a first name, the saving notice (filled with
 * the name as it is typed, shown before "Let's go!" can be tapped), then the child's home. Practice: the grade only.
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
  var practice = boot.practice === true;
  var nameEl = document.getElementById('jn-name');
  var noticeEl = document.getElementById('jn-notice');
  var goEl = document.getElementById('jn-go');
  var outEl = document.getElementById('jn-out');
  if (!goEl || !outEl) return;   // not the join screen (the file is public): nothing to do
  // quiz_join_wait_word: the button says the waiting line while the join runs (off: today's button)
  var going = boot.waitWord === true && typeof C.going === 'string' && C.going ? C.going : null;
  var goText = goEl.textContent;
  // the home's own animals (hub.js ANIMALS): two children with one name are told apart by the animal they know
  var ANIMALS = { cat: '🐱', dog: '🐶', rabbit: '🐰', parrot: '🦜', fish: '🐟', turtle: '🐢', lion: '🦁', elephant: '🐘', owl: '🦉', butterfly: '🦋', bee: '🐝', horse: '🐴' };

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
  // A dead end (the link expired, joining is off): ONE tap back to the bot, when the page knows its number.
  function backTap() {
    var b = typeof boot.bot === 'string' && /^\d{10,15}$/.test(boot.bot) ? boot.bot : null;
    return b ? '<a class="go" href="https://wa.me/' + b + '?text=quiz">' + esc(C.openWa) + '</a>' : '';
  }
  function name() { return nameEl ? String(nameEl.value || '').replace(/\s+/g, ' ').trim() : ''; }
  // The server's rule (cleanFirstName / NAME_RX): letters of any script, a space, an apostrophe or a hyphen; ≤ 20
  // characters, ≤ 2 words. A browser without Unicode classes in RegExp keeps the old check; the server still decides.
  var NAME_RX = null;
  try { NAME_RX = new RegExp("^[\\p{L}\\p{M}' -]+$", 'u'); } catch (e) { NAME_RX = null; }
  function okName(n) {
    var s = n;
    try { if (typeof s.normalize === 'function') s = s.normalize('NFC'); } catch (e) {}
    if (s.length < 1 || s.length > 20 || s.split(' ').length > 2) return false;
    return NAME_RX ? NAME_RX.test(s) : !/[0-9٠-٩۰-۹]/.test(s);
  }
  function fill(tpl, n) { return String(tpl || '').split('{n}').join(n); }
  // IDENTITY §8: what is kept, until when, how to remove it — on screen with the child's own name before the tap
  function notice() {
    if (!noticeEl) return;
    var n = name();
    if (!okName(n)) { noticeEl.hidden = true; return; }
    document.getElementById('jn-n1').textContent = fill(C.noticeSave, n);
    document.getElementById('jn-n2').textContent = fill(C.noticeReadings, n);
    noticeEl.hidden = false;
  }
  function sync() { notice(); goEl.disabled = busy || !grade || (!practice && !okName(name())); }
  function go(url) { try { location.replace(url); } catch (e) { location.href = url; } }
  function waiting(on) {
    if (!going) return;
    goEl.textContent = on ? going : goText;
    if (on) goEl.setAttribute('aria-busy', 'true'); else goEl.removeAttribute('aria-busy');
  }

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
    // the line stays only while the home opens
    if (!(b.next && typeof b.next === 'string' && b.next.charAt(0) === '/' && !b.refused)) waiting(false);
    if (b.next && typeof b.next === 'string' && b.next.charAt(0) === '/') {
      if (b.refused === 'max_kids') return say('<p class="line">' + esc(C.full) + '</p><a class="go" href="' + esc(b.next) + '">' + esc(C.open) + '</a>');
      if (b.refused === 'teacher_phone') { line(C.teacher); return setTimeout(function () { go(b.next); }, 1800); }
      if (b.refused) { line(C.error); return sync(); }
      return go(b.next);
    }
    if (b.ask === 'is_this_you' && b.kids && b.kids.length) {
      // every same-named child the server names, each with the animal the home shows for them, then "a different one"
      var first = String(b.kids[0].first || '');
      var html = '<p class="line">' + esc(fill(C.isYou, first)) + '</p>';
      for (var i = 0; i < b.kids.length; i++) {
        var k = b.kids[i] || {};
        var face = b.kids.length > 1 ? (ANIMALS[k.animal] || '⭐') + ' ' : '';
        html += '<button type="button" class="pick" data-tap="same" data-chip="' + esc(k.chip) + '">' + face + esc(C.yesMe) + '</button>';
      }
      return say(html + '<button type="button" class="pick" data-tap="new">' + esc(fill(C.diff, first)) + '</button>');
    }
    if (b.off) return say('<p class="line">' + esc(C.off) + '</p><p class="small">' + esc(C.offNone) + '</p>' + backTap());
    if (b.stale) { goEl.disabled = true; return say('<p class="line">' + esc(C.stale) + '</p>' + backTap()); }
    line(C.error);
    sync();
  }

  function send(extra) {
    if (busy) return;
    busy = true;
    sync();
    if (going) { waiting(true); say(''); } else say('<p class="small">' + esc(C.wait) + '</p>');
    var body = { t: boot.t, grade: grade };
    if (!practice) body.name = name();
    if (extra) for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) body[k] = extra[k];
    post('/api/wq/join', body, answer);
  }

  function tapGrade(el) {
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
    if (nameEl && !name()) try { nameEl.focus(); } catch (er) {}
  }

  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest('[data-tap]') : null;
    if (!el) return;
    var tap = el.getAttribute('data-tap');
    if (tap === 'grade') {
      tapGrade(el);
    } else if (tap === 'go') {
      if (!goEl.disabled) send(null);
    } else if (tap === 'same') {
      send({ same: el.getAttribute('data-chip') });
    } else if (tap === 'new') {
      send({ force: true });
    }
  });
  if (nameEl) {
    nameEl.addEventListener('input', sync);
    nameEl.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !goEl.disabled) send(null); });
  }
  sync();
  // A grade tapped before this script bound (quiz_join_early_tap: the page's inline keeper put it on <html data-early>):
  // replayed once, as the tap it was. Without the keeper there is no data-early and nothing happens.
  window.__jnBound = true;
  var root = document.documentElement;
  var early = root && root.getAttribute ? root.getAttribute('data-early') : null;
  if (early && /^[1-5]$/.test(early)) {
    root.removeAttribute('data-early');
    var chip = document.querySelector('.chip[data-grade="' + early + '"]');
    if (chip) tapGrade(chip);
  }
})();
