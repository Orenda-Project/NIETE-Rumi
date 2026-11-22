/* The standing class link (/j/<code>): the steps a child takes before the hub. No framework, no build step.
 * Boot JSON: {view:'class_link', code, lang, jt?, via?} (via: the landing's marker, posted on arrive, where the bot counts the open).
 * Under the chips: the #wq-remind mount (data-src class_link). A step answer with push_remind: true (the bot's
 * web_quiz_push_remind) gets the reminder ask there after the step has painted (remind()). The page holds no child until the server answers a step:
 *   arrive  → "Whose turn?" (only the children this phone played as, in this class, and a button to the teacher
 *             step for a child not listed) or the teacher step
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
  // copy.v2.json: jg.link.teacher_q, jg.link.letter_q, jg.link.is_here, jg.who.turn, jg.who.not_listed (one label for one
  // action, "this child is not in the list shown": the name screen's way out and the "Whose turn?" way out both use it),
  // qfix_class_link.quiz_ready (the badge on a "Whose turn?" chip whose child has tonight's class quiz waiting),
  // qfix_class_link.done_tonight (the same badge for a child who is done for tonight: finished it, or nothing left)
  var COPY = {
    en: { teacher_q: "Tap your teacher's name", letter_q: 'Tap the first letter of your name', is_here: 'Is your name here?', turn: 'Whose turn?', not_listed: "My name isn't here", quiz_ready: 'Quiz ready', done_tonight: 'Done for tonight!' },
    ur: { teacher_q: 'ٹیچر کا نام دبائیں', letter_q: 'اپنے نام کا پہلا حرف دبائیں', is_here: 'کیا آپ کا نام یہاں ہے؟', turn: 'کس کی باری ہے؟', not_listed: 'میرا نام یہاں نہیں ہے', quiz_ready: 'کوئز تیار', done_tonight: 'آج شام کا کوئز ہو گیا!' },
  };
  var T = COPY[LANG];
  // The reminder ask's slot under the chips: drawn empty; remind() mounts the ask into it when the step says so.
  var REMIND = '<div id="wq-remind" data-src="class_link"></div>';
  var letterStep = null;
  var reminded = false;

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
  function jv(u) { return window.wqjv ? window.wqjv(u) : u; } // a Jugnu picture with its version (the page's wqjv, web_quiz_brotli on), else as is
  function screen(title, inner) {
    ROOT.innerHTML = '<section class="wq-screen"><img class="wq-jugnu" src="' + jv('/wq/jugnu/hello.webp') + '" alt="" width="96" height="96">' +
      '<h1>' + esc(title) + '</h1>' + inner + '</section>';
  }
  function on(sel, fn) {
    Array.prototype.forEach.call(ROOT.querySelectorAll(sel), function (b) { b.addEventListener('click', function () { fn(b); }); });
  }
  // The reminder ask (wq-remind.js), as the result screen loads it: only when the step answer carries push_remind: true,
  // once per page, after the step has painted (the next frame), with this script's own ?v=; on its load, the card into
  // the slot. code: tonight's round share code (remind_code), else this link's code; chips: the chips this screen shows.
  // Any failure leaves the slot empty; the step never waits on it.
  function remind(r, chips) {
    if (r.push_remind !== true || reminded) return;
    reminded = true;
    try {
      var ctx = { code: typeof r.remind_code === 'string' && r.remind_code ? r.remind_code : CODE, lang: LANG, chips: chips, host: location.host, src: 'class_link' };
      (window.requestAnimationFrame ? window.requestAnimationFrame.bind(window) : setTimeout)(function () {
        setTimeout(function () {
          try {
            var own = document.querySelector('script[src*="/wq/class-link.js"]');
            var v = own && /[?&]v=([A-Za-z0-9_-]+)/.exec(own.getAttribute('src') || '');
            var el = document.createElement('script');
            el.src = '/wq/wq-remind.js' + (v ? '?v=' + v[1] : '');
            el.onload = function () {
              try { var slot = ROOT.querySelector('#wq-remind'); if (slot && window.WQREMIND) window.WQREMIND.mount(slot, ctx); } catch (e) {}
            };
            document.body.appendChild(el);
          } catch (e) {}
        }, 0);
      });
    } catch (e) {}
  }
  // Nothing to show (the link closed meanwhile, a step expired): a sleeping Jugnu, never a reload loop.
  function closed() { ROOT.innerHTML = '<section class="wq-screen wq-closed"><img class="wq-jugnu" src="' + jv('/wq/jugnu_sleep.webp') + '" alt="" width="160" height="160"></section>'; }

  function show(out) {
    if (!out.ok) return closed();
    var r = out.body;
    if (r.href) { location.href = r.href; return; }
    if (r.step === 'who') {
      screen(T.turn, '<div class="wq-kids-big">' + r.kids.map(function (k) {
        var name = '<bdi>' + esc(k.first) + '</bdi>';
        // round: tonight's class quiz is waiting for this child: "Quiz ready" under the name, inside the chip (the
        // whole chip stays the tap target); round_done: they are done for tonight, the same badge with those words.
        // An unmarked chip is drawn exactly as before.
        var badge = k.round === true ? T.quiz_ready : k.round_done === true ? T.done_tonight : null;
        if (badge) name = '<span class="wq-cl-nm">' + name + '<span class="wq-chip wq-cl-ready">' + esc(badge) + '</span></span>';
        return '<button class="wq-kid wq-kid-big" data-chip="' + esc(k.chip) + '"><span class="wq-ani" aria-hidden="true">' + (ANIMALS[k.animal] || '⭐') + '</span>' + name + '</button>';
      }).join('') + '</div>' + (r.other ? '<button class="wq-btn wq-soft" type="button" id="wq-cl-other">' + esc(T.not_listed) + '</button>' : '') + REMIND);
      on('[data-chip]', function (b) { post('pick', { s: r.s, chip: b.getAttribute('data-chip'), device_ref: deviceRef() }).then(show); });
      // A shared phone: a child who is not listed (a sibling) takes the teacher step the server sent with this one.
      on('#wq-cl-other', function () { show({ ok: true, body: r.other }); });
      remind(r, r.kids.length);
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
      }).join('') + '</div>' + REMIND + '<button class="wq-linkbtn" id="wq-cl-back">' + esc(T.not_listed) + '</button>');
      on('[data-chip]', function (b) { post('pick', { s: r.s, chip: b.getAttribute('data-chip'), device_ref: deviceRef() }).then(show); });
      // Not here: back to the letters (another first letter). The new-child path is not on this link yet.
      on('#wq-cl-back', function () { if (letterStep) show({ ok: true, body: letterStep }); });
      remind(r, r.kids.length);
      return;
    }
    closed();
  }

  var first = { device_ref: deviceRef() };
  if (JT) first.jt = JT;
  if (typeof B.via === 'string') first.via = B.via;
  post('arrive', first).then(show, closed);
}());
