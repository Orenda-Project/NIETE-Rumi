/*
 * Live reading v3 (window.WQLiveRead; needs wq-read-live.js for the scorer's own word rules). Loaded by a page only when
 * the bot says so (the read payload's / menu's `lr3`, app_settings web_quiz_live_read_v3).
 *
 *   matcher(words, lang)          transcript tokens → passage words. Both sides folded: case, punctuation, diacritics,
 *                                 Urdu letter forms (WQLive.clean), and numerals — digits, Urdu / Arabic-Indic digits and
 *                                 number words are one word ("3" = "three" = "۳" = "تین"). The child reads a PREFIX: a
 *                                 word passed over is `skipped` (never wrong), an extra or repeated word costs nothing.
 *                                 States per word: read (heard, final) · heard (not final yet) · skipped · current · ahead
 *   shouldFinish(v, now, lastAt, f)   'last_word' | 'quiet' | null — the last word heard, f.tail_ms (1 s)
 *                                 after it; or ≥ f.pct of the words heard and f.quiet_ms (4 s) with no new word (never
 *                                 when f.quiet is false: a counted read)
 *   glowLevel(v)                  0–4: Jugnu's glow, by the share of words lit — never by speed, never a number
 *   result(v, o)                  the result object handed to the card (no transcript in it, never a rate: wpm is null)
 *   emit(result)                  window event `wq:liveread:result` (the finish card listens)
 *   mount(el, o)                  the whole reading on one element (a story page): words, Done, the stream, the finish
 *                                 rules, the fallback; → { stop(reason), destroy() }. A counted mount (o.counted): a quiet
 *                                 "Stop for now" from the first second, "I'm done" only once o.doneFrom (0.8) of the words are lit
 *   askMic(el, o)                 the microphone sheet that works in WhatsApp's in-app browser on Android (below)
 *   noticeSeen / noticeMark / noticeText   the microphone notice: one mark per child per phone, on the first reading with
 *                                 the microphone wherever it is (the storybook's sheet, or the Trail's notice screen)
 *   doneHtml(copy)                the one Done label: "I'm done" / «میں نے پڑھ لیا» and a drawn tick
 *   wordTaps(el, marks, playWord) after a practice reading: a skipped word is a tap that says it (o.playWord on mount)
 * The sound kit (window.WQJ, when the page has it): WQJ.mic(true|false) around the microphone, and on a practice read
 * WQJ.word({i, ok}) per word newly lit and WQJ.sentence() at a sentence's last word; never on a counted read.
 * One green on screen: a word heard and a word read draw the same (the difference lives in the result only).
 * No framework, no build step. Nothing here keeps or sends the child's words anywhere but the speech service.
 */
