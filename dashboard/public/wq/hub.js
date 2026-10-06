/* The kid hub (/h/<token>): what a child's /quiz on WhatsApp opens. No framework, no build step.
 * Boot JSON (server-rendered by the edge from the bot's web-quiz-hub.js): this phone's own children
 * (never classmates), the chosen child's teacher quiz, quizzes to play again, three recommended
 * video quizzes, the library and the challenge. Every quiz link carries `k`, that quiz's chip for
 * this child, so the quiz page starts without asking "Whose turn?". */
(function () {
  'use strict';
  var ROOT = document.getElementById('wq');
  var B = {};
  try { B = JSON.parse(document.getElementById('boot').textContent) || {}; } catch (e) { B = {}; }
  var LANG = B.lang === 'ur' ? 'ur' : 'en';
  var TOKEN = String(B.token || '');
  var BR = B.brand || null;
  var MASC = (BR && BR.mascot) || { en: 'Jugnu', ur: 'جگنو' };
  var ANIMALS = { cat: '🐱', dog: '🐶', rabbit: '🐰', parrot: '🦜', fish: '🐟', turtle: '🐢', lion: '🦁', elephant: '🐘', owl: '🦉', butterfly: '🦋', bee: '🐝', horse: '🐴' };
  var SUBJECT_TILE = { Science: '🔬', Maths: '➗', English: '🔤', Urdu: 'ا', 'Islamic Studies': '🕌', 'General Knowledge': '🌍', Geography: '🗺️', History: '📜' };
  // Lesson quizzes write short lower-case subjects; the video bank writes these names (web-quiz-videos.js SUBJECTS).
  var SUBJECT_KEY = { maths: 'Maths', math: 'Maths', mathematics: 'Maths', science: 'Science', 'general science': 'Science', english: 'English', urdu: 'Urdu',
    islamiat: 'Islamic Studies', islamiyat: 'Islamic Studies', 'islamic studies': 'Islamic Studies', 'general knowledge': 'General Knowledge', gk: 'General Knowledge',
    sst: 'General Knowledge', 'social studies': 'General Knowledge', geography: 'Geography', history: 'History' };
  var SUBJECT_UR = { Maths: 'ریاضی', Science: 'سائنس', English: 'انگریزی', Urdu: 'اردو', 'Islamic Studies': 'اسلامیات', 'General Knowledge': 'جنرل نالج', Geography: 'جغرافیہ', History: 'تاریخ' };

  /* ---------------- copy (en + ur): imperatives, no gendered verb ---------------- */
  var T = {
    en: {
      who: 'Who is playing?', whoSay: 'Tap your name.', hi: function (n) { return 'Hi ' + n + '! What shall we do today?'; },
      fromT: 'From your teacher', play: 'Play',
      sent: function (d) { return d <= 0 ? 'Sent today' : d === 1 ? 'Sent yesterday' : 'Sent ' + d + ' days ago'; },
      none: 'No new quiz from your teacher right now. Watch a video and try its quiz!',
      againT: 'Play again', againRow: function (score, n) { return 'Best ' + score + ' · ' + n + (n === 1 ? ' try' : ' tries'); },
      practice: 'Practice: your first score is the one your teacher sees.',
      libT: 'Video library', libSub: 'Pick a subject and a chapter',
      recT: 'Try these next', chT: function (m) { return m + '\'s Challenge'; }, chSub: 'Short games for reading and numbers',
      switchKid: 'Switch player', oops: 'Something went wrong. Try again.', offline: 'No internet. Try again when you are online.',
      wait: 'Opening…', noClass: 'Play a quiz from your teacher first.', gone: 'No quizzes here yet. Ask your teacher for a quiz link.', mins: function (m) { return m + ' min'; },
    },
    ur: {
      who: 'کون کھیل رہا ہے؟', whoSay: 'اپنے نام پر ٹیپ کریں۔', hi: function (n) { return 'السلام علیکم ' + n + '! آج کیا کریں؟'; },
      fromT: 'آپ کے استاد کی طرف سے', play: 'کھیلیں',
      sent: function (d) { return d <= 0 ? 'آج بھیجا گیا' : d === 1 ? 'کل بھیجا گیا' : d + ' دن پہلے بھیجا گیا'; },
      none: 'ابھی استاد کی طرف سے کوئی نیا کوئز نہیں۔ ایک ویڈیو دیکھیں اور اس کا کوئز کریں!',
      againT: 'دوبارہ کھیلیں', againRow: function (score, n) { return 'بہترین ' + score + ' · <bdi>' + n + ' بار</bdi>'; },
      practice: 'مشق: استاد کو آپ کا پہلا اسکور ہی نظر آتا ہے۔',
      libT: 'ویڈیو لائبریری', libSub: 'مضمون اور باب چنیں',
      recT: 'یہ بھی کریں', chT: function (m) { return m + ' کا چیلنج'; }, chSub: 'پڑھنے اور گنتی کے چھوٹے کھیل',
      switchKid: 'کھلاڑی بدلیں', oops: 'کچھ گڑبڑ ہو گئی۔ دوبارہ کوشش کریں۔', offline: 'انٹرنیٹ نہیں ہے۔ انٹرنیٹ آنے پر دوبارہ کوشش کریں۔',
      wait: 'کھل رہا ہے…', noClass: 'پہلے استاد کا کوئی کوئز کھیلیں۔', gone: 'ابھی یہاں کوئی کوئز نہیں۔ استاد سے کوئز کا لنک لیں۔', mins: function (m) { return m + ' منٹ'; },
    },
  }[LANG];

  /* ---------------- helpers ---------------- */
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function on(sel, fn) { var el = ROOT.querySelector(sel); if (el) el.addEventListener('click', fn); return el; }
  function ani(a) { return '<span class="wq-ani">' + (ANIMALS[a] || '⭐') + '</span>'; }
  function subjectKey(s) { var k = String(s || '').trim(); return SUBJECT_KEY[k.toLowerCase()] || k; }
  function subjectName(s) { var k = subjectKey(s); return LANG === 'ur' && SUBJECT_UR[k] ? SUBJECT_UR[k] : k; }
  // The mascot, as on the quiz page (wq.js jugImg/jug): a still pose and the speech bubble.
  var JUG_DIR = '/wq/jugnu/';
  function jug(pose, line) {
    return '<div class="wq-jug"><span class="wq-jimg" data-jpose="' + pose + '"><img src="' + JUG_DIR + pose + '.webp" alt="" width="92" height="92"></span><div class="wq-say">' + esc(line) + '</div></div>';
  }
  // Urdu: a run of Latin words (an English video title) keeps its own face and direction (wq.js latinRuns).
  var LAT_RUN = /[A-Za-z0-9&("'“‘][^\s<>؀-ۿ]*(?:[  ]+[A-Za-z0-9&("'“‘][^\s<>؀-ۿ]*)*/g;
  function latinRuns(html) {
    return String(html).split(/(<[^>]*>)/).map(function (part) {
      if (part.charAt(0) === '<' || !/[A-Za-z]/.test(part)) return part;
      return part.replace(LAT_RUN, function (run) {
        return /[A-Za-z]/.test(run) && (/[  ]/.test(run) || /[0-9]/.test(run)) ? '<span class="wq-lat" lang="en">' + run + '</span>' : run;
      });
    }).join('');
  }
  function lockup() {
    if (!BR) return '';
    return '<span class="wq-brand" aria-label="' + esc(BR.name) + '"><span class="wq-mark ' + (BR.mark.tile ? 'wq-tile' : 'wq-bare') + '" aria-hidden="true">' + BR.mark.svg + '</span>' +
      '<span class="wq-lock"><b>' + esc(BR.label[LANG]) + '</b><small>' + esc(BR.sub[LANG]) + '</small></span></span>';
  }
  function bar() { return '<div class="wq-bar">' + lockup() + '<span class="wq-grow"></span></div>'; }
  function render(html, moment) {
    ROOT.innerHTML = '<section class="wq-screen wq-hub" data-m="' + moment + '">' + (LANG === 'ur' ? latinRuns(html) : html) + '</section>';
    ROOT.setAttribute('data-m', moment);
    try { window.scrollTo(0, 0); } catch (e) {}
  }
  function toast(msg) {
    var t = document.createElement('div');
    t.className = 'wq-toast'; t.textContent = msg; t.setAttribute('role', 'status');
    ROOT.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 2600);
  }
  function daysSince(iso) {
    var t = Date.parse(iso || '');
    return isFinite(t) ? Math.max(0, Math.floor((Date.now() - t) / 86400000)) : 0;
  }
  function api(method, path, body) {
    var init = { method: method, headers: { accept: 'application/json' } };
    if (body) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
    return fetch('/api/wq/' + path, init).then(function (r) {
      return r.text().then(function (t) { var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {} return { status: r.status, ok: r.ok, body: j || {} }; });
    });
  }
  // Events: ids and counts only (the server allow-lists every prop); hub_pick's "what" rides in `src`.
  function ev(n, props) {
    var e = { t: Date.now(), lang: LANG };
    if (props) for (var k in props) if (props[k] !== undefined) e[k] = props[k];
    e.n = n;
    try {
      var body = JSON.stringify({ events: [e] });
      if (!(navigator.sendBeacon && navigator.sendBeacon('/api/wq/e', new Blob([body], { type: 'application/json' })))) {
        fetch('/api/wq/e', { method: 'POST', headers: { 'content-type': 'application/json' }, body: body, keepalive: true }).catch(function () {});
      }
    } catch (x) {}
  }
  function go(href, what) { ev('hub_pick', { src: what }); location.assign(href); }

  /* ---------------- H1 who is playing (only this phone's own children) ---------------- */
  function picker() {
    var kids = B.kids || [];
    render(bar() + jug('hello', T.whoSay) + '<h2>' + esc(T.who) + '</h2><div class="wq-chips">' +
      kids.map(function (k) { return '<button class="wq-kid" data-chip="' + esc(k.chip) + '">' + ani(k.animal) + esc(k.first) + '</button>'; }).join('') + '</div>', 'H1');
    Array.prototype.forEach.call(ROOT.querySelectorAll('[data-chip]'), function (b) {
      b.addEventListener('click', function () { pick(b.getAttribute('data-chip')); });
    });
  }
  function pick(chip) {
    render(bar() + '<div class="wq-boot"><img src="' + JUG_DIR + 'thinking.webp" alt="" width="96"><p class="wq-bootsay">' + esc(T.wait) + '</p></div>', 'H1-wait');
    api('GET', 'hub/' + encodeURIComponent(TOKEN) + '?kid=' + encodeURIComponent(chip)).then(function (r) {
      if (!r.ok || !r.body || !r.body.kid) throw new Error('hub_' + r.status);
      var kids = B.kids;
      B = r.body; B.token = TOKEN; B.brand = BR; B.kids = B.kids && B.kids.length ? B.kids : kids;
      try { history.replaceState(null, '', '/h/' + TOKEN + '?kid=' + encodeURIComponent(chip)); } catch (e) {}
      hub();
    }).catch(function () { toast(T.offline); picker(); });
  }

  /* ---------------- H2 the hub ---------------- */
  function teacherCard(t) {
    if (!t) {
      return '<div class="wq-card wq-hcard wq-hnone"><p class="wq-hnonesay">' + esc(T.none) + '</p>' +
        (B.lib ? '<a class="wq-btn wq-go" id="wq-h-lib2" href="' + esc(B.lib.href) + '">📚 ' + esc(T.libT) + '</a>' : '') + '</div>';
    }
    return '<div class="wq-card wq-hcard"><p class="wq-hlabel">' + esc(T.fromT) + '</p>' +
      '<h2 dir="auto">' + esc(t.topic) + '</h2><p class="wq-sub">' + esc([subjectName(t.subject), T.sent(daysSince(t.sent_at))].filter(Boolean).join(' · ')) + '</p>' +
      '<a class="wq-btn wq-go" id="wq-h-teacher" href="/q/' + esc(t.code) + '?k=' + esc(t.k) + '">▶ ' + esc(T.play) + '</a></div>';
  }
  function tile(subject, i) { return '<span class="wq-vtile wq-vt' + (i % 4 + 1) + '" aria-hidden="true">' + (SUBJECT_TILE[subjectKey(subject)] || '▶') + '</span>'; }
  function againList(list) {
    if (!list.length) return '';
    return '<p class="wq-hlabel">' + esc(T.againT) + '</p><ul class="wq-vlist">' + list.map(function (a, i) {
      return '<li><a class="wq-vitem" data-again="' + i + '" href="/q/' + esc(a.code) + '?again=1&amp;k=' + esc(a.k) + '">' + tile(a.subject, i) +
        '<span class="wq-vtext"><b dir="auto">' + esc(a.topic) + '</b><small>' + T.againRow('<bdi dir="ltr">' + esc(a.best.c + '/' + a.best.t) + '</bdi>', a.tries) + '</small></span></a></li>';
    }).join('') + '</ul><p class="wq-small">' + esc(T.practice) + '</p>';
  }
  function recList(list) {
    if (!list.length) return '';
    return '<p class="wq-hlabel">' + esc(T.recT) + '</p><ul class="wq-vlist">' + list.map(function (v, i) {
      var pic = v.poster ? '<img class="wq-vtile" src="' + esc(v.poster) + '" alt="" loading="lazy" width="96" height="60" onerror="this.style.visibility=\'hidden\'">' : tile(v.subject, i);
      // Each atom isolated, so a Latin chapter or "3 min" keeps its order inside an Urdu line.
      var meta = [subjectName(v.subject), v.chapter, v.secs ? T.mins(Math.max(1, Math.round(v.secs / 60))) : ''].filter(Boolean)
        .map(function (x) { return '<bdi>' + esc(x) + '</bdi>'; }).join(' · ');
      return '<li><button class="wq-vitem" data-rec="' + i + '">' + pic + '<span class="wq-vtext"><b dir="auto">' + esc(v.title) + '</b><small>' + meta + '</small></span></button></li>';
    }).join('') + '</ul>';
  }
  function hub() {
    var me = (B.kids || []).filter(function (k) { return k.chip === B.kid; })[0] || {};
    // With no teacher quiz the empty card already holds the library button: no second library tile.
    var tiles = (B.lib && B.teacher ? '<a class="wq-htile" id="wq-h-lib" href="' + esc(B.lib.href) + '"><span class="wq-htic" aria-hidden="true">📚</span><b>' + esc(T.libT) + '</b><small>' + esc(T.libSub) + '</small></a>' : '') +
      (B.challenge && B.challenge.on ? '<a class="wq-htile" id="wq-h-ch" href="/c/' + esc(TOKEN) + '?kid=' + esc(B.kid) + '&amp;lang=' + LANG + '"><span class="wq-htic" aria-hidden="true">⭐</span><b>' + esc(T.chT(MASC[LANG])) + '</b><small>' + esc(T.chSub) + '</small></a>' : '');
    render(bar() + jug('hello', T.hi(me.first || '')) + teacherCard(B.teacher) +
      (tiles ? '<div class="wq-htiles">' + tiles + '</div>' : '') +
      againList(B.again || []) + recList(B.recs || []) +
      ((B.kids || []).length > 1 ? '<button class="wq-btn wq-ghost" id="wq-h-switch">' + ani(me.animal) + ' ' + esc(T.switchKid) + '</button>' : ''), 'H2');
    on('#wq-h-teacher', function (e) { e.preventDefault(); go(this.getAttribute('href'), 'teacher'); });
    on('#wq-h-lib', function (e) { e.preventDefault(); go(this.getAttribute('href'), 'lib'); });
    on('#wq-h-lib2', function (e) { e.preventDefault(); go(this.getAttribute('href'), 'lib'); });
    on('#wq-h-ch', function (e) { e.preventDefault(); go(this.getAttribute('href'), 'challenge'); });
    on('#wq-h-switch', function () { picker(); });
    Array.prototype.forEach.call(ROOT.querySelectorAll('[data-again]'), function (a) {
      a.addEventListener('click', function (e) { e.preventDefault(); go(a.getAttribute('href'), 'again'); });
    });
    Array.prototype.forEach.call(ROOT.querySelectorAll('[data-rec]'), function (b) {
      b.addEventListener('click', function () { startRec((B.recs || [])[Number(b.getAttribute('data-rec'))]); });
    });
  }
  var starting = false;
  function startRec(v) {
    if (!v || starting) return;
    starting = true;
    ev('hub_pick', { src: 'rec' });
    render(bar() + jug('thinking', T.wait) + '<p class="wq-sub" dir="auto">' + esc(v.title) + '</p>', 'H2-go');
    api('POST', 'videos/start', { hub: TOKEN, kid: B.kid, vid: v.vid }).then(function (r) {
      if (r.status === 409) { starting = false; hub(); toast(T.noClass); return; }
      if (!r.ok || !r.body || !r.body.code) throw new Error('rec_' + r.status);
      location.assign('/q/' + encodeURIComponent(r.body.code) + (r.body.k ? '?k=' + encodeURIComponent(r.body.k) : ''));
    }).catch(function () { starting = false; hub(); toast(T.oops); });
  }

  /* ---------------- boot ---------------- */
  ev('hub_view', { src: B.kid ? 'hub' : 'who', i: (B.kids || []).length });
  if (!(B.kids || []).length) render(bar() + jug('sleep', T.gone), 'H0');
  else if (!B.kid) picker();
  else hub();
})();
