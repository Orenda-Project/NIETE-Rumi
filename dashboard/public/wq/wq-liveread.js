/*
 * Live reading v3 (window.WQLiveRead; needs wq-read-live.js for the scorer's own word rules). Loaded by a page only when
 * the bot says so (the read payload's / menu's `lr3`, app_settings web_quiz_live_read_v3). Contract: LIVEREAD.md.
 *
 *   matcher(words, lang)          transcript tokens → passage words. Both sides folded: case, punctuation, diacritics,
 *                                 Urdu letter forms (WQLive.clean), and numerals — digits, Urdu / Arabic-Indic digits and
 *                                 number words are one word ("3" = "three" = "۳" = "تین"). The child reads a PREFIX: a
 *                                 word passed over is `skipped` (never wrong), an extra or repeated word costs nothing.
 *                                 States per word: read (heard, final) · heard (not final yet) · skipped · current · ahead
 *   shouldFinish(v, now, lastAt, f)   'last_word' | 'quiet' | null (RULING #C1) — the last word heard, f.tail_ms (1 s)
 *                                 after it; or ≥ f.pct of the words heard and f.quiet_ms (4 s) with no new word (never
 *                                 when f.quiet is false: a counted read)
 *   glowLevel(v)                  0–4: Jugnu's glow, by the share of words lit — never by speed, never a number
 *   result(v, o)                  the result object handed to the card (no transcript in it)
 *   emit(result)                  window event `wq:liveread:result` (m-scorecard listens)
 *   mount(el, o)                  the whole reading on one element (a story page): words, Done, the stream, the finish
 *                                 rules, the fallback; → { stop(reason), destroy() }
 *   askMic(el, o)                 the microphone ask that works in WhatsApp's in-app browser on Android
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

  // ── the finish rules (LIVEREAD §4) ───────────────────────────────────────────────────────────────
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

  // ── the result (LIVEREAD §6) and its hand-off ────────────────────────────────────────────────────
  function result(v, o) {
    var x = o || {};
    var ms = Math.max(0, Math.round(x.ms || 0));
    var counted = !!x.counted;
    var marks = (v.states || []).map(function (s) { return s === 'read' || s === 'heard' ? 'read' : (s === 'skipped' ? 'skipped' : 'ahead'); });
    return {
      v: 1, source: x.source || 'passage', id: x.id == null ? null : x.id, lang: x.lang === 'ur' ? 'ur' : 'en',
      words_total: v.total, words_read: v.heard, correct: v.read, skipped: v.skipped,
      wpm: x.wpm && counted && ms >= 5000 ? Math.round(v.read / ms * 60000) : null,
      ms: ms, ended: x.ended || 'done_tap', marks: marks, counted: counted, live: x.live !== false,
    };
  }
  function emit(r) {
    try {
      if (typeof window.dispatchEvent === 'function' && typeof CustomEvent === 'function') window.dispatchEvent(new CustomEvent('wq:liveread:result', { detail: r }));
    } catch (e) { /* an old WebView: the callback is the hand-off */ }
  }

  // ── copy (EN + UR; no test words; gender-neutral) ────────────────────────────────────────────────
  var COPY = {
    en: { done: 'Done', checking: 'Listening…', readNow: 'Read it aloud!', keepGoing: 'Keep going!', wellRead: 'Well read!',
      micAsk: 'Tap the button so Jugnu can hear you read.', micGo: 'Start reading', chrome: 'Open in Chrome', listen: 'Listen with Jugnu instead' },
    ur: { done: 'ہو گیا', checking: 'آپ کی پڑھائی سنی جا رہی ہے…', readNow: 'اونچی آواز میں پڑھیں!', keepGoing: 'پڑھتے رہیں!', wellRead: 'بہت خوب پڑھا!',
      micAsk: 'بٹن دبائیں تاکہ جگنو آپ کو پڑھتے ہوئے سن سکے۔', micGo: 'پڑھنا شروع کریں', chrome: 'کروم میں کھولیں', listen: 'جگنو سے سن لیں' },
  };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  // ── the microphone ask (WhatsApp in-app browser on Android: ask only after a tap; a pending prompt is a branch) ──
  var MIC_WAIT_MS = 8000;
  function askMic(el, o) {
    var t = COPY[o.lang === 'ur' ? 'ur' : 'en'];
    el.innerHTML = '<div class="lr-ask"><p class="lr-say">' + esc(t.micAsk) + '</p><button class="wq-btn wq-go lr-go" type="button">🎤 ' + esc(t.micGo) + '</button></div>';
    var settled = false;
    function off(why) {
      if (settled) return;
      settled = true;
      var android = /Android/i.test((navigator && navigator.userAgent) || '');
      var href = 'intent://' + location.host + location.pathname + (location.search || '') + '#Intent;scheme=https;package=com.android.chrome;end';
      el.innerHTML = '<div class="lr-ask"><p class="lr-say">' + esc(t.micAsk) + '</p>'
        + (android ? '<a class="wq-btn wq-go" href="' + esc(href) + '">' + esc(t.chrome) + '</a>' : '')
        + '<button class="wq-btn wq-soft lr-listen" type="button">' + esc(t.listen) + '</button></div>';
      var b = el.querySelector('.lr-listen');
      if (b) b.addEventListener('click', function () { if (o.onDenied) o.onDenied(why); });
    }
    el.querySelector('.lr-go').addEventListener('click', function () {
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

  // ── the reading, mounted on one element (a story page; LIVEREAD §11) ────────────────────────────
  var SLICE_MS = 250;
  var CHECK_MS = 10000;
  function mount(el, o) {
    var lang = o.lang === 'ur' ? 'ur' : 'en';
    var t = Object.assign({}, COPY[lang], o.copy || {});
    // words: strings, or {t, box:[x,y,w,h]} in image pixels for a story page over its illustration (LIVEREAD §12)
    var items = (o.words || String(o.text || '').split(/\s+/).filter(Boolean)).map(function (w) { return typeof w === 'string' ? { t: w } : w; });
    var m = matcher(items.map(function (x) { return x.t; }));
    var img = o.image && o.image.w > 0 && o.image.h > 0 && items.every(function (x) { return x.box && x.box.length === 4; }) ? o.image : null;
    var pc = function (v, of) { return Math.round(1000 * v / of) / 10 + '%'; };
    var fin = o.finish || { pct: 0.8, quiet_ms: QUIET_MS, tail_ms: TAIL_MS, quiet: !o.counted };
    var maxMs = o.maxMs || 60000;
    var s = { started: Date.now(), lastAt: Date.now(), v: m.view(), sock: null, live: false, queue: [], chunks: [], ended: null, mr: null, tick: null, quietT: null };
    el.innerHTML = '<div class="lr" dir="' + (o.dir === 'rtl' || lang === 'ur' ? 'rtl' : 'ltr') + '" lang="' + lang + '">'
      + '<p class="lr-nudge">' + esc(t.readNow) + '</p>'
      + (img
        ? '<div class="lr-ov" style="aspect-ratio:' + img.w + '/' + img.h + '"><img src="' + esc(img.url) + '" alt="" width="' + img.w + '" height="' + img.h + '">'
          + items.map(function (x, i) { var b = x.box; return '<span class="lr-w lr-box" data-i="' + i + '" style="left:' + pc(b[0], img.w) + ';top:' + pc(b[1], img.h) + ';width:' + pc(b[2], img.w) + ';height:' + pc(b[3], img.h) + '" aria-label="' + esc(x.t) + '"></span>'; }).join('') + '</div>'
        : '<div class="lr-text">' + m.words.map(function (w, i) { return '<span class="lr-w" data-i="' + i + '">' + esc(w) + '</span>'; }).join(' ') + '</div>')
      + (o.meter === 'none' ? '' : '<div class="lr-glow lr-glow-0" aria-hidden="true"></div>')
      + '<div class="lr-bar"><button class="wq-btn wq-navy lr-done" type="button">' + esc(t.done) + '</button></div></div>';
    var spans = el.querySelectorAll ? el.querySelectorAll('.lr-w') : [];
    var nudge = el.querySelector('.lr-nudge');
    function paint() {
      for (var i = 0; i < spans.length; i += 1) spans[i].className = 'lr-w ' + (img ? 'lr-box ' : '') + 'lr-' + s.v.states[i];
      var glow = el.querySelector('.lr-glow');
      if (glow) glow.className = 'lr-glow lr-glow-' + glowLevel(s.v);
      if (nudge) nudge.textContent = Date.now() - s.lastAt > 5000 && s.v.heard > 0 ? t.keepGoing : t.readNow;
    }
    function check() {
      var why = shouldFinish(s.v, Date.now(), s.lastAt, fin);
      if (why) finish(why);
    }
    function onTokens(tokens) {
      var before = s.v.heard;
      s.v = m.push(tokens);
      if (s.v.heard > before) {
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
      if (o.onFallback) o.onFallback(why);
    }
    // the recorder: 250-ms slices to the socket (queued until it opens: the first carries the webm header)
    try {
      var MR = window.MediaRecorder;
      s.mr = new MR(o.stream);
      s.mr.ondataavailable = function (e) {
        if (!(e.data && e.data.size)) return;
        if (o.record) s.chunks.push(e.data);
        if (s.live && s.sock) s.sock.send(e.data); else if (s.sock == null && s.queue.length < 40) s.queue.push(e.data);
      };
      s.mr.start(SLICE_MS);
    } catch (e) { s.mr = null; }
    Promise.resolve().then(function () { return o.getKey(); }).then(function (k) {
      if (s.ended || !window.WebSocket) { fallback('no_socket'); return; }
      // a refused key answers {error} through a plain fetch: never open a socket to "undefined"
      if (!k || typeof k.ws !== 'string' || !/^wss:\/\//.test(k.ws) || !k.api_key) { fallback('key'); return; }
      s.sock = W.open({ ws: k.ws, api_key: k.api_key, model: k.model, lang: k.lang || lang, onTokens: onTokens, onFail: fallback });
      s.live = true;
      s.queue.splice(0).forEach(function (c) { s.sock.send(c); });
    }).catch(function () { fallback('key'); });
    s.tick = setInterval(function () { if (Date.now() - s.started >= maxMs) finish('timer'); else paint(); }, 1000);
    el.querySelector('.lr-done').addEventListener('click', function () { finish('done_tap'); });

    function deliver(r) {
      if (o.onResult) o.onResult(r);
      emit(r);
    }
    function finish(why) {
      if (s.ended) return;
      s.ended = why;
      clearInterval(s.tick); clearTimeout(s.quietT);
      var ms = Date.now() - s.started;
      var base = { source: o.source || 'story_page', id: o.id, lang: lang, counted: !!o.counted, ended: why, wpm: o.wpm };
      if (s.live && s.sock) {
        // the recorder's last slice goes out BEFORE "finalize" (the socket drops audio once it is ending)
        var fin = false;
        var close = function () { if (fin) return; fin = true; s.sock.finish(function () { s.v = m.end(); deliver(result(s.v, Object.assign(base, { ms: s.v.endMs || ms, live: true }))); }); };
        if (s.mr && s.mr.state !== 'inactive') {
          s.mr.onstop = close;
          setTimeout(close, 400);
          try { s.mr.stop(); } catch (e) { close(); }
        } else close();
        return;
      }
      if (s.mr && s.mr.state !== 'inactive') { try { s.mr.stop(); } catch (e) { /* stopped */ } }
      // real-time did not work: an honest "checking…" for at most 10 s, then the card from what is known
      el.innerHTML = '<div class="lr-check"><p class="lr-say">' + esc(t.checking) + '</p></div>';
      var done = false;
      var give = function (r) { if (done) return; done = true; deliver(r || result(s.v, Object.assign(base, { ms: ms, live: false }))); };
      setTimeout(function () { give(null); }, CHECK_MS);
      if (o.check && o.record) {
        Promise.resolve(o.check(new Blob(s.chunks, { type: (s.mr && s.mr.mimeType) || 'audio/webm' }))).then(function (r) { give(r || null); }, function () { give(null); });
      } else give(null);
    }
    return {
      stop: function (why) { finish(why || 'done_tap'); },
      destroy: function () { s.ended = s.ended || 'gone'; clearInterval(s.tick); clearTimeout(s.quietT); if (s.mr && s.mr.state !== 'inactive') { try { s.mr.stop(); } catch (e) { /* stopped */ } } },
      view: function () { return s.v; },
    };
  }

  window.WQLiveRead = { fold: fold, matcher: matcher, shouldFinish: shouldFinish, glowLevel: glowLevel, result: result, emit: emit, mount: mount, askMic: askMic, COPY: COPY };
})();