(function () {
  'use strict';
  var W = window.WQLive;

  // ── numerals: every spelling of a number is one word ─────────────────────────────────────────────
  var NUM_EN = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty'.split(' ');
  var TENS_EN = { thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100 };
  var NUM_UR = 'صفر ایک دو تین چار پانچ چھ سات آٹھ نو دس گیارہ بارہ تیرہ چودہ پندرہ سولہ سترہ اٹھارہ انیس بیس'.split(' ');
  var TENS_UR = { 'تیس': 30, 'چالیس': 40, 'پچاس': 50, 'ساٹھ': 60, 'ستر': 70, 'اسی': 80, 'نوے': 90, 'سو': 100 };
  var NUMS = {};
  function addNum(w, n) { NUMS[W.clean(w)] = String(n); }
  NUM_EN.forEach(addNum); NUM_UR.forEach(addNum);
  Object.keys(TENS_EN).forEach(function (k) { addNum(k, TENS_EN[k]); });
  Object.keys(TENS_UR).forEach(function (k) { addNum(k, TENS_UR[k]); });
  var DIGITS = /[۰-۹٠-٩]/g;
  function digit(c) { var k = c.charCodeAt(0); return String(k >= 0x06F0 ? k - 0x06F0 : k - 0x0660); }

  /** One word as the matcher sees it. */
  function fold(w) {
    var s = W.clean(String(w == null ? '' : w).replace(DIGITS, digit));
    return NUMS[s] || s;
  }

  function hypWords(text) {
    var out = []; var rx = /\S+/g; var m;
    while ((m = rx.exec(text))) { var f = fold(m[0]); if (f) out.push({ w: f, end: m.index + m[0].length }); }
    return out;
  }

  // ── the matcher ──────────────────────────────────────────────────────────────────────────────────
  function matcher(words) {
    var raw = (words || []).map(String).filter(function (x) { return x.trim(); });
    var ref = raw.map(fold);
    var st = { F: '', N: '', fin: [], done: false };
    function view() {
      var hw = hypWords(st.F + st.N);
      var hyp = hw.map(function (x) { return x.w; });
      var final = hw.map(function (x) { return x.end < st.F.length || (x.end === st.F.length && (st.done || !st.N || /^\s/.test(st.N))); });
      var a = W.alignPrefix(ref, hyp);
      var reached = 0; var i;
      for (i = 0; i < ref.length; i += 1) if (a.status[i] !== 'omit' && a.hypIdx[i] >= 0) reached = i + 1;
      var states = []; var read = 0; var heard = 0; var skipped = 0; var cur = -1;
      for (i = 0; i < ref.length; i += 1) {
        var ok = a.status[i] === 'correct';
        if (ok && final[a.hypIdx[i]]) { states.push('read'); read += 1; heard += 1; }
        else if (ok) { states.push('heard'); heard += 1; }
        else if (i < reached) { states.push('skipped'); skipped += 1; }
        else { if (cur < 0) cur = i; states.push(cur === i ? 'current' : 'ahead'); }
      }
      var last = ref.length - 1;
      var lastHeard = last >= 0 && (states[last] === 'read' || states[last] === 'heard');
      var endMs = null;
      for (var k = 0; k < st.fin.length; k += 1) endMs = st.fin[k].endMs;
      return { states: states, read: read, heard: heard, skipped: skipped, total: ref.length, current: cur, lastHeard: lastHeard, endMs: endMs, any: hyp.length > 0 };
    }
    return {
      words: raw,
      /** One Soniox message's tokens: finals are appended for good; the non-finals replace the last ones. */
      push: function (tokens) {
        var nf = '';
        (tokens || []).forEach(function (t) {
          var tx = String((t && t.text) || '');
          if (tx === '<fin>' || tx === '<end>') return;
          if (t.is_final) { st.fin.push({ endMs: Number(t.end_ms) || 0 }); st.F += tx; } else nf += tx;
        });
        st.N = nf;
        return view();
      },
      end: function () { st.F += st.N; st.N = ''; st.done = true; return view(); },
      view: view,
    };
  }

  // ── the finish rules: the last word, or most of the passage then a quiet ───────────────────────────────────────────────────────────────
  var QUIET_MS = 4000;
  var TAIL_MS = 1000;
  function shouldFinish(v, now, lastAt, f) {
    if (!v || !(v.total > 0)) return null;
    var o = f || {};
    if (v.lastHeard) return now - lastAt >= (typeof o.tail_ms === 'number' ? o.tail_ms : TAIL_MS) ? 'last_word' : null;
    if (o.quiet === false) return null;
    var pct = typeof o.pct === 'number' ? o.pct : 0.8;
    var quiet = typeof o.quiet_ms === 'number' ? o.quiet_ms : QUIET_MS;
    if (v.heard / v.total >= pct && now - lastAt >= quiet) return 'quiet';
    return null;
  }
  function glowLevel(v) {
    if (!v || !(v.total > 0) || !(v.heard > 0)) return 0;
    return Math.min(4, 1 + Math.floor(4 * v.heard / v.total));
  }

  // ── the result (no transcript, never a rate) and its hand-off ────────────────────────────────────────────────────
  function result(v, o) {
    var x = o || {};
    var ms = Math.max(0, Math.round(x.ms || 0));
    var counted = !!x.counted;
    var marks = (v.states || []).map(function (s) { return s === 'read' || s === 'heard' ? 'read' : (s === 'skipped' ? 'skipped' : 'ahead'); });
    return {
      v: 1, source: x.source || 'passage', id: x.id == null ? null : x.id, lang: x.lang === 'ur' ? 'ur' : 'en',
      words_total: v.total, words_read: v.heard, correct: v.read, skipped: v.skipped,
      wpm: null,
      ms: ms, ended: x.ended || 'done_tap', marks: marks, counted: counted, live: x.live !== false,
    };
  }
  function emit(r) {
    try {
      if (typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') window.dispatchEvent(new CustomEvent('wq:liveread:result', { detail: r }));
    } catch (e) { /* an old WebView: the callback is the hand-off */ }
  }

  // ── the sound kit (wq-juice.js, when loaded): every call a no-op without it ───────────────────────
  function juice(name, arg) {
    var J = window.WQJ;
    if (!J || typeof J[name] !== 'function') return;
    try { J[name](arg); } catch (e) { /* a sound never breaks a reading */ }
  }
  var SENTENCE_END = /[.!?۔؟]["'”’)]*$/;
  /** Practice reads only: a tink per word newly lit (in order), the sentence chime at a sentence's last word. */
  function juiceWords(words, before, after, counted) {
    if (counted || !window.WQJ) return;
    for (var i = 0; i < after.length; i += 1) {
      var was = before && (before[i] === 'read' || before[i] === 'heard' || before[i] === 'ok' || before[i] === 'okp');
      var now = after[i] === 'read' || after[i] === 'heard' || after[i] === 'ok' || after[i] === 'okp';
      if (now && !was) {
        juice('word', { i: i, ok: true });
        if (SENTENCE_END.test(String(words[i] || ''))) juice('sentence');
      }
    }
  }

  /**
   * After a PRACTICE reading has ended: a word marked skipped becomes a tap that says it (the host's read-along player,
   * playWord(i): 0 bytes, 0 calls). Never during the reading (the microphone would hear Jugnu say it and could light a
   * word the child never read) and never after a counted one. el holds the words as [data-i] spans.
   */
  function wordTaps(el, marks, playWord) {
    if (!el || !el.addEventListener || typeof playWord !== 'function' || !marks) return false;
    el.addEventListener('click', function (e) {
      var t = e && e.target;
      var i = t && t.getAttribute ? Number(t.getAttribute('data-i')) : NaN;
      if (Number.isInteger(i) && marks[i] === 'skipped') { try { playWord(i); } catch (x) { /* the word stays silent */ } }
    });
    return true;
  }

  // ── copy (EN + UR; no test words; gender-neutral) ────────────────────────────────────────────────
  var COPY = {
    // one Done label on every reading surface (practice from the first second, counted from 80 % lit)
    en: { done: 'I\'m done', doneAsk: 'Done?', checking: 'Listening…', readNow: 'Read it aloud!', keepGoing: 'Keep going!', wellRead: 'Well read!',
      micAsk: 'Tap the button so Jugnu can hear you read.', micGo: 'Start reading', chrome: 'Open in Chrome', listen: 'Listen with Jugnu instead',
      notNow: 'Not now, just listen', stop: 'Stop for now', grownUps: 'For grown-ups', okListen: 'That\'s OK, let\'s listen with Jugnu.',
      osAsk: 'When the phone asks, tap Allow.', rest: 'Jugnu\'s ears need a rest. Let\'s listen to this one together!',
      facts: 'The voice is heard only to light up the words as they are read. On a story page nothing is kept. “Not now, just listen” works at any time.',
      // the microphone notice (once per child per phone, the first reading with the microphone anywhere): keep = Jugnu keeps
      // its passage recordings (web_quiz_challenge_keep_audio; no automatic deletion; STOP removes the phone link only)
      noticeKept: 'For grown-ups: Jugnu keeps the recordings of its reading passages, with no end date yet. Only the people who make Jugnu can listen, to help Jugnu hear children better. Story pages are never kept. Sending STOP on WhatsApp removes this phone number; recordings already kept stay.',
      noticeNone: 'Nothing is kept. Jugnu listens only while you read.' },
    ur: { done: 'میں نے پڑھ لیا', doneAsk: 'ہو گیا؟', checking: 'آپ کی آواز سنی جا رہی ہے…', readNow: 'اونچی آواز میں پڑھیں!', keepGoing: 'پڑھتے رہیں!', wellRead: 'بہت خوب پڑھا!',
      micAsk: 'بٹن دبائیں تاکہ جگنو آپ کو پڑھتے ہوئے سن سکے۔', micGo: 'پڑھنا شروع کریں', chrome: 'کروم میں کھولیں', listen: 'جگنو سے سن لیں',
      notNow: 'ابھی نہیں، صرف سنیں', stop: 'ابھی کے لیے بس', grownUps: 'بڑوں کے لیے', okListen: 'کوئی بات نہیں۔ آئیں، جگنو سے سنتے ہیں۔',
      osAsk: 'جب فون پوچھے تو «اجازت دیں» (\u2066Allow\u2069) دبائیں۔', rest: 'جگنو کے کانوں کو اب تھوڑا آرام چاہیے۔ آئیں، یہ کہانی مل کر سنتے ہیں!',
      facts: 'آواز صرف پڑھتے وقت الفاظ کو روشن کرنے کے لیے سنی جاتی ہے۔ کہانی کے صفحے پر کچھ بھی محفوظ نہیں ہوتا۔ «ابھی نہیں، صرف سنیں» کسی بھی وقت دبا سکتے ہیں۔',
      noticeKept: 'بڑوں کے لیے: جگنو کی عبارتیں پڑھنے کی ریکارڈنگ جگنو رکھتا ہے، اور ابھی یہ طے نہیں کہ کب تک رکھے گا۔ یہ ریکارڈنگ صرف جگنو بنانے والے لوگ سن سکتے ہیں، تاکہ جگنو بچوں کی آواز بہتر سمجھ سکے۔ کہانی کے صفحوں کی ریکارڈنگ کبھی نہیں رکھی جاتی۔ واٹس ایپ پر \u2066STOP\u2069 بھیجنے سے یہ فون نمبر ہٹا دیا جاتا ہے، لیکن جو ریکارڈنگ پہلے سے رکھی جا چکی ہے وہ موجود رہتی ہے۔',
      noticeNone: 'کچھ بھی نہیں رکھا جاتا۔ جگنو صرف اسی وقت سنتا ہے جب آپ پڑھ رہے ہوں۔' },
  };
  // the controls' glyphs are drawn, never a font character (a ✓ or an emoji falls into the Nastaliq face)
  var TICK = '<svg class="lr-tick" viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" focusable="false"><path d="M3 8.5l3.2 3.2L13 4.8" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  var MIC = '<svg class="lr-mic" viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" focusable="false"><rect x="5.5" y="1.5" width="5" height="8.5" rx="2.5" fill="currentColor"/><path d="M3 7.5a5 5 0 0 0 10 0M8 12.5v2.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>';
  // the phone's own permission prompt, as a picture: a box with a microphone and two buttons, the one to tap ringed
  var OS_PIC = '<svg class="lr-os" viewBox="0 0 200 96" width="200" height="96" role="img" aria-hidden="true" focusable="false">'
    + '<rect x="2" y="2" width="196" height="92" rx="12" fill="#fff" stroke="#9aa5b1" stroke-width="2"/>'
    + '<rect x="90" y="12" width="20" height="28" rx="10" fill="#1f2a37"/><path d="M82 30a18 18 0 0 0 36 0M100 48v8" fill="none" stroke="#1f2a37" stroke-width="3" stroke-linecap="round"/>'
    + '<rect x="18" y="64" width="72" height="20" rx="10" fill="#e5e7eb"/><rect x="110" y="64" width="72" height="20" rx="10" fill="#15803D"/>'
    + '<rect x="104" y="58" width="84" height="32" rx="16" fill="none" stroke="#15803D" stroke-width="3" stroke-dasharray="5 4"/></svg>';
  /** The one Done label: "I'm done" / «میں نے پڑھ لیا» and a drawn tick. */
  function doneHtml(t) { return esc(t.done) + ' ' + TICK; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // ── the microphone notice: ONE mark per child per phone (wq_notice_v:<chip>, the key the Trail's notice keeps), shown on
  //    the first reading with the microphone wherever it is — the storybook's sheet or Jugnu's passage — never again. The
  //    mark says which words were shown: a kept notice covers everything; a "nothing kept" one does not cover a kept one.
  var NOTICE_KEY = 'wq_notice_v:';
  var NOTICE_KEPT = 'lr3k';
  var NOTICE_NONE = 'lr3n';
  function noticeSeen(kid, keep) {
    if (!kid) return false;
    var v = null;
    try { v = window.localStorage.getItem(NOTICE_KEY + kid); } catch (e) { return false; }
    return v === NOTICE_KEPT || (!keep && v === NOTICE_NONE);
  }
  function noticeMark(kid, keep) {
    if (!kid) return;
    try { window.localStorage.setItem(NOTICE_KEY + kid, keep ? NOTICE_KEPT : NOTICE_NONE); } catch (e) { /* shown again next time: never hidden */ }
  }
  function noticeText(lang, keep) { var t = COPY[lang === 'ur' ? 'ur' : 'en']; return keep ? t.noticeKept : t.noticeNone; }

  // ── the microphone sheet, one on every reading surface (WhatsApp in-app browser on Android: ask only after a tap) ──
  //   askMic(el, {lang, src, onStream, onNotNow, onDenied, ev, facts, notice: {kid, keep}})
  //   0. notice (when this child has not seen it on this phone): the microphone notice under the child's line, above the fold;
  //      "Start reading" marks it seen ("Not now" is not a microphone use: it stays owed);
  //   1. one line for the child + the big "Start reading" (getUserMedia only inside this tap) + "For grown-ups" (what is
  //      heard, what is kept, how to stop — closed until opened);
  //   2. the phone's own prompt as a picture (which button to tap);
  //   3. a second big "Not now, just listen" → onNotNow() (else onDenied('not_now')): back to listening, no loss.
  //   Blocked, unsupported or no answer in 8 s → "That's OK, let's listen with Jugnu" (+ "Open in Chrome" on Android).
  //   ev(name, data): mic_ask {src} when shown, mic_declined {src, how} when the reading goes on without the mic.
  var MIC_WAIT_MS = 8000;
  function askMic(el, o) {
    var t = Object.assign({}, COPY[o.lang === 'ur' ? 'ur' : 'en'], o.copy || {});
    var src = String(o.src || 'passage').slice(0, 16);
    var ev = function (n, d) { try { if (o.ev) o.ev(n, d); } catch (e) { /* the host's log never breaks the ask */ } };
    var dl = o.lang === 'ur' ? ' dir="rtl" lang="ur"' : ' dir="ltr" lang="en"';
    var nt = o.notice && !noticeSeen(o.notice.kid, !!o.notice.keep) ? o.notice : null;
    el.innerHTML = '<div class="lr-ask"' + dl + '><p class="lr-say">' + esc(t.micAsk) + '</p>'
      + (nt ? '<p class="lr-notice" role="note">' + esc(noticeText(o.lang, !!nt.keep)) + '</p>' : '')
      + '<div class="lr-os-pic">' + OS_PIC + '<p class="lr-os-say">' + esc(t.osAsk) + '</p></div>'
      + '<button class="wq-btn wq-go lr-go" type="button">' + MIC + ' ' + esc(t.micGo) + '</button>'
      + '<button class="wq-btn wq-soft lr-listen" type="button">' + esc(t.notNow) + '</button>'
      + '<details class="lr-grown"><summary>' + esc(t.grownUps) + '</summary><p>' + esc(o.facts || t.facts) + '</p></details></div>';
    ev('mic_ask', { src: src });
    var settled = false;
    function notNow() {
      if (o.onNotNow) o.onNotNow(); else if (o.onDenied) o.onDenied('not_now');
    }
    el.querySelector('.lr-listen').addEventListener('click', function () { if (settled) return; settled = true; ev('mic_declined', { src: src, how: 'not_now' }); notNow(); });
    function off(why) {
      if (settled) return;
      settled = true;
      ev('mic_declined', { src: src, how: why });
      var android = /Android/i.test((navigator && navigator.userAgent) || '');
      var href = 'intent://' + location.host + location.pathname + (location.search || '') + '#Intent;scheme=https;package=com.android.chrome;end';
      el.innerHTML = '<div class="lr-ask"' + dl + '><p class="lr-say">' + esc(t.okListen) + '</p>'
        + '<button class="wq-btn wq-go lr-listen" type="button">' + esc(t.listen) + '</button>'
        + (android && why !== 'notallowederror' ? '<a class="wq-btn wq-soft" href="' + esc(href) + '">' + esc(t.chrome) + '</a>' : '') + '</div>';
      var b = el.querySelector('.lr-listen');
      if (b) b.addEventListener('click', function () { if (o.onDenied) o.onDenied(why); });
    }
    el.querySelector('.lr-go').addEventListener('click', function () {
      if (nt) noticeMark(nt.kid, !!nt.keep);
      var md = navigator.mediaDevices;
      if (!md || typeof md.getUserMedia !== 'function') { off('unsupported'); return; }
      setTimeout(function () { off('timeout'); }, MIC_WAIT_MS);
      md.getUserMedia({ audio: true }).then(function (stream) {
        if (settled) { try { stream.getTracks().forEach(function (x) { x.stop(); }); } catch (e) { /* gone */ } return; }
        settled = true;
        o.onStream(stream);
      }).catch(function (e) { off(String((e && e.name) || 'error').toLowerCase().replace(/[^a-z]/g, '').slice(0, 24)); });
    });
  }

  // ── the reading, mounted on one element (a story page) ────────────────────────────
  var SLICE_MS = 250;
  var CHECK_MS = 10000;
  function mount(el, o) {
    var lang = o.lang === 'ur' ? 'ur' : 'en';
    var t = Object.assign({}, COPY[lang], o.copy || {});
    // words: strings, or {t, box:[x,y,w,h]} in image pixels for a story page over its illustration
    var items = (o.words || String(o.text || '').split(/\s+/).filter(Boolean)).map(function (w) { return typeof w === 'string' ? { t: w } : w; });
    var m = matcher(items.map(function (x) { return x.t; }));
    var img = o.image && o.image.w > 0 && o.image.h > 0 && items.every(function (x) { return x.box && x.box.length === 4; }) ? o.image : null;
    var pc = function (v, of) { return Math.round(1000 * v / of) / 10 + '%'; };
    var fin = o.finish || { pct: lang === 'ur' ? 0.75 : 0.8, quiet_ms: QUIET_MS, tail_ms: TAIL_MS, quiet: !o.counted };
    // a counted reading: Done only once this share of the words is lit (an early Done would lose the reading)
    var doneFrom = o.counted ? (typeof o.doneFrom === 'number' ? o.doneFrom : 0.8) : 0;
    var maxMs = o.maxMs || 60000;
    var s = { started: Date.now(), lastAt: Date.now(), v: m.view(), sock: null, live: false, queue: [], chunks: [], ended: null, mr: null, tick: null, quietT: null };
    el.innerHTML = '<div class="lr" dir="' + (o.dir === 'rtl' || lang === 'ur' ? 'rtl' : 'ltr') + '" lang="' + lang + '">'
      + '<p class="lr-nudge">' + esc(t.readNow) + '</p>'
      + (img
        ? '<div class="lr-ov" style="aspect-ratio:' + img.w + '/' + img.h + '"><img src="' + esc(img.url) + '" alt="" width="' + img.w + '" height="' + img.h + '">'
          + items.map(function (x, i) { var b = x.box; return '<span class="lr-w lr-box" data-i="' + i + '" style="left:' + pc(b[0], img.w) + ';top:' + pc(b[1], img.h) + ';width:' + pc(b[2], img.w) + ';height:' + pc(b[3], img.h) + '" aria-label="' + esc(x.t) + '"></span>'; }).join('') + '</div>'
        : '<div class="lr-text">' + m.words.map(function (w, i) { return '<span class="lr-w" data-i="' + i + '">' + esc(w) + '</span>'; }).join(' ') + '</div>')
      + (o.meter === 'none' ? '' : '<div class="lr-glow lr-glow-0" aria-hidden="true"></div>')
      + '<div class="lr-bar"><button class="wq-btn wq-navy lr-done" type="button"' + (doneFrom > 0 ? ' hidden' : '') + '>' + doneHtml(t) + '</button>'
      + (o.counted ? '<button class="wq-btn wq-soft lr-stop" type="button">' + esc(t.stop) + '</button>' : '') + '</div></div>';
    var spans = el.querySelectorAll ? el.querySelectorAll('.lr-w') : [];
    var nudge = el.querySelector('.lr-nudge');
    var doneBtn = el.querySelector('.lr-done');
    function paint() {
      for (var i = 0; i < spans.length; i += 1) spans[i].className = 'lr-w ' + (img ? 'lr-box ' : '') + 'lr-' + s.v.states[i];
      // a counted read: Done from doneFrom lit, or at once when the live words stopped (none can light any more)
      if (doneBtn && doneFrom > 0) doneBtn.hidden = !(s.sock === false || (s.v.total > 0 && s.v.heard / s.v.total >= doneFrom));
      var glow = el.querySelector('.lr-glow');
      if (glow) glow.className = 'lr-glow lr-glow-' + glowLevel(s.v);
      if (nudge) nudge.textContent = s.rest ? t.rest : Date.now() - s.lastAt > 5000 && s.v.heard > 0 ? t.keepGoing : t.readNow;
    }
    function check() {
      var why = shouldFinish(s.v, Date.now(), s.lastAt, fin);
      if (why) finish(why);
    }
    function onTokens(tokens) {
      var before = s.v.heard;
      var was = s.v.states;
      s.v = m.push(tokens);
      juiceWords(m.words, was, s.v.states, o.counted);
      if (s.v.heard > before) {
        tokSpan(s, tokens);
        s.lastAt = Date.now();
        clearTimeout(s.quietT);
        s.quietT = setTimeout(check, (s.v.lastHeard ? (fin.tail_ms || TAIL_MS) : (fin.quiet_ms || QUIET_MS)) + 20);
      }
      paint();
      if (!s.ended) check();
    }
    function fallback(why) {
      if (!s.live && s.sock === false) return;
      s.live = false; s.sock = false;
      if (!s.ended) paint();
      if (o.onFallback) o.onFallback(why);
    }
    // the recorder: 250-ms slices to the socket (queued until it opens: the first carries the webm header)
    try {
      var MR = window.MediaRecorder;
      s.mr = new MR(o.stream);
      s.mr.ondataavailable = function (e) {
        if (!(e.data && e.data.size)) return;
        if (o.record) s.chunks.push(e.data);
        // the sound kit holds its sounds for a moment after each chunk sent (none lands on a chunk boundary)
        if (s.live && s.sock) { s.sock.send(e.data); juice('chunk'); } else if (s.sock == null && s.queue.length < 40) s.queue.push(e.data);
      };
      s.mr.start(SLICE_MS);
    } catch (e) { s.mr = null; }
    Promise.resolve().then(function () { return o.getKey(); }).then(function (k) {
      if (s.ended || !window.WebSocket) { fallback('no_socket'); return; }
      // the day's readings used up: the kind line, then the host plays the story instead ('rest')
      if (k && k.error === 'enough_for_today') { s.rest = true; paint(); fallback('rest'); return; }
      // a refused key answers {error} through a plain fetch: never open a socket to "undefined"
      if (!k || typeof k.ws !== 'string' || !/^wss:\/\//.test(k.ws) || !k.api_key) { fallback('key'); return; }
      s.sock = W.open({ ws: k.ws, api_key: k.api_key, model: k.model, lang: k.lang || lang, onTokens: onTokens, onFail: fallback });
      s.live = true;
      s.queue.splice(0).forEach(function (c) { s.sock.send(c); });
    }).catch(function () { fallback('key'); });
    s.tick = setInterval(function () { if (Date.now() - s.started >= maxMs) finish('timer'); else paint(); }, 1000);
    if (doneBtn) doneBtn.addEventListener('click', function () { finish('done_tap'); });
    if (o.counted) { var stopBtn = el.querySelector('.lr-stop'); if (stopBtn) stopBtn.addEventListener('click', function () { finish('stuck'); }); }
    juice('mic', true);

    function deliver(r) {
      if (o.onResult) o.onResult(r);
      emit(r);
      if (!o.counted && o.playWord && wordTaps(el, r.marks, o.playWord)) {
        for (var i = 0; i < spans.length; i += 1) if (r.marks[i] === 'skipped') spans[i].className += ' lr-tap';
      }
    }
    function finish(why) {
      if (s.ended) return;
      s.ended = why;
      clearInterval(s.tick); clearTimeout(s.quietT);
      juice('mic', false);
      var ms = Date.now() - s.started;
      var base = { source: o.source || 'story_page', id: o.id, lang: lang, counted: !!o.counted, ended: why };
      if (s.live && s.sock) {
        // the recorder's last slice goes out BEFORE "finalize" (the socket drops audio once it is ending)
        var fin = false;
        var close = function () { if (fin) return; fin = true; s.sock.finish(function () { s.v = m.end(); deliver(result(s.v, Object.assign(base, { ms: spanMs(s.firstMs, s.lastMs, why, ms), live: true }))); }); };
        if (s.mr && s.mr.state !== 'inactive') {
          s.mr.onstop = close;
          setTimeout(close, 400);
          try { s.mr.stop(); } catch (e) { close(); }
        } else close();
        return;
      }
      if (s.mr && s.mr.state !== 'inactive') { try { s.mr.stop(); } catch (e) { /* stopped */ } }
      // real-time did not work: an honest "checking…" for at most 10 s, then the card from what is known
      el.innerHTML = '<div class="lr-check" dir="' + (lang === 'ur' ? 'rtl' : 'ltr') + '" lang="' + lang + '"><p class="lr-say">' + esc(t.checking) + '</p></div>';
      var done = false;
      // the host's check may know more words; the hand-off keeps the one result shape (and never a rate)
      var give = function (r) {
        if (done) return;
        done = true;
        var out = result(s.v, Object.assign(base, { ms: ms, live: false }));
        if (r && typeof r === 'object') ['words_total', 'words_read', 'correct', 'skipped', 'marks'].forEach(function (k) { if (r[k] != null) out[k] = r[k]; });
        deliver(out);
      };
      setTimeout(function () { give(null); }, CHECK_MS);
      if (o.check && o.record) {
        Promise.resolve(o.check(new Blob(s.chunks, { type: (s.mr && s.mr.mimeType) || 'audio/webm' }))).then(function (r) { give(r || null); }, function () { give(null); });
      } else give(null);
    }
    return {
      stop: function (why) { finish(why || 'done_tap'); },
      destroy: function () { if (!s.ended) juice('mic', false); s.ended = s.ended || 'gone'; clearInterval(s.tick); clearTimeout(s.quietT); if (s.mr && s.mr.state !== 'inactive') { try { s.mr.stop(); } catch (e) { /* stopped */ } } },
      view: function () { return s.v; },
    };
  }

  // ── the result's ms: first word → finish on the audio clock ─────────────────────────────────────
  // o.firstMs / o.lastMs: the first heard word's start and the last heard word's end, from the tokens of each batch that lit a word
  function tokSpan(o, tokens) {
    (tokens || []).forEach(function (tk) {
      if (!tk || !String(tk.text || '').trim()) return;
      if (typeof tk.start_ms === 'number' && (o.firstMs == null || tk.start_ms < o.firstMs)) o.firstMs = tk.start_ms;
      if (typeof tk.end_ms === 'number' && !(tk.end_ms <= (o.lastMs || 0))) o.lastMs = tk.end_ms;
    });
  }
  // ended on the last word or the quiet: the reading stopped at the last word heard; else at the tap or the timer
  function spanMs(first, last, ended, elapsed) {
    if (first == null) return Math.max(0, Math.round(elapsed || 0));
    var end = ended === 'last_word' || ended === 'quiet' ? (last || 0) : Math.max(last || 0, elapsed || 0);
    return Math.max(0, Math.round(end - first));
  }

  // ── the Trail's read (wq-challenge.js) under v3: its live-reading logic lives here, so a child without the switch never
  //    downloads it. h = { d(), live(), rec, lang(), q(id), screen(), paint(), stop(why), later(), liveOk(), guard(), stuck() }
  function trail(h) {
    var C = function () { return COPY[h.lang() === 'ur' ? 'ur' : 'en']; };
    var cfg = function () { return h.d().lr3; };
    var counted = function () { return !!cfg().counted; };
    function view() { var l = h.live(); var v = l && l.v; return v ? { heard: v.heardOk, total: v.marks.length, lastHeard: !!v.lastHeard } : { heard: 0, total: 0, lastHeard: false }; }
    // Done always on a practice read; on a counted read once done_from of the words are lit, or whenever the live words
    // are not working (none can light: the child must still be able to say "I'm done")
    function doneOpen() {
      var from = Number(cfg().done_from) || 0;
      if (!from || !h.liveOk()) return true;
      var v = view();
      return v.total > 0 && v.heard / v.total >= from;
    }
    // a new word lit: the glow, the counted read's Done at 80 %, and the finish check after the tail / the quiet
    function heard(before, tokens) {
      tokSpan(h.live(), tokens);
      var f = cfg().finish || {};
      var v = view();
      var g = h.q('wqc-lr-glow');
      if (g) g.className = 'lr-glow lr-glow-' + glowLevel(v);
      var from = Number(cfg().done_from) || 0;
      if (from && before / v.total < from && v.heard / v.total >= from && h.screen() === 'read-live') h.paint();
      setTimeout(function () {
        var l = h.live();
        if (!l || !l.v || h.screen() !== 'read-live') return;
        var now = view();
        var why = shouldFinish(now, Date.now(), l.lastWordAt, f);
        if (why) { h.stop(why); return; }
        // a counted read never ends on the quiet: past the share the Done button pulses once and the line asks "Done?"
        var btn = h.q('wqc-stop');
        if (counted() && btn && now.heard / now.total >= (f.pct || 0.8) && Date.now() - l.lastWordAt >= (f.quiet_ms || QUIET_MS) && btn.className.indexOf('lr-pulse') < 0) {
          btn.className += ' lr-pulse';
          h.rec.lrAsk = true;
          var n = h.q('wqc-nudge');
          if (n) n.textContent = C().doneAsk;
        }
      }, v.lastHeard ? (f.tail_ms || TAIL_MS) : (f.quiet_ms || QUIET_MS));
    }
    // the result handed to the card (wq:liveread:result): the live words when there are some, else what is known
    function hand(isLive) {
      var d = h.d(); var l = h.live(); var v = l && l.v; var rec = h.rec;
      var st = v ? v.marks.map(function (m) { return m === 'ok' || m === 'okp' ? 'read' : (m === 'miss' ? 'skipped' : 'ahead'); }) : [];
      var vw = { states: st, read: v ? v.correct : 0, heard: v ? v.heardOk : 0, skipped: st.filter(function (x) { return x === 'skipped'; }).length, total: v ? v.marks.length : ((d.story && d.story.tokens) || []).length };
      emit(result(vw, { source: 'passage', id: d.passage_id || null, lang: h.lang(), counted: counted(), ended: rec.ended, ms: isLive && l ? spanMs(l.firstMs, l.lastMs, rec.ended, rec.ms) : rec.ms, live: isLive }));
    }
    // a reading that could not go live: "Listening…" for at most 10 s, then the card (the check still lands on the Book)
    function check() {
      setTimeout(function () {
        var s = h.screen();
        if (h.rec.gaveUp || (s !== 'read-send' && s !== 'read-wait')) return;
        h.later();
        h.rec.gaveUp = true;
        hand(false);
      }, CHECK_MS);
    }
    // a practice reading that has ended: a skipped word says itself when tapped, in the read-along voice (a hidden player
    // mounted on the first tap); no timing file, or one whose word times are not trusted (quality "low") ⇒ nothing to tap
    function sayWords() {
      var d = h.d(); var l = h.live();
      if (counted() || !d.readalong || d.readalong.quality === 'low' || !window.WQReadAlong || !l || !l.v) return;
      var marks = l.v.marks.map(function (m) { return m === 'miss' ? 'skipped' : m; });
      var player = null;
      wordTaps(h.q('wqc-live-story'), marks, function (i) {
        if (!player) {
          var box = document.createElement('div');
          box.hidden = true;
          document.body.appendChild(box);
          player = window.WQReadAlong.mount(box, d.readalong, {});
        }
        player.playWord(i);
      });
    }
    // one Done label ("I'm done" + a drawn tick). Counted: Done per doneOpen() and a quiet "Stop for now" from the first
    // second (stored as today's "too hard"). Practice: Done from the first second; under the read guard "too hard" still
    // opens after the first line's window
    function sticky() {
      var c = C();
      if (counted()) return '<div class="wqc-sticky">' + (doneOpen() ? '<button class="wq-btn wq-navy" id="wqc-stop" type="button">' + doneHtml(c) + '</button>' : '') + '<button class="wq-btn wq-soft lr-stop" id="wqc-stuck" type="button">' + esc(c.stop) + '</button></div>';
      return '<div class="wqc-sticky"><button class="wq-btn wq-navy" id="wqc-stop" type="button">' + doneHtml(c) + '</button>' + (h.guard() && h.rec.stuckOpen ? '<button class="wq-btn wq-soft" id="wqc-stuck" type="button">' + esc(h.stuck()) + '</button>' : '') + '</div>';
    }
    return { copy: C, counted: counted, view: view, doneOpen: doneOpen, heard: heard, hand: hand, check: check, sayWords: sayWords, sticky: sticky };
  }

  window.WQLiveRead = { fold: fold, matcher: matcher, shouldFinish: shouldFinish, glowLevel: glowLevel, result: result, emit: emit, mount: mount, askMic: askMic, juice: juice, juiceWords: juiceWords, doneHtml: doneHtml, wordTaps: wordTaps, spanMs: spanMs, trail: trail, COPY: COPY,
    noticeSeen: noticeSeen, noticeMark: noticeMark, noticeText: noticeText };
})();
