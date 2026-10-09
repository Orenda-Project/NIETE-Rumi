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
  var LOCKED_BOOT = Boolean(B.locked);
  // Opened from the quiz results card's door (?from=door): counted as the door's on its first view.
  var FROM_DOOR = /[?&]from=door(&|$)/.test(String((typeof location !== 'undefined' && location.search) || ''));
  // Opened from the quiz page's Home button (?from=home): counted as Home's.
  var FROM_HOME = /[?&]from=home(&|$)/.test(String((typeof location !== 'undefined' && location.search) || ''));
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
  var COPY = {
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
      lockT: 'This link was sent to another player', lockSay: 'Ask the child this link was sent to to open it.',
      someone: 'Someone else / new player', newT: 'New here?', mineDoor: 'Finish your own quiz, then tap “My quizzes, videos and challenges”.',
      mine: 'Is this your link? Send /quiz on WhatsApp again for a new one.',
      newSay: 'Ask your teacher for a quiz link, or send /quiz on WhatsApp from your family\'s phone.',
      lastT: 'Your last quiz', cont: 'Continue', soFar: function (n) { return n ? n + (n === 1 ? ' question answered' : ' questions answered') : 'Not started yet'; },
      done: 'Finished', playAgain: 'Play again', vidT: 'Videos', vidSub: 'Watch one and try its quiz',
      wait: 'Opening…', noClass: 'Play a quiz from your teacher first.', gone: 'No quizzes here yet. Ask your teacher for a quiz link.', mins: function (m) { return m + ' min'; },
    },
    ur: {
      who: 'کس کی باری ہے؟', whoSay: 'اپنے نام پر ٹیپ کریں۔', hi: function (n) { return 'السلام علیکم ' + n + '! آج کیا کریں؟'; },
      fromT: 'آپ کے استاد کی طرف سے', play: 'کھیلیں',
      sent: function (d) { return d <= 0 ? 'آج بھیجا گیا' : d === 1 ? 'کل بھیجا گیا' : '<bdi>' + d + '</bdi> دن پہلے بھیجا گیا'; },
      none: 'ابھی استاد کی طرف سے کوئی نیا کوئز نہیں۔ ایک ویڈیو دیکھیں اور اس کا کوئز کریں!',
      againT: 'دوبارہ کھیلیں', againRow: function (score, n) { return 'بہترین ' + score + ' · <bdi>' + n + ' بار</bdi>'; },
      practice: 'مشق: استاد کو آپ کا پہلا اسکور ہی نظر آتا ہے۔',
      libT: 'ویڈیو لائبریری', libSub: 'مضمون اور باب چنیں',
      recT: 'یہ بھی کریں', chT: function (m) { return m + ' کا چیلنج'; }, chSub: 'پڑھنے اور گنتی کے چھوٹے کھیل',
      switchKid: 'کھلاڑی بدلیں', oops: 'کچھ گڑبڑ ہو گئی۔ دوبارہ کوشش کریں۔', offline: 'انٹرنیٹ نہیں ہے۔ انٹرنیٹ آنے پر دوبارہ کوشش کریں۔',
      lockT: 'یہ لنک کسی اور کھلاڑی کو بھیجا گیا تھا', lockSay: 'جس بچے کو یہ لنک بھیجا گیا تھا، اُس سے کہیں کہ اسے کھولے۔',
      someone: 'کوئی اور / نیا کھلاڑی', newT: 'پہلی بار؟', mineDoor: 'اپنا کوئز مکمل کریں، پھر «میرے کوئز، ویڈیوز اور چیلنج» دبائیں۔',
      mine: 'کیا یہ آپ کا لنک ہے؟ نیا لنک لینے کے لیے واٹس ایپ پر دوبارہ ⁦/quiz⁩ بھیجیں۔',
      newSay: 'اپنے استاد سے کوئز کا لنک لیں، یا گھر کے فون سے واٹس ایپ پر ⁦/quiz⁩ بھیجیں۔',
      lastT: 'آپ کا پچھلا کوئز', cont: 'جاری رکھیں', soFar: function (n) { return n ? '<bdi>' + n + '</bdi> سوالوں کے جواب دیے' : 'ابھی شروع نہیں کیا'; },
      done: 'مکمل', playAgain: 'دوبارہ کھیلیں', vidT: 'ویڈیوز', vidSub: 'ایک دیکھیں اور اس کا کوئز کریں',
      wait: 'کھل رہا ہے…', noClass: 'پہلے استاد کا کوئی کوئز کھیلیں۔', gone: 'ابھی یہاں کوئی کوئز نہیں۔ استاد سے کوئز کا لنک لیں۔', mins: function (m) { return m + ' منٹ'; },
    },
  };
  // The polished Urdu copy (app_settings web_quiz_ur_polish → the edge's `wq-ur2` class on <html>): a child's words, the name
  // first in the greeting. Off, COPY.ur is today's, untouched.
  var UR2_COPY = {
    whoSay: 'اپنا نام دبائیں۔', hi: function (n) { return '\u2068' + n + '\u2069، السلام علیکم! آج کیا کھیلیں؟'; },
    none: 'ابھی نیا کوئز نہیں۔ ایک ویڈیو دیکھیں اور اس کا کوئز کھیلیں!', practice: 'مشق۔ استاد کو پہلا اسکور ہی دکھے گا۔',
    chSub: 'پڑھنے اور گنتی کے کھیل', lockSay: 'یہ لنک جس کو ملا تھا، وہی کھولے۔',
    mineDoor: 'اپنا کوئز مکمل کریں، پھر «میرے کوئز اور ویڈیوز» دبائیں۔'
  };
  function ur2() { try { return !!(B && B.ui && B.ui.ur2 === true) && document.documentElement.classList.contains('wq-ur2'); } catch (e) { return false; } }
  function copyFor(l) { return l === 'ur' && ur2() ? Object.assign({}, COPY.ur, UR2_COPY) : COPY[l]; }
  var T = copyFor(LANG);
  // B is replaced by the bot's answer for one child (a sibling pick, an unlock): that child's language
  // wins over the boot page's, for the copy and for <html lang/dir> (the Urdu face and the rtl flow).
  function setLang(l) {
    LANG = l === 'ur' ? 'ur' : 'en';
    try { document.documentElement.setAttribute('lang', LANG); document.documentElement.setAttribute('dir', LANG === 'ur' ? 'rtl' : 'ltr'); } catch (e) {}
    // The polished Urdu look (the edge put `wq-ur2` on <html> for an Urdu boot): it follows the language, never the boot.
    try { if (B && B.ui && B.ui.ur2 === true) document.documentElement.classList.toggle('wq-ur2', LANG === 'ur'); } catch (e) {}
    T = copyFor(LANG);
  }

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
  // A quiz link: every part URL-encoded (a chip or code from the server is never trusted to be URL-safe).
  function quizHref(code, q) {
    var parts = [];
    for (var k in q) if (q[k]) parts.push(k + '=' + encodeURIComponent(q[k]));
    return '/q/' + encodeURIComponent(code) + (parts.length ? '?' + parts.join('&') : '');
  }
  function api(method, path, body) {
    var init = { method: method, headers: { accept: 'application/json' } };
    if (body) { init.headers['content-type'] = 'application/json'; init.body = JSON.stringify(body); }
    return fetch('/api/wq/' + path, init).then(function (r) {
      return r.text().then(function (t) { var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {} return { status: r.status, ok: r.ok, body: j || {} }; });
    });
  }
  // This phone's device_ref: the same key the quiz page keeps it under (wq.js sget 'wq_d', JSON), so a
  // phone that opens the hub and then plays is one phone to the server. Minted here when there is none.
  // The same ref goes into the wq_dv cookie, so the pages a hub link opens next (the challenge, the library)
  // reach the server as this phone too: their server render and API calls carry it as x-wq-device.
  function keepCookie(d) {
    try {
      document.cookie = 'wq_dv=' + d + '; path=/; max-age=2592000; samesite=lax' + (location.protocol === 'https:' ? '; secure' : '');
    } catch (e) {}
    return d;
  }
  function deviceRef() {
    var d = null;
    try { d = JSON.parse(localStorage.getItem('wq_d') || 'null'); } catch (e) { d = null; }
    if (typeof d === 'string' && /^[A-Za-z0-9_-]{22}$/.test(d)) return keepCookie(d);
    var ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    var bytes = [];
    try { var a = new Uint8Array(22); window.crypto.getRandomValues(a); bytes = Array.prototype.slice.call(a); } catch (e) { bytes = []; }
    d = '';
    for (var i = 0; i < 22; i++) d += ABC.charAt((bytes.length ? bytes[i] : Math.floor(Math.random() * 256)) & 63);
    try { localStorage.setItem('wq_d', JSON.stringify(d)); } catch (e) {}
    return keepCookie(d);
  }
  // The hub JSON for this phone: the device_ref rides in the body, never the URL.
  function hubFor(kid) {
    var body = {};
    if (kid) body.kid = kid;
    body.device_ref = deviceRef();
    return api('POST', 'hub/' + encodeURIComponent(TOKEN), body);
  }
  // Events: ids and counts only (the server allow-lists every prop); hub_pick's "what" rides in `src`.
  function ev(n, props) {
    var e = { t: Date.now(), lang: LANG };
    if (props) for (var k in props) if (props[k] !== undefined) e[k] = props[k];
    e.n = n;
    // Page-session telemetry on (wq-tel.js): the event joins that page session's queue.
    if (window.WQT && window.WQT.push(e)) return;
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
    hubFor(chip).then(function (r) {
      // An expired or forged link: the server's closed page says what to do (never "No internet").
      if (r.status === 401) { location.reload(); return; }
      if (r.ok && r.body && r.body.locked) { locked(); return; }
      if (!r.ok || !r.body || !r.body.kid) throw new Error('hub_' + r.status);
      var kids = B.kids;
      B = r.body; B.token = TOKEN; B.brand = BR; B.kids = B.kids && B.kids.length ? B.kids : kids;
      setLang(B.lang || LANG);
      try { history.replaceState(null, '', '/h/' + TOKEN + '?kid=' + encodeURIComponent(chip)); } catch (e) {}
      hub();
    }).catch(function (e) { toast(e && /^hub_/.test(e.message) ? T.oops : T.offline); picker(); });
  }

  /* ---------------- H-lock: a forwarded link (another phone) — never a name, never a play ---------------- */
  function locked() {
    B = { lang: LANG, token: TOKEN, brand: BR, locked: true, kids: [] };
    render(bar() + jug('thinking', T.lockSay) + '<h2>' + esc(T.lockT) + '</h2>' +
      '<p class="wq-sub">' + esc(T.mineDoor) + '</p>' +
      '<p class="wq-sub">' + esc(T.mine) + '</p>' +
      '<button class="wq-btn wq-ghost" id="wq-h-new">' + esc(T.someone) + '</button>', 'H-lock');
    on('#wq-h-new', function () { newPlayer(); });
  }
  function newPlayer() {
    ev('hub_pick', { src: 'new' });
    render(bar() + jug('hello', T.newSay) + '<h2>' + esc(T.newT) + '</h2>', 'H-new');
  }
  // The server render has no device: ask again as this phone, then show what the bot allows.
  function unlock() {
    render(bar() + '<div class="wq-boot"><img src="' + JUG_DIR + 'hello.webp" alt="" width="96"><p class="wq-bootsay">' + esc(T.wait) + '</p></div>', 'H0-wait');
    hubFor(null).then(function (r) {
      if (r.status === 401) { location.reload(); return; }
      if (!r.ok || !r.body) throw new Error('hub_' + r.status);
      if (r.body.locked) { locked(); return; }
      B = r.body; B.token = TOKEN; B.brand = BR;
      // Only a hub for one child carries that child's language; with no child picked the bot's lang is a
      // default, and the server render's (from this family's children) stays.
      if (B.kid) setLang(B.lang || LANG);
      boot();
    }).catch(function (e) { toast(e && /^hub_/.test(e.message) ? T.oops : T.offline); locked(); });
  }

  /* ---------------- H2 the hub ---------------- */
  // With the Home button on (nav_home), the library and the challenge are told to show it too.
  function withHome(h) { return B.nav_home ? h + (h.indexOf('?') >= 0 ? '&' : '?') + 'home=1' : h; }
  function teacherCard(t) {
    if (!t) {
      return '<div class="wq-card wq-hcard wq-hnone"><p class="wq-hnonesay">' + esc(T.none) + '</p>' +
        (B.lib ? '<a class="wq-btn wq-go" id="wq-h-lib2" href="' + esc(withHome(B.lib.href)) + '">📚 ' + esc(T.libT) + '</a>' : '') + '</div>';
    }
    return '<div class="wq-card wq-hcard"><p class="wq-hlabel">' + esc(T.fromT) + '</p>' +
      '<h2 dir="auto">' + esc(t.topic) + '</h2><p class="wq-sub">' + [esc(subjectName(t.subject)), T.sent(daysSince(t.sent_at))].filter(Boolean).join(' · ') + '</p>' +
      '<a class="wq-btn wq-go" id="wq-h-teacher" href="' + esc(quizHref(t.code, { k: t.k })) + '">▶ ' + esc(T.play) + '</a></div>';
  }
  // The subject's picture when the server names one (the library's art), else the emoji tile.
  function tile(subject, i, art) {
    if (art) return '<img class="wq-vtile" src="' + esc(art) + '" alt="" loading="lazy" width="96" height="60" onerror="this.style.visibility=\'hidden\'">';
    return '<span class="wq-vtile wq-vt' + (i % 4 + 1) + '" aria-hidden="true">' + (SUBJECT_TILE[subjectKey(subject)] || '▶') + '</span>';
  }
  function againList(list) {
    if (!list.length) return '';
    return '<p class="wq-hlabel">' + esc(T.againT) + '</p><ul class="wq-vlist">' + list.map(function (a, i) {
      return '<li><a class="wq-vitem" data-again="' + i + '" href="' + esc(quizHref(a.code, { again: '1', k: a.k })) + '">' + tile(a.subject, i, a.art) +
        '<span class="wq-vtext"><b dir="auto">' + esc(a.topic) + '</b><small>' + T.againRow(a.best && a.best.t ? '<bdi dir="ltr">' + esc(a.best.c + '/' + a.best.t) + '</bdi>' : '–', Number(a.tries) || 1) + '</small></span></a></li>';
    }).join('') + '</ul><p class="wq-small">' + esc(T.practice) + '</p>';
  }
  function recList(list) {
    if (!list.length) return '';
    return '<p class="wq-hlabel">' + esc(T.recT) + '</p><ul class="wq-vlist">' + list.map(function (v, i) {
      var pic = v.poster ? '<img class="wq-vtile" src="' + esc(v.poster) + '" alt="" loading="lazy" width="96" height="60" onerror="this.style.visibility=\'hidden\'">' : tile(v.subject, i, v.art);
      // Each atom isolated, so a Latin chapter or "3 min" keeps its order inside an Urdu line.
      var meta = [subjectName(v.subject), v.chapter, v.secs ? T.mins(Math.max(1, Math.round(v.secs / 60))) : ''].filter(Boolean)
        .map(function (x) { return '<bdi>' + esc(x) + '</bdi>'; }).join(' · ');
      return '<li><button class="wq-vitem" data-rec="' + i + '">' + pic + '<span class="wq-vtext"><b dir="auto">' + esc(v.title) + '</b><small>' + meta + '</small></span></button></li>';
    }).join('') + '</ul>';
  }
  // The home page (web_quiz_child_quiz_home): the quiz this child touched last — Continue, or the score and
  // Play again — above everything else.
  function lastCard(l) {
    if (!l) return '';
    var meta = [esc(subjectName(l.subject)), l.state === 'open' ? T.soFar(Number(l.answered) || 0) : esc(T.done)].filter(Boolean).join(' · ');
    var score = l.state === 'done' && l.score && l.score.t ? '<p class="wq-hscore">⭐ <bdi dir="ltr">' + esc(l.score.c + '/' + l.score.t) + '</bdi></p>' : '';
    var href = l.state === 'open' ? quizHref(l.code, { k: l.k }) : l.again ? quizHref(l.code, { again: '1', k: l.k }) : '';
    var btn = href ? '<a class="wq-btn wq-go" id="wq-h-last" href="' + esc(href) + '">' + (l.state === 'open' ? '▶ ' + esc(T.cont) : '↻ ' + esc(T.playAgain)) + '</a>' : '';
    return '<div class="wq-card wq-hcard wq-hlast"><p class="wq-hlabel">' + esc(T.lastT) + '</p><h2 dir="auto">' + esc(l.topic) + '</h2>' +
      '<p class="wq-sub">' + meta + '</p>' + score + btn + '</div>';
  }
  function homeTiles() {
    return '<div class="wq-htiles">' +
      (B.lib ? '<a class="wq-htile" id="wq-h-lib" href="' + esc(withHome(B.lib.href)) + '">' + (B.lib.art ? '<img class="wq-htimg" src="' + esc(B.lib.art) + '" alt="" width="64" height="64">' : '<span class="wq-htic" aria-hidden="true">🎬</span>') + '<b>' + esc(T.vidT) + '</b><small>' + esc(T.vidSub) + '</small></a>' : '') +
      (B.challenge && B.challenge.on ? '<a class="wq-htile" id="wq-h-ch" href="/c/' + esc(withHome(encodeURIComponent(TOKEN) + '?kid=' + encodeURIComponent(B.kid) + '&lang=' + LANG)) + '"><span class="wq-htic" aria-hidden="true">⭐</span><b>' + esc(T.chT(MASC[LANG])) + '</b><small>' + esc(T.chSub) + '</small></a>' : '') +
      '</div>';
  }
  function hub() {
    var me = (B.kids || []).filter(function (k) { return k.chip === B.kid; })[0] || {};
    var HOME = Boolean(B.home_v);
    // With no teacher quiz the empty card already holds the library button: no second library tile.
    var tiles = (B.lib && B.teacher ? '<a class="wq-htile" id="wq-h-lib" href="' + esc(withHome(B.lib.href)) + '">' + (B.lib.art ? '<img class="wq-htimg" src="' + esc(B.lib.art) + '" alt="" width="64" height="64">' : '<span class="wq-htic" aria-hidden="true">📚</span>') + '<b>' + esc(T.libT) + '</b><small>' + esc(T.libSub) + '</small></a>' : '') +
      (B.challenge && B.challenge.on ? '<a class="wq-htile" id="wq-h-ch" href="/c/' + esc(withHome(encodeURIComponent(TOKEN) + '?kid=' + encodeURIComponent(B.kid) + '&lang=' + LANG)) + '"><span class="wq-htic" aria-hidden="true">⭐</span><b>' + esc(T.chT(MASC[LANG])) + '</b><small>' + esc(T.chSub) + '</small></a>' : '');
    var top = HOME
      ? lastCard(B.last) + homeTiles() + (B.teacher ? teacherCard(B.teacher) : '')
      : teacherCard(B.teacher) + (tiles ? '<div class="wq-htiles">' + tiles + '</div>' : '');
    render(bar() + jug('hello', T.hi(me.first || '')) + top +
      againList(B.again || []) + recList(B.recs || []) +
      ((B.kids || []).length > 1 ? '<button class="wq-btn wq-ghost" id="wq-h-switch">' + ani(me.animal) + ' ' + esc(T.switchKid) + '</button>' : ''), 'H2');
    on('#wq-h-teacher', function (e) { e.preventDefault(); go(this.getAttribute('href'), 'teacher'); });
    on('#wq-h-last', function (e) { e.preventDefault(); go(ROOT.querySelector('#wq-h-last').getAttribute('href'), 'last'); });
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
      location.assign(quizHref(r.body.code, { k: r.body.k }));
    }).catch(function () { starting = false; hub(); toast(T.oops); });
  }

  // Back from a quiz restores this page from the back/forward cache, mid "Opening…": make it live again.
  window.addEventListener('pageshow', function (e) {
    if (!e || !e.persisted) return;
    starting = false;
    if (B.locked) locked(); else if (B.kid) hub(); else if ((B.kids || []).length) picker();
  });

  /* ---------------- boot ---------------- */
  function boot() {
    ev('hub_view', { src: FROM_DOOR ? 'door' : FROM_HOME ? 'home' : B.kid ? 'hub' : 'who', i: (B.kids || []).length });
    if (FROM_DOOR || FROM_HOME) { FROM_DOOR = false; FROM_HOME = false; try { history.replaceState(null, '', '/h/' + TOKEN); } catch (e) {} }
    if (!(B.kids || []).length) render(bar() + jug('sleep', T.gone), 'H0');
    else if (!B.kid) picker();
    else hub();
  }
  if (LOCKED_BOOT) unlock(); else boot();
})();
