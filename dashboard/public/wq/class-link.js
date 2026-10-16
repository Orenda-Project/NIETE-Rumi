/* The standing class link (/j/<code>): the steps a child takes before the hub. No framework, no build step.
 * Boot JSON: {view:'class_link', code, lang, jt?}. The page holds no child until the server answers a step:
 *   arrive  → "Whose turn?" (only the children this phone played as, in this class) or the teacher step
 *   teacher → the letter step (the whole alphabet of the roster's script) or the teacher step again
 *   letter  → "Is your name here?" with the first names under that letter
 *   pick    → {href: /h/<token>}: the child's hub
 * This phone's device_ref rides in the body only (the key hub.js and wq.js keep it under). */
(function () {
  'use strict';
  var ROOT = document.getElementById('wq');
  var B = {};
  try { B = JSON.parse(document.getElementById('boot').textContent) || {}; } catch (e) { B = {}; }
  var LANG = B.lang === 'ur' ? 'ur' : 'en';
  var CODE = String(B.code || '');
  var JT = typeof B.jt === 'string' ? B.jt : null;
  var ANIMALS = { cat: '🐱', dog: '🐶', rabbit: '🐰', parrot: '🦜', fish: '🐟', turtle: '🐢', lion: '🦁', elephant: '🐘', owl: '🦉', butterfly: '🦋', bee: '🐝', horse: '🐴' };
  // copy.v2.json: jg.link.teacher_q, jg.link.letter_q, jg.link.is_here, jg.who.turn, jg.who.not_listed
  var COPY = {
    en: { teacher_q: "Tap your teacher's name", letter_q: 'Tap the first letter of your name', is_here: 'Is your name here?', turn: 'Whose turn?', not_listed: "My name isn't here" },
    ur: { teacher_q: 'ٹیچر کا نام دبائیں', letter_q: 'اپنے نام کا پہلا حرف دبائیں', is_here: 'کیا آپ کا نام یہاں ہے؟', turn: 'کس کی باری ہے؟', not_listed: 'میرا نام یہاں نہیں ہے' },
  };
  var T = COPY[LANG];
  var letterStep = null;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }
  function deviceRef() {
    var d = null;
    try { d = JSON.parse(localStorage.getItem('wq_d') || 'null'); } catch (e) { d = null; }
    if (typeof d === 'string' && /^[A-Za-z0-9_-]{22}$/.test(d)) return d;
    var ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    var a = [];
    try { var u = new Uint8Array(22); window.crypto.getRandomValues(u); a = Array.prototype.slice.call(u); } catch (e) { a = []; }
    d = '';
    for (var i = 0; i < 22; i++) d += ABC.charAt((a.length ? a[i] : Math.floor(Math.random() * 256)) & 63);
    try { localStorage.setItem('wq_d', JSON.stringify(d)); } catch (e) {}
    return d;
  }
  function post(step, body) {
    body.code = CODE;
    return fetch('/api/wq/cl/' + step, { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { ok: r.ok, body: j || {} }; }); });
  }
  function screen(title, inner) {
    ROOT.innerHTML = '<section class="wq-screen"><img class="wq-jugnu" src="/wq/jugnu/hello.webp" alt="" width="96" height="96">' +
      '<h1>' + esc(title) + '</h1>' + inner + '</section>';
  }
  function on(sel, fn) {
    Array.prototype.forEach.call(ROOT.querySelectorAll(sel), function (b) { b.addEventListener('click', function () { fn(b); }); });
  }
  // Nothing to show (the link closed meanwhile, a step expired): a sleeping Jugnu, never a reload loop.
  function closed() { ROOT.innerHTML = '<section class="wq-screen wq-closed"><img class="wq-jugnu" src="/wq/jugnu_sleep.webp" alt="" width="160" height="160"></section>'; }

  function show(out) {
    if (!out.ok) return closed();
    var r = out.body;
    if (r.href) { location.href = r.href; return; }
    if (r.step === 'who') {
      screen(T.turn, '<div class="wq-kids-big">' + r.kids.map(function (k) {
        return '<button class="wq-kid wq-kid-big" data-chip="' + esc(k.chip) + '"><span class="wq-ani" aria-hidden="true">' + (ANIMALS[k.animal] || '⭐') + '</span><bdi>' + esc(k.first) + '</bdi></button>';
      }).join('') + '</div>');
      on('[data-chip]', function (b) { post('pick', { s: r.s, chip: b.getAttribute('data-chip'), device_ref: deviceRef() }).then(show); });
      return;
    }
    if (r.step === 'teacher') {
      screen(T.teacher_q, '<div class="wq-kids-big">' + r.teachers.map(function (t) {
        return '<button class="wq-kid wq-kid-big" data-tk="' + esc(t.tk) + '"><bdi>' + esc(t.name) + '</bdi></button>';
      }).join('') + '</div>');
      on('[data-tk]', function (b) { post('teacher', { s: r.s, tk: b.getAttribute('data-tk') }).then(show); });
      return;
    }
    if (r.step === 'letter') {
      letterStep = r;
      screen(T.letter_q, '<div class="wq-who">' + r.letters.map(function (l) {
        return '<button class="wq-kid" data-l="' + esc(l) + '"><bdi>' + esc(l) + '</bdi></button>';
      }).join('') + '</div>');
      on('[data-l]', function (b) { post('letter', { s: r.s, letter: b.getAttribute('data-l') }).then(show); });
      return;
    }
    if (r.step === 'chips') {
      screen(T.is_here, '<div class="wq-kids-big">' + r.kids.map(function (k) {
        return '<button class="wq-kid wq-kid-big" data-chip="' + esc(k.chip) + '"><bdi>' + esc(k.first) + '</bdi></button>';
      }).join('') + '</div><button class="wq-linkbtn" id="wq-cl-back">' + esc(T.not_listed) + '</button>');
      on('[data-chip]', function (b) { post('pick', { s: r.s, chip: b.getAttribute('data-chip'), device_ref: deviceRef() }).then(show); });
      // Not here: back to the letters (another first letter). The new-child path is not on this link yet.
      on('#wq-cl-back', function () { if (letterStep) show({ ok: true, body: letterStep }); });
      return;
    }
    closed();
  }

  var first = { device_ref: deviceRef() };
  if (JT) first.jt = JT;
  post('arrive', first).then(show, closed);
}());
