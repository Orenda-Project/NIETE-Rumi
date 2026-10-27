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
  // The language the page that sent the child here was in (?lang=en|ur, the door / the old class link): the bot
  // honours it over its guess (under web_quiz_challenge_v2), so the hub's own calls and address keep it. Else null.
  var URL_LANG = (/[?&]lang=(en|ur)(&|$)/.exec(String((typeof location !== 'undefined' && location.search) || '')) || [])[1] || null;
  // the grown-ups corner's language tap (keep=1): the server keeps it as the child's language (web_quiz_return_lang; off: ignored)
  var URL_KEEP = Boolean(URL_LANG) && /[?&]keep=1(&|$)/.test(String((typeof location !== 'undefined' && location.search) || ''));
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
      recT: 'Try these next', chT: function (m) { return m + '\'s Challenge'; }, chV3: function (m) { return m + '\'s games'; }, chSub: 'Short games for reading and numbers',
      switchKid: 'Switch player', oops: 'Something went wrong. Try again.', offline: 'No internet. Try again when you are online.',
      lockT: 'This link was sent to another player', lockSay: 'Ask the child who got this link to open it.',
      someone: 'Someone else / new player', newT: 'New here?', mineDoor: 'Finish your own quiz, then tap “My quizzes, videos and challenges”.',
      mine: 'Is this your link? Send /quiz on WhatsApp again for a new one.',
      newSay: 'Ask your teacher for a quiz link, or send /quiz on WhatsApp from your family\'s phone.',
      lastT: 'Your last quiz', cont: 'Continue', soFar: function (n) { return n ? n + (n === 1 ? ' question answered' : ' questions answered') : 'Not started yet'; },
      done: 'Finished', playAgain: 'Play again', vidT: 'Videos', vidSub: 'Watch one and try its quiz',
      wait: 'Opening…', noClass: 'Play a quiz from your teacher first.', gone: 'No quizzes here yet. Ask your teacher for a quiz link.', mins: function (m) { return m + ' min'; },
    },
    ur: {
      who: 'کس کی باری ہے؟', whoSay: 'اپنے نام پر ٹیپ کریں۔', hi: function (n) { return 'السلام علیکم ' + n + '! آج کیا کریں؟'; },
      fromT: 'آپ کے ٹیچر کی طرف سے', play: 'کھیلیں',
      sent: function (d) { return d <= 0 ? 'آج بھیجا گیا' : d === 1 ? 'کل بھیجا گیا' : '<bdi>' + d + '</bdi> دن پہلے بھیجا گیا'; },
      none: 'ابھی ٹیچر کی طرف سے کوئی نیا کوئز نہیں۔ ایک ویڈیو دیکھیں اور اس کا کوئز کریں!',
      againT: 'دوبارہ کھیلیں', againRow: function (score, n) { return 'بہترین ' + score + ' · <bdi>' + n + ' بار</bdi>'; },
      practice: 'مشق: ٹیچر کو آپ کا پہلا اسکور ہی نظر آتا ہے۔',
      libT: 'ویڈیو لائبریری', libSub: 'مضمون اور باب چنیں',
      recT: 'یہ بھی کریں', chT: function (m) { return m + ' کا چیلنج'; }, chV3: function (m) { return m + ' کے کھیل'; }, chSub: 'پڑھنے اور گنتی کے چھوٹے کھیل',
      switchKid: 'کھلاڑی بدلیں', oops: 'کچھ گڑبڑ ہو گئی۔ دوبارہ کوشش کریں۔', offline: 'انٹرنیٹ نہیں ہے۔ انٹرنیٹ آنے پر دوبارہ کوشش کریں۔',
      lockT: 'یہ لنک کسی اور کھلاڑی کو بھیجا گیا تھا', lockSay: 'جس بچے کو یہ لنک بھیجا گیا تھا، اُس سے کہیں کہ اسے کھولے۔',
      someone: 'کوئی اور / نیا کھلاڑی', newT: 'پہلی بار؟', mineDoor: 'اپنا کوئز مکمل کریں، پھر «میرے کوئز، ویڈیوز اور چیلنج» دبائیں۔',
      mine: 'کیا یہ آپ کا لنک ہے؟ نیا لنک لینے کے لیے واٹس ایپ پر دوبارہ ⁦/quiz⁩ بھیجیں۔',
      newSay: 'اپنے ٹیچر سے کوئز کا لنک لیں، یا گھر کے فون سے واٹس ایپ پر ⁦/quiz⁩ بھیجیں۔',
      lastT: 'آپ کا پچھلا کوئز', cont: 'جاری رکھیں', soFar: function (n) { return n ? '<bdi>' + n + '</bdi> سوالوں کے جواب دیے' : 'ابھی شروع نہیں کیا'; },
      done: 'مکمل', playAgain: 'دوبارہ کھیلیں', vidT: 'ویڈیوز', vidSub: 'ایک دیکھیں اور اس کا کوئز کریں',
      wait: 'کھل رہا ہے…', noClass: 'پہلے ٹیچر کا کوئی کوئز کھیلیں۔', gone: 'ابھی یہاں کوئی کوئز نہیں۔ ٹیچر سے کوئز کا لنک لیں۔', mins: function (m) { return m + ' منٹ'; },
    },
  };
  // The polished Urdu copy (app_settings web_quiz_ur_polish → the edge's `wq-ur2` class on <html>): a child's words, the name
  // first in the greeting. Off, COPY.ur is today's, untouched.
  var UR2_COPY = {
    whoSay: 'اپنا نام دبائیں۔', hi: function (n) { return '\u2068' + n + '\u2069، السلام علیکم! آج کیا کھیلیں؟'; },
    none: 'ابھی نیا کوئز نہیں۔ ایک ویڈیو دیکھیں اور اس کا کوئز کھیلیں!', practice: 'مشق۔ ٹیچر کو پہلا اسکور ہی دکھے گا۔',
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
  // The one button look (wq-tel.js WQT.oneButton): a home drawn from the page's own hub call (unlock, pick) takes the
  // look when that answer says so, as the boot's does. Off (no field): nothing changes.
  function look(b) { if (window.WQT && window.WQT.oneButton) window.WQT.oneButton(b); }
  // The pages' one link helper (wq-tel.js WQT.withLang, loaded first on every page): a link into another page carries lang=.
  function withLang(h, l) { return window.WQT && window.WQT.withLang ? window.WQT.withLang(h, l || LANG) : h; }
  // «واٹس ایپ» held on one line (wq-tel.js WQT.nowrap): escaped HTML in, the same HTML with the word held out.
  function nowrap(h) { return window.WQT && window.WQT.nowrap ? window.WQT.nowrap(h) : h; }
  // The hub's own address, with the language it was opened in when it was opened with one (else today's).
  function selfUrl(h) { return URL_LANG ? withLang(h, URL_LANG) : h; }
  // The home on: a door the link names (#stories, #games, #videos) stays on the tidied address, so the home opens it
  function doorHash() { var h = String((typeof location !== 'undefined' && location.hash) || ''); return B.home_v3 && /^#(stories|games|videos)$/.test(h) ? h : ''; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function on(sel, fn) { var el = ROOT.querySelector(sel); if (el) el.addEventListener('click', fn); return el; }
  function ani(a) { return '<span class="wq-ani">' + (ANIMALS[a] || '⭐') + '</span>'; }
  function subjectKey(s) { var k = String(s || '').trim(); return SUBJECT_KEY[k.toLowerCase()] || k; }
  function subjectName(s) { var k = subjectKey(s); return LANG === 'ur' && SUBJECT_UR[k] ? SUBJECT_UR[k] : k; }
  // The mascot, as on the quiz page (wq.js jugImg/jug): a still pose and the speech bubble.
  var JUG_DIR = '/wq/jugnu/';
  function jv(u) { return window.wqjv ? window.wqjv(u) : u; } // a Jugnu picture with its version (the page's wqjv, web_quiz_brotli on), else as is
  function jug(pose, line) {
    return '<div class="wq-jug"><span class="wq-jimg" data-jpose="' + pose + '"><img src="' + jv(JUG_DIR + pose + '.webp') + '" alt="" width="92" height="92"></span><div class="wq-say">' + esc(line) + '</div></div>';
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
  // web_quiz_wait_home (the boot's `wait_home`, with the designed wait): Home as the child last saw it is kept for this
  // hub in this tab, so the next open draws it at once from the early page (dashboard web-quiz-wait-ux.js homeTag),
  // inert, until this page draws the real one over it. Never a door, a story, a locked or a practice hub. The one look
  // class kept with it is the one-button look (`wq-1b`): the early page names what it added (`data-wqc`), and the real
  // draw takes that off again unless this answer still says `one_button`, so a look switched off since does not linger.
  var HOME_KEPT = 'wq_home:' + TOKEN;
  function uncache() {
    try {
      var cl = document.documentElement.classList;
      if (!cl.contains('wq-cached')) return;
      cl.remove('wq-cached');
      var de = document.documentElement;
      String(de.getAttribute('data-wqc') || '').split(' ').forEach(function (x) { if (x === 'wq-1b' && !(B && B.one_button === true)) cl.remove(x); });
      de.removeAttribute('data-wqc');
      ROOT.removeAttribute('inert');
      ROOT.removeAttribute('aria-busy');
    } catch (e) { /* no class list: nothing was drawn early */ }
  }
  function keepHome() {
    if (B.wait_home !== true || !B.home_v3 || !B.kid || B.practice || B.locked) return;
    var de = document.documentElement;
    if (String(location.hash || '').replace(/^#/, '') || de.classList.contains('wq-cached')) return;
    var h = ROOT.innerHTML;
    if (!h || h.length > 200000 || /class="wq-boot/.test(h)) return;
    var look = de.classList.contains('wq-1b') ? ['wq-1b'] : [];
    try { sessionStorage.setItem(HOME_KEPT, JSON.stringify({ t: Date.now(), l: LANG, k: B.kid, one: (B.kids || []).length === 1, c: look, h: h })); } catch (e) {}
  }
  window.addEventListener('pagehide', keepHome);
  // The adventure look: a tap on My class or My school (the quiz page's class table or league) keeps the hub's path for this
  // tab, so the land header there has a Home that comes back here (wq.js hubBack). Nothing with the look off.
  window.addEventListener('click', function (e) {
    try {
      var a = e.target && e.target.closest ? e.target.closest('a[data-social]') : null;
      if (a && document.documentElement.classList.contains('wq-adv') && /^\/h\/[A-Za-z0-9._-]+$/.test(location.pathname)) sessionStorage.setItem('wq_hub_at', location.pathname);
    } catch (x) {}
  }, true);
  function render(html, moment) {
    uncache();
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
    return fetch('/api/wq/' + path, init).then(answer);
  }
  function answer(r) {
    return r.text().then(function (t) { var j = null; try { j = t ? JSON.parse(t) : null; } catch (e) {} return { status: r.status, ok: r.ok, body: j || {} }; });
  }
  // web_quiz_early_unlock: the head already started this phone's first hub call (window.WQHUB0, web-quiz-early-unlock.js).
  // Used once, only when it asked exactly what this call asks for this token; a failed one is asked again.
  function early(body) {
    var e = window.WQHUB0;
    if (!e) return null;
    window.WQHUB0 = null;
    if (e.t !== TOKEN || e.b !== JSON.stringify(body) || !e.r || typeof e.r.then !== 'function') return null;
    return e.r.then(answer, function () { return api('POST', 'hub/' + encodeURIComponent(TOKEN), body); });
  }
  // This phone's device_ref: the same key the quiz page keeps it under (wq.js sget 'wq_d', JSON), so a
  // phone that opens the hub and then plays is one phone to the server. Minted here when there is none.
  // With no stored ref, a valid wq_dv cookie the server already gave this phone is adopted, never minted over.
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
    // No stored ref: a valid wq_dv the server already gave this phone is adopted (and kept), never minted over.
    try { var m = /(?:^|;\s*)wq_dv=([A-Za-z0-9_-]{22})(?:;|$)/.exec(document.cookie || ''); if (m) { try { localStorage.setItem('wq_d', JSON.stringify(m[1])); } catch (e) {} return keepCookie(m[1]); } } catch (e) {}
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
    if (URL_LANG) body.lang = URL_LANG;
    // keep=1 is asked once: the address loses it (lang stays), so Back or a bookmark never re-keeps an old choice
    if (URL_KEEP) {
      body.keep = 1;
      // the server keeps a choice only for the child the request names: the link's own kid when none is picked yet
      // (the server render had no device, so the page asks again as this phone before any pick)
      if (!body.kid) { var uk = (/[?&]kid=([^&#]+)/.exec(String((typeof location !== 'undefined' && location.search) || '')) || [])[1]; if (uk) { try { body.kid = decodeURIComponent(uk); } catch (e) { body.kid = uk; } } }
      URL_KEEP = false;
      try { history.replaceState(null, '', selfUrl('/h/' + TOKEN + (kid ? '?kid=' + encodeURIComponent(kid) : ''))); } catch (e) {}
    }
    return early(body) || api('POST', 'hub/' + encodeURIComponent(TOKEN), body);
  }
  // Events: ids and counts only (the server allow-lists every prop); hub_pick's "what" rides in `src`.
  function ev(n, props) {
    var e = { t: Date.now(), lang: LANG };
    if (props) for (var k in props) if (props[k] !== undefined) e[k] = props[k];
    e.n = n;
    // Page-session telemetry on (wq-tel.js): the event joins that page session's queue.
    if (window.WQT && window.WQT.push(e)) return;
    try {
      // The hub token and the picked chip when events v2 set them (batchIds below): on the body, never the event.
      var body = { events: [e] }, x = window.WQT && window.WQT.batchIds ? window.WQT.batchIds() : {}, k;
      for (k in x) body[k] = x[k];
      body = JSON.stringify(body);
      if (!(navigator.sendBeacon && navigator.sendBeacon('/api/wq/e', new Blob([body], { type: 'application/json' })))) {
        fetch('/api/wq/e', { method: 'POST', headers: { 'content-type': 'application/json' }, body: body, keepalive: true }).catch(function () {});
      }
    } catch (x) {}
  }
  function go(href, what) { ev('hub_pick', { src: what }); location.assign(href); }
  // Events v2 (B.ev2, the bot's web_quiz_events_v2): every event batch carries this hub's token and, once a child is
  // picked, that child's chip (wq-tel.js WQT.setIds), so the server can count each child. Off: nothing set.
  function batchIds(chip) {
    if (!B || B.ev2 !== true || !window.WQT || !window.WQT.setIds) return;
    window.WQT.setIds(chip ? { ht: TOKEN, chip: String(chip) } : { ht: TOKEN });
  }

  /* ---------------- H1 who is playing (only this phone's own children) ---------------- */
  function picker() {
    var kids = B.kids || [];
    batchIds(null);
    // keep my place (B.bind, web_quiz_phone_bind): "Who is playing?" in the ruled Urdu, and each chip's second line.
    if (B.bind && !window.WQBIND) bindIn();
    var KB = B.bind && window.WQBIND ? window.WQBIND : null;
    render(bar() + jug('hello', T.whoSay) + '<h2>' + esc(KB ? KB.t(LANG).whoPlaying : T.who) + '</h2><div class="wq-chips">' +
      kids.map(function (k) { return '<button class="wq-kid" data-chip="' + esc(k.chip) + '">' + ani(k.animal) + esc(k.first) + (KB ? KB.chipExtra(k, LANG) : '') + '</button>'; }).join('') + '</div>', 'H1');
    Array.prototype.forEach.call(ROOT.querySelectorAll('[data-chip]'), function (b) {
      b.addEventListener('click', function () { pick(b.getAttribute('data-chip')); });
    });
  }
  function pick(chip) {
    render(bar() + '<div class="wq-boot"><img src="' + jv(JUG_DIR + 'thinking.webp') + '" alt="" width="96"><p class="wq-bootsay">' + esc(T.wait) + '</p></div>', 'H1-wait');
    hubFor(chip).then(function (r) {
      // An expired or forged link: the server's closed page says what to do (never "No internet").
      if (r.status === 401) { location.reload(); return; }
      if (r.ok && r.body && r.body.locked) { locked(); return; }
      if (!r.ok || !r.body || !r.body.kid) throw new Error('hub_' + r.status);
      var kids = B.kids;
      B = r.body; B.token = TOKEN; B.brand = BR; B.kids = B.kids && B.kids.length ? B.kids : kids;
      look(B);
      setLang(B.lang || LANG);
      try { history.replaceState(null, '', selfUrl('/h/' + TOKEN + '?kid=' + encodeURIComponent(chip)) + doorHash()); } catch (e) {}
      hub();
    }).catch(function (e) { toast(e && /^hub_/.test(e.message) ? T.oops : T.offline); picker(); });
  }

  /* ---------------- H-lock: a forwarded link (another phone) — never a name, never a play ---------------- */
  function locked() {
    batchIds(null);
    B = { lang: LANG, token: TOKEN, brand: BR, locked: true, kids: [] };
    render(bar() + jug('thinking', T.lockSay) + '<h2>' + esc(T.lockT) + '</h2>' +
      '<p class="wq-sub">' + esc(T.mineDoor) + '</p>' +
      '<p class="wq-sub">' + nowrap(esc(T.mine)) + '</p>' +
      '<button class="wq-btn wq-ghost" id="wq-h-new">' + esc(T.someone) + '</button>', 'H-lock');
    on('#wq-h-new', function () { newPlayer(); });
  }
  function newPlayer() {
    ev('hub_pick', { src: 'new' });
    render(bar() + nowrap(jug('hello', T.newSay)) + '<h2>' + esc(T.newT) + '</h2>', 'H-new');
  }
  // The server render has no device: ask again as this phone, then show what the bot allows.
  function unlock() {
    render(bar() + '<div class="wq-boot"><img src="' + jv(JUG_DIR + 'hello.webp') + '" alt="" width="96"><p class="wq-bootsay">' + esc(T.wait) + '</p></div>', 'H0-wait');
    hubFor(null).then(function (r) {
      if (r.status === 401) { location.reload(); return; }
      if (!r.ok || !r.body) throw new Error('hub_' + r.status);
      if (r.body.locked) { locked(); return; }
      B = r.body; B.token = TOKEN; B.brand = BR;
      look(B);
      // Only a hub for one child carries that child's language; with no child picked the bot's lang is a
      // default, and the server render's (from this family's children) stays.
      if (B.kid) setLang(B.lang || LANG);
      if (B.play && B.play.install) manifestIn();
      boot();
    }).catch(function (e) { toast(e && /^hub_/.test(e.message) ? T.oops : T.offline); locked(); });
  }

  // The install manifest has the same first-open gap: renderHubPage writes <link rel="manifest"> only on an unlocked
  // render with play.install. Added once, with the server's href (this hub's token, ?kid= for a 16-hex chip).
  function manifestIn() {
    try {
      if (document.querySelector('link[rel="manifest"]')) return;
      var l = document.createElement('link');
      l.rel = 'manifest';
      l.href = '/h/' + TOKEN + '/manifest.webmanifest' + (B.kid && /^[0-9a-f]{16}$/.test(B.kid) ? '?kid=' + B.kid : '');
      document.head.appendChild(l);
    } catch (e) {}
  }

  /* ---------------- H2 the hub ---------------- */
  // The Jugnu corner's script when the server render had no `play`: a child's first open has no wq_dv cookie yet,
  // so the render was the locked one and the edge left hub-play.js out; unlock() then brings `play`. Loaded once,
  // at hub.js's own ?v=, and the hub drawn again when it arrives (still on the hub, still with `play`); arriving on
  // another screen, the next hub drawn finds it. A failed load is counted once (hub_play_load_failed) and asked for
  // again once per page: at once while the hub is shown, else by the next hub drawn; a second failure leaves the hub
  // without the corner.
  var playFails = 0;
  function playIn() {
    loadOnce('hub-play', false, function () { if (window.WQPLAY && B.play && ROOT.getAttribute('data-m') === 'H2') hub(); }, null, function () {
      playFails += 1;
      if (playFails > 1) return;
      asked['hub-play'] = false;
      ev('hub_play_load_failed', { file: 'hub-play.js', i: playFails });
      if (B.play && ROOT.getAttribute('data-m') === 'H2') playIn();
    });
  }
  // The keep-my-place card's script (wq-bind.js/.css) has the same gap: the edge's bindTags decides before the device
  // is known, so a first open's locked render leaves it out and unlock() then brings `bind`. Loaded once, at hub.js's
  // own ?v=, and the screen that uses it (the hub, or "Who is playing?") drawn again when it arrives.
  function bindIn() {
    loadOnce('wq-bind', true, function () {
      if (!window.WQBIND || !B.bind) return;
      var m = ROOT.getAttribute('data-m');
      if (m === 'H2') hub(); else if (m === 'H1') picker();
    });
  }
  // The one lazy loader (the Jugnu corner, keep my place, Jugnu's Book): /wq/<name>.js (and, with css, /wq/<name>.css
  // before it) at hub.js's own ?v=, asked for at most once per page, with onload attached once, when the tag is made,
  // however often the hub is drawn again while it loads. A failure leaves the page as it is (onerror, when given, is told).
  var asked = {};
  function loadOnce(name, css, onload, id, onerror) {
    if (asked[name]) return;
    asked[name] = true;
    try {
      var me = document.querySelector('script[src*="/wq/hub.js"]');
      var v = me && /[?&]v=([A-Za-z0-9]+)/.exec(me.getAttribute('src') || '');
      var q = v ? '?v=' + v[1] : '';
      if (css) { var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = '/wq/' + name + '.css' + q; document.head.appendChild(l); }
      var s = document.createElement('script');
      if (id) s.id = id;
      s.src = '/wq/' + name + '.js' + q;
      s.addEventListener('load', onload);
      if (onerror) s.addEventListener('error', onerror);
      document.head.appendChild(s);
    } catch (e) {}
  }
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
      (B.challenge && B.challenge.on ? '<a class="wq-htile" id="wq-h-ch" href="/c/' + esc(withHome(withLang(encodeURIComponent(TOKEN) + '?kid=' + encodeURIComponent(B.kid)))) + '"><span class="wq-htic" aria-hidden="true">⭐</span><b>' + esc((B.home_v3 ? T.chV3 : T.chT)(MASC[LANG])) + '</b><small>' + esc(T.chSub) + '</small></a>' : '') +
      '</div>';
  }
  // The v3 child home (B.home_v3, web_quiz_home_v3): wq-home.js draws the whole page; a failed load draws today's hub.
  // With B.home_fb (web_quiz_home_fallback_v3) a failed load is asked for once more, at the same address, 1.5 s later,
  // and a second failure draws the plain home (homeFb), never today's hub; each failure is counted (home_load_failed).
  // An ask that neither loads nor fails within 5 s is a failure; a script that still arrives later draws the v3 home,
  // once: the first arrival mounts it, a later one (both asks out) only puts the first copy back, and once it is here no
  // retry is asked and a late failure of the other ask is not one.
  var homeFail = false, homeTries = 0, homeIn = null;
  function homeAsk(css) {
    var done = false;
    function fail() { if (done) return; done = true; homeErr(); }
    loadOnce('wq-home', css, function () { done = true; if (homeIn) { window.WQHOME = homeIn; return; } homeIn = window.WQHOME; hub(); }, null, fail);
    if (B.home_fb) setTimeout(fail, 5000);
  }
  function homeErr() {
    if (homeIn) return;
    homeTries += 1;
    if (B.home_fb) ev('home_load_failed', { file: 'wq-home.js', i: homeTries });
    if (B.home_fb && homeTries < 2) { setTimeout(function () { if (window.WQHOME) return; asked['wq-home'] = false; homeAsk(false); }, 1500); return; }
    homeFail = true; hub();
  }
  // The plain home: the greeting as the v3 home says it, the three doors as plain links in the bar's words and order, and
  // one line that reloads the page. A door opens what the payload names (Games: its first row; Videos: the library), else
  // this home at that door (#stories: the shelf lives in the home's own scripts), by a reload.
  var FB = {
    en: { hi: function (n) { return n ? 'Hi ' + n + '!' : 'Hi!'; }, cls: function (n) { return 'Class ' + n; }, doors: ['Stories', 'Games', 'Videos'], retry: 'The page is still opening… tap here to try again.' },
    ur: { hi: function (n) { return n ? '\u2068' + n + '\u2069، السلام علیکم!' : 'السلام علیکم!'; }, cls: function (n) { return 'کلاس ' + String(n).replace(/[0-9]/g, function (d) { return String.fromCharCode(0x06F0 + Number(d)); }); },
      doors: ['کہانیاں', 'کھیل', 'ویڈیوز'], retry: 'صفحہ ابھی کھل رہا ہے… دوبارہ کوشش کے لیے یہاں ٹیپ کریں۔' },
  };
  function fbHref(d) {
    var D = B.doors || {}, g = (D.games || [])[0], v = D.videos;
    // a look-only preview opens no door here; one that plays (practice_play) opens the games page as a child's does
    if (!(B.practice && !B.practice_play) && d === 'games' && g) return g.kind === 'numbers' ? withHome(withLang('/c/' + encodeURIComponent(TOKEN) + '?kid=' + encodeURIComponent(B.kid || ''))) : quizHref(g.code, { again: g.done ? '1' : '', k: g.k });
    if (!B.practice && d === 'videos' && v && v.href) return withHome(v.href);
    return '#' + d;
  }
  function homeFb() {
    var t = FB[LANG], me = (B.kids || []).filter(function (k) { return k.chip === B.kid; })[0] || {};
    render(jug('hello', B.practice ? t.cls(Number(B.grade) || '') : t.hi(me.first || '')) + '<nav class="wq-fbdoors" style="display:grid;gap:12px;margin:8px 0 20px">' + ['stories', 'games', 'videos'].map(function (d, i) {
      return '<a class="wq-btn wq-soft wq-fbdoor" data-door="' + d + '" href="' + esc(fbHref(d)) + '">' + esc(t.doors[i]) + '</a>';
    }).join('') + '</nav><button class="wq-btn wq-go" type="button" id="wq-fb-retry" data-primary>' + esc(t.retry) + '</button>', 'H3-fb');
    on('#wq-fb-retry', function () { location.reload(); });
    Array.prototype.forEach.call(ROOT.querySelectorAll('.wq-fbdoor'), function (a) {
      a.addEventListener('click', function (e) { var h = a.getAttribute('href') || ''; if (h.charAt(0) !== '#') return; e.preventDefault(); location.hash = h; location.reload(); });
    });
  }
  function hub() {
    batchIds(B.kid);
    storyIn();
    if (B.home_v3 && (!homeFail || (B.home_fb && window.WQHOME))) {
      if (window.WQHOME) {
        uncache();
        if (B.wait_home === true) setTimeout(keepHome, 2500);
        return window.WQHOME.mount(ROOT, B, { token: TOKEN, lang: LANG, ev: ev, go: go });
      }
      return homeAsk(!(B.home_fb && document.querySelector('link[href*="/wq/wq-home.css"]')));
    }
    if (B.home_v3 && B.home_fb) return homeFb();
    var me = (B.kids || []).filter(function (k) { return k.chip === B.kid; })[0] || {};
    var HOME = Boolean(B.home_v);
    // With no teacher quiz the empty card already holds the library button: no second library tile.
    var tiles = (B.lib && B.teacher ? '<a class="wq-htile" id="wq-h-lib" href="' + esc(withHome(B.lib.href)) + '">' + (B.lib.art ? '<img class="wq-htimg" src="' + esc(B.lib.art) + '" alt="" width="64" height="64">' : '<span class="wq-htic" aria-hidden="true">📚</span>') + '<b>' + esc(T.libT) + '</b><small>' + esc(T.libSub) + '</small></a>' : '') +
      (B.challenge && B.challenge.on ? '<a class="wq-htile" id="wq-h-ch" href="/c/' + esc(withHome(withLang(encodeURIComponent(TOKEN) + '?kid=' + encodeURIComponent(B.kid)))) + '"><span class="wq-htic" aria-hidden="true">⭐</span><b>' + esc((B.home_v3 ? T.chV3 : T.chT)(MASC[LANG])) + '</b><small>' + esc(T.chSub) + '</small></a>' : '');
    // A first open's server render was locked (no wq_dv cookie yet), so the edge left hub-play.js out: load it now.
    if (B.play && !window.WQPLAY) playIn();
    if (B.bind && !window.WQBIND) bindIn();
    // keep my place's mount (wq-bind.js): under the greeting, or right after the Jugnu card when that leads.
    var slot = B.bind && window.WQBIND ? '<div id="wq-bind-slot"></div>' : '';
    // The Jugnu corner (hub-play.js, loaded only when the server sent `play`): it may put the Jugnu card first.
    var top = B.play && window.WQPLAY
      ? window.WQPLAY.top(B, T, { afterJug: slot, HOME: HOME, lastCard: lastCard(B.last), homeTiles: homeTiles(), teacher: B.teacher ? teacherCard(B.teacher) : '', teacherAny: teacherCard(B.teacher), tiles: tiles, LANG: LANG, MASC: MASC, chHref: '/c/' + withHome(withLang(encodeURIComponent(TOKEN) + '?kid=' + encodeURIComponent(B.kid))), ROOT: ROOT, ev: ev })
      : HOME
        ? lastCard(B.last) + homeTiles() + (B.teacher ? teacherCard(B.teacher) : '')
        : teacherCard(B.teacher) + (tiles ? '<div class="wq-htiles">' + tiles + '</div>' : '');
    render(bar() + jug('hello', T.hi(me.first || '')) + (slot && top.indexOf('id="wq-bind-slot"') < 0 ? slot : '') + top +
      againList(B.again || []) + recList(B.recs || []) +
      ((B.kids || []).length > 1 ? '<button class="wq-btn wq-ghost" id="wq-h-switch">' + ani(me.animal) + ' ' + esc(T.switchKid) + '</button>' : ''), 'H2');
    on('#wq-h-teacher', function (e) { e.preventDefault(); go(this.getAttribute('href'), 'teacher'); });
    on('#wq-h-last', function (e) { e.preventDefault(); go(ROOT.querySelector('#wq-h-last').getAttribute('href'), 'last'); });
    on('#wq-h-lib', function (e) { e.preventDefault(); go(this.getAttribute('href'), 'lib'); });
    on('#wq-h-lib2', function (e) { e.preventDefault(); go(this.getAttribute('href'), 'lib'); });
    on('#wq-h-ch', function (e) { e.preventDefault(); go(this.getAttribute('href'), 'challenge'); });
    on('#wq-h-switch', function () { picker(); });
    // keep my place: the card for the chosen child (wq-bind.js; never on a practice hub).
    if (B.bind && B.bind.offer && window.WQBIND) window.WQBIND.card(document.getElementById('wq-bind-slot'), { hub: B.bind.hub || TOKEN, kid: B.kid, first: me.first || '', lang: LANG, practice: B.mode === 'practice', ev: ev });
    if (B.book_on) bookIn();
    // Jugnu's Book (wq-book.js/.css, web_quiz_challenge_book): loaded on first use, at hub.js's own ?v=, then its tile and lights line.
    function bookIn() {
      var go = function () { if (window.WQBOOK) window.WQBOOK.hubLine(B, { root: ROOT, token: TOKEN, lang: LANG, ev: ev, back: hub }); };
      if (window.WQBOOK) return go();
      loadOnce('wq-book', true, go, 'wq-bk-js');
    }
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

  // A story link (#story/<id>, a teacher's class link) without the v3 home, stories on (`stories.on`): the reader
  // (wq-stories.js) is fetched once and opens the book; leaving it draws the hub again. Switch off: nothing runs.
  var inStory = false, storyWired = false;
  // The reader takes its child from WQSTORIES_CTX before the page's boot JSON, which a first open rendered locked (no child).
  function storyIn() {
    if (!(B.stories && B.stories.on && B.kid)) return;
    window.WQSTORIES_CTX = { token: TOKEN, kid: B.kid, lang: LANG };
    if (B.home_v3 && !homeFail) return;
    if (!storyWired) { storyWired = true; window.addEventListener('hashchange', storyIn); }
    var was = inStory;
    inStory = /^#story\//.test(location.hash || '');
    if (inStory) { if (!window.WQSTORIES) loadOnce('wq-stories', true); }
    else if (was) hub();
  }

  /* ---------------- boot ---------------- */
  function boot() {
    batchIds(B.kid);
    ev('hub_view', { src: FROM_DOOR ? 'door' : FROM_HOME ? 'home' : B.kid ? 'hub' : 'who', i: (B.kids || []).length });
    if (FROM_DOOR || FROM_HOME) { FROM_DOOR = false; FROM_HOME = false; try { history.replaceState(null, '', selfUrl('/h/' + TOKEN) + doorHash()); } catch (e) {} }
    if (B.home_v3 && B.practice) hub(); // a coach's class preview (web_quiz_home_v3): the home by grade, no child
    else if (!(B.kids || []).length) render(bar() + jug('sleep', T.gone), 'H0');
    else if (!B.kid) picker();
    else hub();
  }
  // The home's pack (B.pack, web_quiz_pack): a pack file that fails to load is counted here with ev() itself, once per
  // file, before or after this runs (its tag's error handler queues it in WQPACKERR and calls WQPACKEV); homeErr()
  // counts only the home's own asks, and not once the home is in.
  if (B.pack === true || window.WQPACKERR) {
    window.WQPACKEV = function () { var q = window.WQPACKERR || []; window.WQPACKERR = []; for (var i = 0; i < q.length; i++) ev('home_load_failed', { file: q[i] }); };
    window.WQPACKEV();
  }
  if (LOCKED_BOOT) unlock(); else if (!(window.WQLISTEN && WQLISTEN.take(boot, render, bar))) boot();
})();
